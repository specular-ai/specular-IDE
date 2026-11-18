import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { discoverAgent, stopProcess } from './agent-discovery';
import type { CodexConnection } from './codex-connection';
import { DISABLED_CODEX_FEATURES } from './codex-discovery';
import { turnError } from './codex-conversation';

/** Increment 94: one tool-less turn that returns the agent's text. `signal` cancels; `timeoutMs` bounds the call. */
export interface SummaryCall { instructions: string; input: string; model?: string; signal: AbortSignal; timeoutMs?: number }
export type SummaryRunner = (call: SummaryCall) => Promise<string>;

const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const userMessage = (input: string) => `<content>\n${input}\n</content>`;
const cancelled = () => new Error('Summary generation was cancelled.');
const timedOut = (ms: number) => new Error(`The agent did not answer within ${Math.round(ms / 1000)} seconds.`);

/** Headless Claude Code with no tools, MCP servers, settings, or session persistence; the answer is the JSON `result`. */
export function claudeSummaryArguments(systemPromptFile: string, model?: string) {
  return ['-p', '--output-format', 'json', '--tools', '', '--strict-mcp-config', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--restricted',
    '--setting-sources', '', '--no-session-persistence', '--disable-slash-commands', '--system-prompt-file', systemPromptFile, ...(model ? ['--model', model] : [])];
}
/** Reads Claude Code's `--output-format json` result object. */
export function claudeSummaryResult(stdout: string): string {
  const line = stdout.trim().split('\n').reverse().find(l => l.trim().startsWith('{'));
  let result: Record<string, any>;
  try { result = obj(JSON.parse(line ?? '')); } catch { throw new Error('Claude Code returned no readable result.'); }
  if (result.is_error || result.subtype !== 'success' || typeof result.result !== 'string' || !result.result.trim()) {
    const detail = typeof result.result === 'string' && result.result.trim() ? result.result.trim() : String(result.subtype ?? 'no text');
    throw new Error(`Claude Code stopped: ${detail.slice(0, 300)}`);
  }
  return result.result.trim();
}

export function claudeSummaryRunner(options: { executable: string; runRoot: string; env?: NodeJS.ProcessEnv }): SummaryRunner {
  return async call => {
    if (call.signal.aborted) throw cancelled();
    await mkdir(options.runRoot, { recursive: true });
    const directory = await mkdtemp(path.join(options.runRoot, 'summary-')), workspace = path.join(directory, 'workspace');
    try {
      await mkdir(workspace);
      const agent = await discoverAgent('claude', options.executable, { cwd: workspace, env: options.env });
      if (agent.status !== 'detected' || !agent.path) throw new Error('Claude Code is not available. Check its installation in Agent setup, then retry.');
      const promptFile = path.join(directory, 'system-prompt.md');
      await writeFile(promptFile, call.instructions);
      const args = claudeSummaryArguments(promptFile, call.model);
      const env: NodeJS.ProcessEnv = { ...(options.env ?? process.env) }; delete env.ELECTRON_RUN_AS_NODE;
      let child: ChildProcessWithoutNullStreams;
      if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(agent.path)) {
        // npm launchers need cmd.exe; every argument is a fixed flag or a path Specular created, quoted for cmd (as in discovery).
        if ([agent.path, ...args].some(value => /[%!^"\r\n]/.test(value))) throw new Error('The Claude Code launcher path contains unsupported characters. Choose claude.exe in Agent setup.');
        const line = [agent.path, ...args].map(value => `"${value}"`).join(' ');
        child = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/cmd.exe'), ['/d', '/s', '/c', `"${line}"`], { cwd: workspace, env, windowsHide: true, windowsVerbatimArguments: true });
      } else child = spawn(agent.path, args, { cwd: workspace, env, windowsHide: true });
      return await new Promise<string>((resolve, reject) => {
        let stdout = '', stderr = '', settled = false;
        const stop = () => { if (child.exitCode === null && child.signalCode === null && child.pid) void stopProcess(child.pid).then(ok => { if (!ok) child.kill(); }); };
        const finish = (error?: Error, text?: string) => { if (settled) return; settled = true; clearTimeout(timer); call.signal.removeEventListener('abort', abort); if (error) { stop(); reject(error); } else resolve(text!); };
        const abort = () => finish(cancelled());
        const ms = call.timeoutMs ?? 120_000, timer = setTimeout(() => finish(timedOut(ms)), ms);
        call.signal.addEventListener('abort', abort);
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => { stdout += chunk; if (stdout.length > 4 * 1024 * 1024) finish(new Error('Claude Code produced an oversized answer.')); });
        child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-2000); });
        child.once('error', () => finish(new Error('Claude Code could not be started. Check its installation in Agent setup.')));
        child.once('close', code => {
          try { finish(undefined, claudeSummaryResult(stdout)); }
          catch (error) { finish(new Error(`${(error as Error).message}${code ? ` (exit code ${code})` : ''}${!stdout.trim() && stderr.trim() ? ' ' + stderr.trim().split('\n').at(-1)!.slice(0, 300) : ''}`)); }
        });
        child.stdin.on('error', () => undefined);
        child.stdin.end(userMessage(call.input));
      });
    } finally { await rm(directory, { recursive: true, force: true }).catch(() => undefined); }
  };
}

