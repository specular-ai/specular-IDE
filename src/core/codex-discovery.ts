import type { CodexConnection } from './codex-connection';
import { turnError } from './codex-conversation';
import { AGENT_TOOLS } from './agent-tools';
import type { AdapterRun, AgentAdapter } from './discovery-run';

const obj = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
/** Built-in Codex tools disabled for discovery threads; the run also stops on any item that reports one (86a probe). */
export const DISABLED_CODEX_FEATURES = ['shell_tool', 'unified_exec', 'view_image', 'apps', 'plugins', 'browser_use', 'computer_use', 'image_generation', 'tool_suggest', 'skill_search', 'memories', 'goals', 'sleep_tool', 'in_app_browser', 'multi_agent', 'hooks'];
const ALLOWED_ITEMS = new Set(['userMessage', 'agentMessage', 'reasoning', 'plan', 'contextCompaction']);
const ITEM_LABELS: Record<string, string> = { commandExecution: 'a shell command', fileChange: 'a file change', webSearch: 'a web search', imageView: 'an image view', imageGeneration: 'image generation', dynamicToolCall: 'a client tool', collabAgentToolCall: 'another agent', subAgentActivity: 'another agent' };

/** Codex adapter: an ephemeral read-only, network-off thread whose only tools are the Specular MCP server's. */
export class CodexDiscoveryAdapter implements AgentAdapter {
  readonly name = 'Codex';
  constructor(private connection: CodexConnection, private options: { statusMs?: number; stopMs?: number } = {}) {}
  async start(run: AdapterRun) {
    const runtime = this.connection.runtime();
    if (!runtime) throw new Error('Connect Codex in Agent setup, then retry.');
    let thread: string | undefined, turn: string | undefined, ended = false, stopped = false;
    const end = (message?: string) => { if (ended) return; ended = true; unsubscribe(); run.ended(message); };
    // A completed turn may get one follow-up turn on the same thread (92); the run decides.
    const finished = (status: unknown, error: unknown) => {
      const text = status === 'completed' && !stopped && !ended ? run.followUp() : undefined;
      if (text) { startTurn(text).catch(failure => end(failure instanceof Error ? failure.message : 'Codex did not start the follow-up turn.')); return; }
      end(status === 'failed' ? `${turnError(error)}` : status === 'interrupted' ? 'Codex interrupted the run.' : undefined);
    };
    const startTurn = async (text: string) => {
      turn = undefined;
      const turnResponse = obj(await runtime.client.request('turn/start', { threadId: thread, input: [{ type: 'text', text }], ...(run.model ? { model: run.model } : {}), approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false } }));
      const startedTurn = obj(turnResponse.turn);
      if (typeof startedTurn.id !== 'string') throw new Error('Codex did not start the discovery turn.');
      turn = startedTurn.id;
      if (['completed', 'failed', 'interrupted'].includes(startedTurn.status)) finished(startedTurn.status, startedTurn.error);
    };
    const unsubscribe = this.connection.subscribe((method, value) => {
      if (method === 'specular/disconnected') { end('Codex disconnected during discovery. Reconnect in Agent setup and retry.'); return; }
      const p = obj(value);
      if (!thread || p.threadId !== thread) return;
      if (method === 'item/started' || method === 'item/completed') {
        const item = obj(p.item);
        if (item.type === 'mcpToolCall') { if (item.server !== 'specular') run.violation(`Codex called the MCP server "${String(item.server)}".`); }
        else if (!ALLOWED_ITEMS.has(item.type)) run.violation(`Codex attempted ${ITEM_LABELS[item.type] ?? `a "${String(item.type)}" item`}, which discovery does not allow.`);
        else if (method === 'item/completed' && item.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) run.progress(item.text.trim().slice(0, 4000), 'agent');
      }
      if (method === 'turn/completed') {
        const completed = obj(p.turn);
        if (turn && completed.id !== turn) return;
        finished(completed.status, completed.error);
      }
    });
    const stop = async () => {
      if (stopped) return; stopped = true;
      if (thread && turn && !ended && this.connection.runtime()?.client === runtime.client) {
        await new Promise<void>(resolve => {
          const timer = setTimeout(done, this.options.stopMs ?? 10_000);
          const off = this.connection.subscribe((method, value) => { const p = obj(value); if (method === 'specular/disconnected' || (method === 'turn/completed' && p.threadId === thread)) done(); });
          function done() { clearTimeout(timer); off(); resolve(); }
          void runtime.client.request('turn/interrupt', { threadId: thread, turnId: turn }).catch(done);
        });
      }
      ended = true; unsubscribe();
      if (thread) await runtime.client.request('thread/unsubscribe', { threadId: thread }).catch(() => undefined);
    };
    try {
      run.progress('Preparing a read-only Codex thread…');
      // The thread works in Specular's empty runtime workspace; the project is reachable only through the MCP tools.
      const cwd = await this.connection.prepareProject(runtime.cwd);
      const config = {
        mcp_servers: { specular: { command: run.mcp.command, args: run.mcp.args, env: run.mcp.env, startup_timeout_sec: 20, tool_timeout_sec: 180 } },
        features: Object.fromEntries(DISABLED_CODEX_FEATURES.map(feature => [feature, false])),
        web_search: 'disabled',
      };
      const response = obj(await runtime.client.request('thread/start', { cwd, ...(run.model ? { model: run.model } : {}), approvalPolicy: 'never', sandbox: 'read-only', ephemeral: true, config, developerInstructions: run.instructions }));
      const started = obj(response.thread), sandbox = obj(response.sandbox);
      if (typeof started.id !== 'string' || started.ephemeral !== true || response.approvalPolicy !== 'never' || sandbox.type !== 'readOnly' || sandbox.networkAccess !== false || response.cwd !== cwd) throw new Error('Codex could not verify a read-only discovery thread.');
      thread = started.id;
      await this.verifyServers(runtime, thread);
      if (stopped) return { stop };
      run.progress('Codex is surveying the project…');
      await startTurn(run.prompt);
    } catch (error) { await stop(); throw error; }
    return { stop };
  }
  /** The thread must see exactly the Specular server, connected, with exactly its tools. */
  private async verifyServers(runtime: NonNullable<ReturnType<CodexConnection['runtime']>>, thread: string) {
    const expected = AGENT_TOOLS.map(tool => tool.name).sort().join(',');
    const deadline = Date.now() + (this.options.statusMs ?? 20_000);
    for (;;) {
      const servers: Record<string, any>[] = obj(await runtime.client.request('mcpServerStatus/list', { threadId: thread })).data ?? [];
      if (servers.length !== 1 || servers[0].name !== 'specular') throw new Error(`Codex reported unexpected MCP servers (${servers.map(server => String(server.name)).join(', ') || 'none'}). Discovery needs only the Specular server.`);
      const [server] = servers, state = server.runtimeStatus;
      if (Object.keys(obj(server.tools)).sort().join(',') === expected && (state == null || state === 'connected')) return;
      if (server.toolsError || ['authenticationRequired', 'failed', 'cancelled', 'disabled'].includes(state) || Date.now() > deadline) throw new Error('Codex could not start the Specular tools. Check that Specular can run its MCP server, then retry.');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
}
