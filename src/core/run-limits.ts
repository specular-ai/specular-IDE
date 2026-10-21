/** Limits of agentic discovery runs (increments 86a, 86d, 92; DD-054, DD-058), without Node dependencies so the renderer can use them. */
export interface AgentRunLimits { wallMs: number; toolCalls: number; callMs: number; /** Calls before the limit from which results carry a remaining-calls notice (86d); at most a quarter of `toolCalls`. */ warnBefore?: number }
export const DEFAULT_RUN_LIMITS: AgentRunLimits = { wallMs: 10 * 60_000, toolCalls: 80, callMs: 30_000, warnBefore: 10 };
export const MAX_RUN_LIMITS: AgentRunLimits = { wallMs: 30 * 60_000, toolCalls: 200, callMs: 120_000 };
export const MIN_TOOL_CALLS = 20;
/** submit_proposal calls accepted after the tool-call limit, so a last evaluation or an invalid submission does not lose the run (86d). */
export const SUBMISSION_GRACE = 2;

/** Run limits for a user-chosen tool-call limit (86d): wall time follows it at 10 seconds per call, within the default and maximum. */
export function runLimits(toolCalls = DEFAULT_RUN_LIMITS.toolCalls): AgentRunLimits {
  return { ...DEFAULT_RUN_LIMITS, toolCalls, wallMs: Math.min(MAX_RUN_LIMITS.wallMs, Math.max(DEFAULT_RUN_LIMITS.wallMs, toolCalls * 10_000)) };
}
export function toolCallLimitError(value: unknown): string | undefined {
  return Number.isInteger(value) && (value as number) >= MIN_TOOL_CALLS && (value as number) <= MAX_RUN_LIMITS.toolCalls ? undefined : `The tool-call limit must be a whole number from ${MIN_TOOL_CALLS} to ${MAX_RUN_LIMITS.toolCalls}.`;
}
/** Remaining calls at which the agent is warned. */
export function warnCalls(limits: AgentRunLimits) { return Math.max(1, Math.min(limits.warnBefore ?? DEFAULT_RUN_LIMITS.warnBefore!, Math.floor(limits.toolCalls / 4))); }
