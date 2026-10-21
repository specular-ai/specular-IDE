import { AGENT_INSTRUCTIONS, draftProblems, type AgentProposal, type CategoryMetrics } from './agent-tools';
import { AgentToolHost } from './agent-tool-host';
import { McpBridge } from './mcp-server';
import { DEFAULT_RUN_LIMITS, SUBMISSION_GRACE, warnCalls, type AgentRunLimits } from './run-limits';

/** Agentic discovery runs (increment 86a, DD-054): one contract for the Codex and, later, Claude Code adapters. */
export * from './run-limits';
/** The run's budget, appended to the shared instructions (86d). */
export function budgetInstructions(limits: AgentRunLimits) {
  return `\nBudget: this run allows ${limits.toolCalls} tool calls in total, submit_proposal included. Submit your best evaluated draft before the limit, even if it could still be improved: a run that reaches the limit without a submission is discarded. Specular tells you in tool results when ${warnCalls(limits)} or fewer calls remain.`;
}
export interface McpLaunch { command: string; args: string[]; env: Record<string, string> }
export interface AdapterRun {
  mcp: McpLaunch; instructions: string; prompt: string; model?: string;
  /** Report a tool the agent used other than the Specular MCP tools; the run stops. */
  violation(message: string): void;
  /** Report that the agent finished or failed; without a submission the run fails with the message. */
  ended(message?: string): void;
  /**
   * Called when the agent's turn ends normally (92, DD-058). A message means the run asks the agent once more to submit:
   * the adapter sends it as a new user turn in the same conversation and does not call `ended`.
   */
  followUp(): string | undefined;
  progress(message: string, kind?: ProgressKind): void;
}
/** `tool`: one Specular tool call; `agent`: the agent's own commentary; `status`: run state. */
export type ProgressKind = 'status' | 'tool' | 'agent';
export interface AgentAdapter { readonly name: string; start(run: AdapterRun): Promise<{ stop(): Promise<void> }> }
/** The evaluated draft of the run with the fewest problems (duplicates plus unresolved references). */
export interface BestDraft { evaluationId: string; categories: number; duplicates: number; unresolved: number; problems: number }
export interface DiscoveryRunResult { ok: boolean; message: string; proposal?: AgentProposal; toolCalls: number; /** Recorded for reports (92). */ best?: BestDraft; followUp?: boolean }
export interface AgentDiscoveryRequest { requestId: string; root: string; documentVersions: Record<string, string>; diskVersion: string; configuration: import('./id-configuration').IdConfiguration; agent: 'codex' | 'claude'; model?: string; /** Claude Code executable from Agent setup; empty searches PATH. */ executable?: string; /** Tool-call limit chosen in Discover IDs (86d); 80 when omitted (92). */ toolCalls?: number }

export const AGENT_PROMPT = 'Discover this project\'s engineering-record conventions, including how records state their statuses and dates, and submit a measured configuration with submit_proposal.';
export const agentPrompt = (limits: AgentRunLimits) => `${AGENT_PROMPT} You have ${limits.toolCalls} tool calls.`;

