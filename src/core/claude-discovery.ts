import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverAgent, stopProcess } from './agent-discovery';
import { AGENT_TOOLS } from './agent-tools';
import type { AdapterRun, AgentAdapter } from './discovery-run';

const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
export const CLAUDE_TOOL_PREFIX = 'mcp__specular__';
/**
 * Headless Claude Code flags for discovery (86b probe, `scripts/probe-claude-mcp.mts`): no built-in tools, only the
 * per-run MCP configuration, no settings files, hooks, skills, or slash commands, and anything not allowed is refused.
 * Stream-JSON input (92 probe, `--follow-up`) keeps the session open for a follow-up user message after a result.
 */
export function claudeArguments(mcpConfig: string, systemPromptFile: string, model?: string) {
  return ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--tools', '', '--strict-mcp-config', '--mcp-config', mcpConfig,
    '--allowedTools', 'mcp__specular', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--restricted', '--setting-sources', '',
    '--no-session-persistence', '--disable-slash-commands', '--system-prompt-file', systemPromptFile, ...(model ? ['--model', model] : [])];
}
/** The session must offer exactly the Specular tools, from exactly the Specular server, and refuse everything else. */
export function initProblem(init: Record<string, any>): string | undefined {
  const expected = AGENT_TOOLS.map(tool => CLAUDE_TOOL_PREFIX + tool.name).sort().join(',');
  const tools: unknown[] = Array.isArray(init.tools) ? init.tools : [];
  const extra = tools.filter(tool => typeof tool !== 'string' || !tool.startsWith(CLAUDE_TOOL_PREFIX));
  if (extra.length) return `Claude Code offered other tools (${extra.slice(0, 5).map(String).join(', ')}).`;
  if ([...tools].sort().join(',') !== expected) return 'Claude Code did not offer the Specular tools. Check that Specular can run its MCP server, then retry.';
  const servers: Record<string, any>[] = Array.isArray(init.mcp_servers) ? init.mcp_servers : [];
  if (servers.length !== 1 || servers[0].name !== 'specular' || servers[0].status !== 'connected') return `Claude Code reported unexpected MCP servers (${servers.map(server => String(server.name)).join(', ') || 'none'}).`;
  if (init.permissionMode !== 'dontAsk') return `Claude Code started in permission mode "${String(init.permissionMode)}" instead of refusing unapproved tools.`;
  if (Array.isArray(init.slash_commands) && init.slash_commands.length) return 'Claude Code loaded commands or skills.';
}