/** Codex: an ephemeral read-only, network-off thread with no MCP servers and every built-in tool disabled; any item other than messages and reasoning stops the call. */
export function codexSummaryRunner(connection: CodexConnection): SummaryRunner {
  const allowed = new Set(['userMessage', 'agentMessage', 'reasoning']);
  return async call => {
    if (call.signal.aborted) throw cancelled();
    const runtime = connection.runtime();
    if (!runtime) throw new Error('Connect Codex in Agent setup, then retry.');
    const cwd = await connection.prepareProject(runtime.cwd);
    const config = { features: Object.fromEntries(DISABLED_CODEX_FEATURES.map(feature => [feature, false])), web_search: 'disabled' };
    const response = obj(await runtime.client.request('thread/start', { cwd, ...(call.model ? { model: call.model } : {}), approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, config, developerInstructions: call.instructions }));
    const started = obj(response.thread), sandbox = obj(response.sandbox);
    if (typeof started.id !== 'string' || started.ephemeral !== true || response.approvalPolicy !== 'never' || sandbox.type !== 'readOnly' || sandbox.networkAccess !== false) throw new Error('Codex did not start a read-only, network-off thread.');
    const thread: string = started.id;
    let turn: string | undefined, answer = '';
    try {
      return await new Promise<string>((resolve, reject) => {
        let settled = false;
        const finish = (error?: Error) => {
          if (settled) return; settled = true; clearTimeout(timer); unsubscribe(); call.signal.removeEventListener('abort', abort);
          if (error) { if (turn) void runtime.client.request('turn/interrupt', { threadId: thread, turnId: turn }).catch(() => undefined); reject(error); }
          else if (!answer.trim()) reject(new Error('Codex returned no text.')); else resolve(answer.trim());
        };
        const abort = () => finish(cancelled());
        const ms = call.timeoutMs ?? 120_000, timer = setTimeout(() => finish(timedOut(ms)), ms);
        call.signal.addEventListener('abort', abort);
        const unsubscribe = connection.subscribe((method, value) => {
          if (method === 'specular/disconnected') { finish(new Error('Codex disconnected. Reconnect in Agent setup and retry.')); return; }
          const p = obj(value);
          if (p.threadId !== thread) return;
          if (method === 'item/started' || method === 'item/completed') {
            const item = obj(p.item);
            if (!allowed.has(item.type)) finish(new Error(`Codex attempted a "${String(item.type)}" item, which summaries do not allow.`));
            else if (method === 'item/completed' && item.type === 'agentMessage' && typeof item.text === 'string') answer = item.text;
          } else if (method === 'turn/completed') {
            const completed = obj(p.turn);
            if (turn && completed.id !== turn) return;
            finish(completed.status === 'completed' ? undefined : new Error(completed.status === 'failed' ? turnError(completed.error) : 'Codex interrupted the summary.'));
          }
        });
        void runtime.client.request('turn/start', { threadId: thread, input: [{ type: 'text', text: userMessage(call.input) }], ...(call.model ? { model: call.model } : {}), approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } })
          .then(value => { const t = obj(obj(value).turn); if (typeof t.id === 'string') turn = t.id; else finish(new Error('Codex did not start the summary turn.')); })
          .catch(error => finish(error instanceof Error ? error : new Error('Codex did not start the summary turn.')));
      });
    } finally { await runtime.client.request('thread/unsubscribe', { threadId: thread }).catch(() => undefined); }
  };
}
