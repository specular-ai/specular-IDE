import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AGENT_TOOLS, toolText, type AgentToolResult } from './agent-tools';

/**
 * The Specular MCP server (increment 86a, DD-054). Agents start `specular-mcp` over stdio; that proxy connects here over a
 * local pipe and authenticates with the run token, so tools run in the application with Specular's limits.
 */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_LINE = 1024 * 1024;
type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };
export type ToolCaller = (name: string, args: unknown) => Promise<AgentToolResult>;

/** One MCP session: lifecycle, tool listing, and tool calls. */
export async function mcpResponse(message: Message, call: ToolCaller): Promise<object | undefined> {
  const reply = (result: unknown) => ({ jsonrpc: '2.0', id: message.id, result });
  const error = (code: number, text: string) => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code, message: text } });
  if (!message || typeof message !== 'object' || typeof message.method !== 'string') return message && 'id' in message && !('result' in message || 'error' in message) ? error(-32600, 'Invalid request.') : undefined;
  if (message.id === undefined || message.id === null) return undefined; // notifications need no answer
  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion;
      return reply({ protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'specular', title: 'Specular', version: '0.1.0' } });
    }
    case 'ping': return reply({});
    case 'tools/list': return reply({ tools: AGENT_TOOLS.map(tool => ({ ...tool, annotations: { readOnlyHint: true, openWorldHint: false } })) });
    case 'tools/call': {
      const name = message.params?.name;
      if (typeof name !== 'string' || !AGENT_TOOLS.some(tool => tool.name === name)) return error(-32602, `Unknown tool: ${String(name)}`);
      const result = await call(name, message.params?.arguments ?? {});
      return reply({ content: [{ type: 'text', text: toolText(result) }, ...(result.notice ? [{ type: 'text', text: result.notice }] : [])], isError: !result.ok });
    }
    default: return error(-32601, `Method not found: ${message.method}`);
  }
}

export function pipePath(id: string) {
  return process.platform === 'win32' ? `\\\\.\\pipe\\specular-mcp-${id}` : path.join(tmpdir(), `specular-mcp-${id}.sock`);
}

/** The token-authenticated pipe for one run. Several proxy connections are allowed, since agents restart servers. */
export class McpBridge {
  readonly token = randomBytes(32).toString('hex');
  readonly path = pipePath(randomBytes(12).toString('hex'));
  private server?: Server;
  private sockets = new Set<Socket>();
  constructor(private call: ToolCaller, private rejected: (reason: string) => void = () => {}) {}
  start() {
    return new Promise<void>((resolve, reject) => {
      const server = createServer(socket => this.accept(socket));
      server.once('error', reject);
      server.listen(this.path, () => { server.off('error', reject); this.server = server; resolve(); });
    });
  }
  private accept(socket: Socket) {
    this.sockets.add(socket); socket.setEncoding('utf8');
    let buffer = '', authenticated = false, queue = Promise.resolve();
    const close = () => { this.sockets.delete(socket); socket.destroy(); };
    const timer = setTimeout(() => { if (!authenticated) { this.rejected('An MCP connection did not authenticate.'); close(); } }, 5000);
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      if (buffer.length > MAX_LINE && !buffer.includes('\n')) { this.rejected('An MCP message exceeded 1 MB.'); close(); return; }
      let newline: number;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim(); buffer = buffer.slice(newline + 1);
        if (!line) continue;
        if (!authenticated) {
          let token = '';
          try { token = String(JSON.parse(line).token ?? ''); } catch { token = ''; }
          const expected = Buffer.from(this.token), given = Buffer.from(token);
          if (given.length !== expected.length || !timingSafeEqual(given, expected)) { clearTimeout(timer); this.rejected('An MCP connection presented an invalid run token.'); close(); return; }
          authenticated = true; clearTimeout(timer); continue;
        }
        let message: Message;
        try { message = JSON.parse(line); } catch { socket.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error.' } }) + '\n'); continue; }
        // Calls are answered in order; the tool host runs one call at a time anyway.
        queue = queue.then(async () => {
          const response = await mcpResponse(message, this.call).catch(error => ({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: error instanceof Error ? error.message : 'Internal error.' } }));
          if (response && !socket.destroyed) socket.write(JSON.stringify(response) + '\n');
        });
      }
    });
    socket.on('error', close); socket.on('close', () => { clearTimeout(timer); this.sockets.delete(socket); });
  }
  async stop() {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    const server = this.server; this.server = undefined;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