/** Claude Code adapter (increment 86b): `claude -p` with stream-JSON, in an empty run directory, limited to the Specular MCP tools. */
export class ClaudeDiscoveryAdapter implements AgentAdapter {
  readonly name = 'Claude Code';
  constructor(private options: { executable: string; runRoot: string; env?: NodeJS.ProcessEnv; initMs?: number }) {}
  async start(run: AdapterRun) {
    run.progress('Starting Claude Code…');
    await mkdir(this.options.runRoot, { recursive: true });
    const directory = await mkdtemp(path.join(this.options.runRoot, 'run-')), workspace = path.join(directory, 'workspace');
    await mkdir(workspace);
    const cleanup = () => rm(directory, { recursive: true, force: true }).catch(() => undefined);
    let child: ChildProcessWithoutNullStreams;
    try {
      const agent = await discoverAgent('claude', this.options.executable, { cwd: workspace, env: this.options.env });
      if (agent.status !== 'detected' || !agent.path) throw new Error('Claude Code is not available. Check its installation in Agent setup, then retry.');
      const mcpConfig = path.join(directory, 'mcp.json'), promptFile = path.join(directory, 'system-prompt.md');
      await writeFile(mcpConfig, JSON.stringify({ mcpServers: { specular: { type: 'stdio', command: run.mcp.command, args: run.mcp.args, env: run.mcp.env } } }));
      await writeFile(promptFile, run.instructions);
      const args = claudeArguments(mcpConfig, promptFile, run.model);
      const env: NodeJS.ProcessEnv = { ...(this.options.env ?? process.env) }; delete env.ELECTRON_RUN_AS_NODE;
      if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(agent.path)) {
        // npm launchers need cmd.exe; every argument is a fixed flag or a path Specular created, quoted for cmd.
        if ([agent.path, ...args].some(value => /[%!^"\r\n]/.test(value))) throw new Error('The Claude Code launcher path contains unsupported characters. Choose claude.exe in Agent setup.');
        const line = [agent.path, ...args].map(value => `"${value}"`).join(' ');
        child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe'), ['/d', '/s', '/c', `"${line}"`], { cwd: workspace, env, windowsHide: true, windowsVerbatimArguments: true, detached: false });
      } else child = spawn(agent.path, args, { cwd: workspace, env, windowsHide: true, detached: process.platform !== 'win32' });
    } catch (error) { await cleanup(); throw error; }
    let ended = false, stopped = false, initialized = false, stderr = '', buffer = '';
    // Stream-JSON input (92): the prompt is the first user message, and stdin stays open for one follow-up message.
    const send = (text: string) => { if (child.stdin.writable) child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'); };
    const end = (message?: string) => { if (ended) return; ended = true; clearTimeout(initTimer); if (child.stdin.writable) child.stdin.end(); run.ended(message); };
    const initTimer = setTimeout(() => { if (!initialized) { run.violation('Claude Code did not start a session within 30 seconds.'); } }, this.options.initMs ?? 30_000);
    const handle = (message: Record<string, any>) => {
      if (message.type === 'system' && message.subtype === 'init') {
        // Every turn starts with an init event, checked each time.
        const first = !initialized; initialized = true; clearTimeout(initTimer);
        const problem = initProblem(message);
        if (problem) run.violation(problem); else if (first) run.progress('Claude Code is surveying the project…');
        return;
      }
      if (message.type === 'assistant') {
        for (const block of Array.isArray(obj(message.message).content) ? obj(message.message).content : []) {
          const item = obj(block);
          if (item.type === 'tool_use' && (typeof item.name !== 'string' || !item.name.startsWith(CLAUDE_TOOL_PREFIX))) run.violation(`Claude Code attempted the tool "${String(item.name)}", which discovery does not allow.`);
          // `<synthetic>` messages repeat errors that the result reports.
          else if (item.type === 'text' && obj(message.message).model !== '<synthetic>' && typeof item.text === 'string' && item.text.trim()) run.progress(item.text.trim().slice(0, 4000), 'agent');
        }
        return;
      }
      if (message.type === 'result') {
        if (message.is_error || message.subtype !== 'success') {
          const detail = typeof message.result === 'string' && message.result.trim() ? message.result.trim() : Array.isArray(message.errors) ? message.errors.join(' ') : String(message.subtype ?? 'error');
          end(`Claude Code stopped: ${detail.slice(0, 300)}`);
        } else {
          const text = ended || stopped ? undefined : run.followUp();
          if (text) send(text); else end();
        }
      }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > 8 * 1024 * 1024) { run.violation('Claude Code produced an oversized message.'); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        try { handle(JSON.parse(line)); } catch { /* Non-JSON diagnostics are ignored. */ }
      }
    });
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
    const exited = new Promise<void>(resolve => child.once('close', code => {
      if (!stopped) end(`Claude Code exited (code ${code}) without a result.${stderr.trim() ? ' ' + stderr.trim().split('\n').at(-1)!.slice(0, 300) : ''}`);
      resolve();
    }));
    child.once('error', () => end('Claude Code could not be started. Check its installation in Agent setup.'));
    child.stdin.on('error', () => undefined);
    send(run.prompt);
    const stop = async () => {
      if (stopped) return; stopped = true; ended = true; clearTimeout(initTimer);
      if (child.exitCode === null && child.signalCode === null && child.pid) { if (!(await stopProcess(child.pid))) child.kill(); }
      await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
      await cleanup();
    };
    return { stop };
  }
}