export class DiscoveryRun {
  private calls = 0;
  private graceCalls = 0;
  private warned = false;
  private settled = false;
  private best?: BestDraft;
  private followedUp = false;
  private resolve!: (result: DiscoveryRunResult) => void;
  private readonly done = new Promise<DiscoveryRunResult>(resolve => { this.resolve = resolve; });
  private stopAgent?: () => Promise<void>;
  private cleanup?: Promise<void>;
  constructor(private options: { adapter: AgentAdapter; host: AgentToolHost; proxy: { command: string; args: string[]; env?: Record<string, string> }; limits?: AgentRunLimits; model?: string; progress: (message: string, kind?: ProgressKind) => void }) {}
  private get limits() { return this.options.limits ?? DEFAULT_RUN_LIMITS; }
  private finish(result: Omit<DiscoveryRunResult, 'toolCalls'>) {
    if (this.settled) return;
    this.settled = true; this.resolve({ ...result, toolCalls: this.calls, ...(this.best ? { best: this.best } : {}), ...(this.followedUp ? { followUp: true } : {}) }); void this.stop();
  }
  private fail(message: string) { this.finish({ ok: false, message: `${message} No configuration was changed.` }); }
  cancel() { this.fail('Discovery cancelled.'); return this.stop(); }
  private stop() {
    this.cleanup ??= (async () => {
      clearTimeout(this.timer);
      await Promise.allSettled([this.stopAgent?.(), this.bridge.stop(), this.options.host.dispose()]);
    })();
    return this.cleanup;
  }
  private timer?: ReturnType<typeof setTimeout>;
  private readonly bridge = new McpBridge(async (name, args) => {
    if (this.settled) return { ok: false, value: null, message: 'The run has ended.', summary: 'run ended' };
    const { toolCalls } = this.limits;
    if (++this.calls > toolCalls) {
      // After the limit, only a final submission is accepted (86d).
      if (name !== 'submit_proposal' || ++this.graceCalls > SUBMISSION_GRACE) {
        this.fail(`The agent exceeded ${toolCalls} tool calls without submitting a proposal.`);
        return { ok: false, value: null, message: 'Tool-call limit reached. The run has ended.', summary: 'tool-call limit' };
      }
    }
    const outcome = await this.options.host.call(name, args);
    this.track(name, outcome);
    const count = this.graceCalls ? `${toolCalls}+${this.graceCalls}/${toolCalls}+${SUBMISSION_GRACE}` : `${this.calls}/${toolCalls}`;
    if (!this.settled) this.options.progress(`${count} · ${outcome.result.summary}`, 'tool');
    const remaining = toolCalls - this.calls;
    if (remaining <= warnCalls(this.limits) && !outcome.proposal) {
      if (!this.warned && !this.settled) { this.warned = true; this.options.progress(`Warned the agent: ${Math.max(remaining, 0)} tool calls remain.`); }
      outcome.result.notice = remaining > 1 ? `[Specular: ${remaining} of ${toolCalls} tool calls remain. Stop surveying and submit your best evaluated draft with submit_proposal.]`
        : remaining === 1 ? `[Specular: 1 of ${toolCalls} tool calls remains. Your next call should be submit_proposal with your best evaluated draft.]`
        : `[Specular: the ${toolCalls} tool calls are used. Only submit_proposal is accepted now, at most ${SUBMISSION_GRACE - this.graceCalls} more times; any other call ends the run.]`;
    }
    if (outcome.proposal && !this.settled) {
      const proposal = outcome.proposal;
      // Answer the agent first, then end its turn.
      const extra = [proposal.statusRationale !== undefined ? 'statuses' : '', proposal.dateRationale !== undefined ? 'date rules' : ''].filter(Boolean);
      setTimeout(() => this.finish({ ok: true, proposal, message: `The agent proposed ${proposal.configuration.categories.length} categories${extra.length ? ` and ${extra.join(' and ')}` : ''} after ${this.calls} tool calls. Review before adding them to the draft.` }), 0);
    }
    return outcome.result;
  }, reason => this.fail(`Stopped: ${reason}`));
  /** Keep the best evaluated draft (92); a restarted tool worker forgets its drafts, and so does the run. */
  private track(name: string, outcome: Awaited<ReturnType<AgentToolHost['call']>>) {
    if (outcome.reset) { this.best = undefined; return; }
    const value = outcome.result.value as { evaluationId?: unknown; categories?: CategoryMetrics[] } | null;
    if (name !== 'evaluate_configuration' || !outcome.result.ok || typeof value?.evaluationId !== 'string' || !Array.isArray(value.categories)) return;
    const counts = draftProblems({ categories: value.categories });
    if (!this.best || counts.problems < this.best.problems) this.best = { evaluationId: value.evaluationId, categories: value.categories.length, ...counts };
  }
  private bestText(best: BestDraft) { return `draft ${best.evaluationId} (${best.categories} categories, ${best.duplicates} duplicates, ${best.unresolved} unresolved references)`; }
  /** One follow-up per run, when the agent ended without a submission after a valid evaluation and with calls left (92). */
  private followUp(): string | undefined {
    const remaining = this.limits.toolCalls - this.calls, best = this.best;
    if (this.settled || this.followedUp || !best || remaining <= 0) return undefined;
    this.followedUp = true;
    this.options.progress(`The agent ended without submitting. Asked it once to submit its best evaluated draft, ${best.evaluationId}.`);
    return `[Specular] You ended your turn without calling submit_proposal, so nothing has been submitted and the run would be discarded. Call submit_proposal now with your best evaluated draft. Your evaluated draft with the fewest problems is ${this.bestText(best)}; to submit it unchanged, pass "evaluationId": "${best.evaluationId}" with a rationale per category instead of a configuration. ${remaining} of ${this.limits.toolCalls} tool calls remain.`;
  }
  async start(): Promise<DiscoveryRunResult> {
    this.timer = setTimeout(() => this.fail(`Discovery exceeded ${Math.round(this.limits.wallMs / 60_000)} minutes.`), this.limits.wallMs);
    try {
      this.options.progress('Starting the Specular tools…');
      await this.bridge.start();
      if (this.settled) return this.done;
      const { proxy } = this.options;
      const handle = await this.options.adapter.start({
        mcp: { command: proxy.command, args: proxy.args, env: { ...proxy.env, SPECULAR_MCP_PIPE: this.bridge.path, SPECULAR_RUN_TOKEN: this.bridge.token } },
        instructions: AGENT_INSTRUCTIONS + budgetInstructions(this.limits), prompt: agentPrompt(this.limits), ...(this.options.model ? { model: this.options.model } : {}),
        violation: message => this.fail(`Stopped: ${message}`),
        ended: message => {
          if (this.settled) return;
          const best = this.best ? ` Its best evaluated draft was ${this.bestText(this.best)}.` : '';
          this.fail(message ?? `The agent finished without submitting a proposal${this.followedUp ? ', also after a follow-up request' : ''}.${best}`);
        },
        followUp: () => this.followUp(),
        progress: (message, kind) => { if (!this.settled) this.options.progress(message, kind); },
      });
      this.stopAgent = handle.stop;
      if (this.settled) void handle.stop();
    } catch (error) { this.fail(error instanceof Error ? error.message : 'Could not start the agent.'); }
    return this.done;
  }
  /** Resolves after the agent, the MCP pipe, and the tool worker have stopped. */
  stopped() { return this.done.then(() => this.stop()); }
}
