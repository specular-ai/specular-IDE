import type { ActivityModel, ActivitySource, AgentSession, AgentTurn, ToolCall } from '../../packages/plugin-api/src/index';

/** Increment 95 (DD-061): caps shared by the readers and the broker. */
export const ACTIVITY_LIMITS = { sessions: 500, callsPerSession: 5_000, calls: 20_000, command: 500, lineBytes: 1_000_000 } as const;

const object = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, n = 4096): v is string => typeof v === 'string' && v.length <= n;
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const time = (v: unknown): v is string => str(v, 64) && !Number.isNaN(Date.parse(v));
const keys = (v: Record<string, any>, names: string[]) => Object.keys(v).every(k => names.includes(k));
const agent = (v: unknown): v is 'claude' | 'codex' => v === 'claude' || v === 'codex';
/** Project-relative POSIX path, or '' for the root where allowed. */
const relative = (v: unknown, root = false): v is string => str(v) && (root && v === '' || !!v && !v.includes('\\') && !/^[A-Za-z]:/.test(v) && !v.includes('\0') && v.split('/').every(p => p !== '' && p !== '.' && p !== '..'));
const KINDS = ['read', 'write', 'command', 'search', 'other'], OUTCOMES = ['ok', 'error', 'denied', 'unknown'];

function call(v: any): ToolCall {
  if (!object(v) || !keys(v, ['at', 'tool', 'kind', 'paths', 'outside', 'command', 'outcome', 'exitCode', 'durationMs', 'sidechain', 'editHash']) || !time(v.at) || !str(v.tool, 128) || !v.tool ||
    !KINDS.includes(v.kind) || !Array.isArray(v.paths) || v.paths.length > 256 || !v.paths.every(p => relative(p)) || !integer(v.outside) || (v.command !== undefined && !str(v.command, ACTIVITY_LIMITS.command)) ||
    !OUTCOMES.includes(v.outcome) || (v.exitCode !== undefined && !Number.isSafeInteger(v.exitCode)) || (v.durationMs !== undefined && !integer(v.durationMs)) ||
    (v.sidechain !== undefined && v.sidechain !== true) || (v.editHash !== undefined && !str(v.editHash, 64))) throw new Error('Invalid activity tool call.');
  return { at: v.at, tool: v.tool, kind: v.kind, paths: [...v.paths], outside: v.outside, ...(v.command === undefined ? {} : { command: v.command }), outcome: v.outcome,
    ...(v.exitCode === undefined ? {} : { exitCode: v.exitCode }), ...(v.durationMs === undefined ? {} : { durationMs: v.durationMs }), ...(v.sidechain ? { sidechain: true as const } : {}), ...(v.editHash === undefined ? {} : { editHash: v.editHash }) };
}
function turn(v: any): AgentTurn {
  if (!object(v) || !keys(v, ['index', 'started', 'toolCalls']) || !integer(v.index) || !time(v.started) || !Array.isArray(v.toolCalls) || v.toolCalls.length > ACTIVITY_LIMITS.callsPerSession) throw new Error('Invalid activity turn.');
  return { index: v.index, started: v.started, toolCalls: v.toolCalls.map(call) };
}
function session(v: any): AgentSession {
  if (!object(v) || !keys(v, ['id', 'agent', 'started', 'ended', 'cwd', 'branch', 'model', 'title', 'turns', 'toolCalls', 'failures', 'truncated']) || !str(v.id, 128) || !v.id || !agent(v.agent) ||
    !time(v.started) || (v.ended !== undefined && !time(v.ended)) || !relative(v.cwd, true) || (v.branch !== undefined && !str(v.branch, 256)) || (v.model !== undefined && !str(v.model, 128)) ||
    (v.title !== undefined && !str(v.title, 256)) || !Array.isArray(v.turns) || v.turns.length > ACTIVITY_LIMITS.callsPerSession || !integer(v.toolCalls) || !integer(v.failures) || typeof v.truncated !== 'boolean') throw new Error('Invalid activity session.');
  return { id: v.id, agent: v.agent, started: v.started, ...(v.ended === undefined ? {} : { ended: v.ended }), cwd: v.cwd, ...(v.branch === undefined ? {} : { branch: v.branch }),
    ...(v.model === undefined ? {} : { model: v.model }), ...(v.title === undefined ? {} : { title: v.title }), turns: v.turns.map(turn), toolCalls: v.toolCalls, failures: v.failures, truncated: v.truncated };
}
function source(v: any): ActivitySource {
  if (!object(v) || !keys(v, ['agent', 'reader', 'files', 'skippedLines', 'truncated']) || !agent(v.agent) || !str(v.reader, 64) || !integer(v.files) || !integer(v.skippedLines) || typeof v.truncated !== 'boolean') throw new Error('Invalid activity source.');
  return { agent: v.agent, reader: v.reader, files: v.files, skippedLines: v.skippedLines, truncated: v.truncated };
}

/** Validates an activity model and returns an explicit copy. Its revision counts log changes, independently of the project revision. */
export function parseActivity(v: any): ActivityModel {
  if (!object(v) || !keys(v, ['name', 'version', 'revision', 'ready', 'provenance', 'warnings', 'enabled', 'sessions', 'sources']) || v.name !== 'activity' || v.version !== 1 || !integer(v.revision) ||
    typeof v.ready !== 'boolean' || !Array.isArray(v.warnings) || v.warnings.length > 64 || !v.warnings.every((w: unknown) => str(w, 1000)) ||
    !object(v.provenance) || !keys(v.provenance, ['extractor', 'extractorVersion']) || !str(v.provenance.extractor, 128) || !v.provenance.extractor || !str(v.provenance.extractorVersion, 64) || !v.provenance.extractorVersion ||
    typeof v.enabled !== 'boolean' || !Array.isArray(v.sessions) || v.sessions.length > ACTIVITY_LIMITS.sessions || !Array.isArray(v.sources) || v.sources.length > 8 ||
    ((!v.enabled || !v.ready) && v.sessions.length)) throw new Error('Invalid activity model.');
  const sessions = v.sessions.map(session);
  if (sessions.reduce((n: number, s: AgentSession) => n + s.turns.reduce((m, t) => m + t.toolCalls.length, 0), 0) > ACTIVITY_LIMITS.calls) throw new Error('Activity model exceeds its tool-call limit.');
  if (new Set(sessions.map((s: AgentSession) => `${s.agent}:${s.id}`)).size !== sessions.length) throw new Error('Duplicate activity session.');
  return { name: 'activity', version: 1, revision: v.revision, ready: v.ready, provenance: { extractor: v.provenance.extractor, extractorVersion: v.provenance.extractorVersion },
    warnings: [...v.warnings], enabled: v.enabled, sessions, sources: v.sources.map(source) };
}
