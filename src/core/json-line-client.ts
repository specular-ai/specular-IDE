import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';

type Message = { jsonrpc?: string; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };
export class RpcError extends Error {
  constructor(public readonly code: number, message: string) { super(message); }
}
export interface TraceEntry { direction: 'sent' | 'received'; method?: string; id?: number | string; resultKeys?: string[]; errorCode?: number }

/** Bounded JSONL transport. Payloads are never logged; client tool requests are refused. */
export class JsonLineClient {
  readonly child: ChildProcessWithoutNullStreams;
  readonly trace: TraceEntry[] = [];
  stderrBytes = 0;
  private buffer = Buffer.alloc(0);
  private totalBytes = 0;
  private sequence = 0;
  private failure?: Error;
  private notifications = new Set<{ method: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private readonly exited: Promise<void>;
  private stopTask?: Promise<{ treeTerminated: boolean; exited: boolean }>;
  constructor(file: string, args: string[], private readonly options: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs?: number; maxBytes?: number; windowsVerbatimArguments?: boolean; onFailure?: () => void; onNotification?: (method: string, params: unknown) => void }) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxBytes = options.maxBytes ?? 1_048_576;
    this.child = spawn(file, args, { cwd: options.cwd, env: options.env, windowsHide: true, shell: false, windowsVerbatimArguments: options.windowsVerbatimArguments,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    this.exited = new Promise(resolve => {
      this.child.once('close', () => { this.fail(new Error('Agent connection closed.')); resolve(); });
      this.child.once('error', () => { this.fail(new Error('Could not launch the probe runtime.')); resolve(); });
    });
    this.child.stdin.on('error', () => this.fail(new Error('Agent input stream closed.')));
    this.child.stdout.on('data', (chunk: Buffer) => this.receive(chunk));
    this.child.stderr.on('data', (chunk: Buffer) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes > this.maxBytes) { this.fail(new Error('Agent diagnostics exceeded the output limit.')); void this.stop(); }
    });
  }
  private readonly timeoutMs: number;
  private readonly maxBytes: number;
  nextNotification(method: string): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      const item = { method, resolve, reject, timer: setTimeout(() => { this.notifications.delete(item); reject(new Error('Notification timed out.')); }, this.timeoutMs) };
      this.notifications.add(item);
    });
  }
  request(method: string, params: unknown): Promise<unknown> {
    if (this.failure) return Promise.reject(this.failure);
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error(`Timed out waiting for ${method}.`)); void this.stop();
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method: string, params: unknown) { this.send({ jsonrpc: '2.0', method, params }); }
  private send(message: Message) {
    if (this.failure) return;
    this.trace.push({ direction: 'sent', method: message.method, id: message.id, errorCode: message.error?.code });
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  private receive(chunk: Buffer) {
    if (this.failure) return;
    this.totalBytes += chunk.length;
    if (this.totalBytes > this.maxBytes) { this.fail(new Error('Agent protocol output exceeded the limit.')); void this.stop(); return; }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    let newline: number;
    while ((newline = this.buffer.indexOf(10)) !== -1) {
      const line = this.buffer.subarray(0, newline).toString('utf8'); this.buffer = this.buffer.subarray(newline + 1);
      if (!line.trim()) continue;
      try {
        const message: Message = JSON.parse(line);
        if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid message.');
        this.trace.push({ direction: 'received', method: message.method, id: message.id,
          resultKeys: message.result && typeof message.result === 'object' ? Object.keys(message.result) : undefined, errorCode: message.error?.code });
        if (message.method && message.id !== undefined) {
          // Permission refusal is explicit; all other requests are unsupported.
          const refusals: Record<string, unknown> = {
            'session/request_permission': { outcome: { outcome: 'cancelled' } },
            'item/commandExecution/requestApproval': { decision: 'decline' },
            'item/fileChange/requestApproval': { decision: 'decline' },
            'item/permissions/requestApproval': { permissions: {}, scope: 'turn' },
          };
          this.send(Object.hasOwn(refusals, message.method)
            ? { jsonrpc: '2.0', id: message.id, result: refusals[message.method] }
            : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Specular does not provide client tools.' } });
        } else if (message.method && message.id === undefined) {
          for (const item of this.notifications) if (item.method === message.method) { clearTimeout(item.timer); this.notifications.delete(item); item.resolve(message.params); }
          this.options.onNotification?.(message.method, message.params);
        } else if (message.id !== undefined) {
          const waiting = typeof message.id === 'number' ? this.pending.get(message.id) : undefined;
          if (!waiting) continue;
          this.pending.delete(message.id as number); clearTimeout(waiting.timer);
          if (message.error) waiting.reject(new RpcError(message.error.code, message.error.message));
          else if (Object.hasOwn(message, 'result')) waiting.resolve(message.result);
          else { waiting.reject(new Error('Malformed protocol response.')); }
        }
      } catch { this.fail(new Error('Agent returned malformed JSONL.')); void this.stop(); return; }
    }
  }
  private fail(error: Error) {
    const first = !this.failure;
    this.failure ??= error;
    for (const waiting of this.pending.values()) { clearTimeout(waiting.timer); waiting.reject(this.failure); }
    this.pending.clear();
    for (const item of this.notifications) { clearTimeout(item.timer); item.reject(this.failure); }
    this.notifications.clear();
    if (first) this.options.onFailure?.();
  }
  stop() {
    this.stopTask ??= this.stopTree(); return this.stopTask;
  }
  private async stopTree() {
    this.fail(new Error('Probe stopped.'));
    let treeTerminated = false;
    // Stop the tree while its root still exists; closing stdin first could orphan descendants.
    if (this.child.pid && this.child.exitCode === null && this.child.signalCode === null) {
      if (process.platform === 'win32') {
        treeTerminated = await new Promise<boolean>(resolve => execFile(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
          ['/pid', String(this.child.pid), '/t', '/f'], { windowsHide: true, timeout: 3000 }, error => resolve(!error)));
      } else { try { process.kill(-this.child.pid, 'SIGKILL'); treeTerminated = true; } catch { /* Report unconfirmed cleanup. */ } }
    }
    if (!treeTerminated) this.child.kill();
    const exited = await new Promise<boolean>(resolve => {
      const timer = setTimeout(() => resolve(false), 2000);
      void this.exited.then(() => { clearTimeout(timer); resolve(true); });
    });
    this.child.stdin.destroy(); this.child.stdout.destroy(); this.child.stderr.destroy();
    return { treeTerminated, exited };
  }
}
