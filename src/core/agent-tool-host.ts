import type { Worker } from 'node:worker_threads';
import type { AgentProposal, AgentToolResult, AgentToolSnapshot } from './agent-tools';

/** `reset`: the worker stopped, so its evaluations and drafts are gone (92). */
export type ToolOutcome = { result: AgentToolResult; proposal?: AgentProposal; reset?: true };
/** Runs agent tools one at a time in a worker; a call over its budget terminates the worker, which restarts on the next call. */
export class AgentToolHost {
  private worker?: Worker;
  private serial = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(private snapshot: AgentToolSnapshot, private spawn: (snapshot: AgentToolSnapshot) => Worker, private callMs = 30_000) {}
  call(name: string, args: unknown): Promise<ToolOutcome> {
    const run = this.queue.then(() => this.execute(name, args));
    this.queue = run.catch(() => undefined);
    return run;
  }
  private execute(name: string, args: unknown): Promise<ToolOutcome> {
    if (this.disposed) return Promise.resolve({ result: { ok: false, value: null, message: 'The run has ended.', summary: `${name}: run ended` } });
    const worker = this.worker ??= this.spawn(this.snapshot), id = ++this.serial;
    return new Promise(resolve => {
      const finish = (outcome: ToolOutcome) => { clearTimeout(timer); worker.off('message', message); worker.off('error', failure); worker.off('exit', failure); resolve(outcome); };
      const message = (value: { id: number } & ToolOutcome) => { if (value.id === id) finish({ result: value.result, ...(value.proposal ? { proposal: value.proposal } : {}) }); };
      const failure = () => { if (this.worker === worker) this.worker = undefined; finish({ result: { ok: false, value: null, message: 'The tool worker stopped. Evaluation IDs were reset; evaluate again.', summary: `${name}: tool worker stopped` }, reset: true }); };
      const timer = setTimeout(() => {
        if (this.worker === worker) this.worker = undefined;
        void worker.terminate();
        const seconds = Math.round(this.callMs / 1000);
        finish({ result: { ok: false, value: null, message: `The call exceeded ${seconds} seconds and was stopped. Evaluation IDs were reset. Use a simpler pattern or configuration.`, summary: `${name} stopped after ${seconds} s` }, reset: true });
      }, this.callMs);
      worker.on('message', message); worker.once('error', failure); worker.once('exit', failure);
      worker.postMessage({ id, name, args });
    });
  }
  async dispose() { this.disposed = true; const worker = this.worker; this.worker = undefined; if (worker) await worker.terminate(); }
}
