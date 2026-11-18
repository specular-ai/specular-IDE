import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { AgentSession, AgentTurn, ToolCall } from '../../../packages/plugin-api/src/index';
import { ACTIVITY_LIMITS } from '../../shared/activity-model';

/** A tool call while its result is still being read. */
export type MutableCall = { -readonly [K in keyof ToolCall]: ToolCall[K] };

/** Increment 95: what a reader returns for one log file. `session` is undefined when the log is not of this project. */
export interface ReadResult { session?: AgentSession; skippedLines: number; truncated: boolean }

/** Parsed JSON records of a JSONL file; malformed and oversized lines are counted, not returned. */
export async function* records(file: string, counter: { skipped: number }): AsyncGenerator<Record<string, any>> {
  const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      if (line.length > ACTIVITY_LIMITS.lineBytes) { counter.skipped++; continue; }
      try { const value = JSON.parse(line); if (value && typeof value === 'object' && !Array.isArray(value)) yield value; else counter.skipped++; }
      catch { counter.skipped++; }
    }
  } finally { lines.close(); }
}

const caseless = process.platform === 'win32' || process.platform === 'darwin';
const norm = (p: string) => { const n = path.resolve(p); return caseless ? n.toLowerCase() : n; };
/** The project-relative POSIX folder of `cwd`, or undefined when it is outside `root`. */
export function projectFolder(root: string, cwd: unknown): string | undefined {
  if (typeof cwd !== 'string' || !cwd || !path.isAbsolute(cwd)) return;
  const r = norm(root), c = norm(cwd);
  if (c !== r && !c.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) return;
  return path.relative(path.resolve(root), path.resolve(cwd)).split(path.sep).join('/');
}
/** Splits named paths into project-relative ones and a count of outside ones. */
export function projectPaths(root: string, cwd: string | undefined, values: unknown[]): { paths: string[]; outside: number } {
  const paths: string[] = []; let outside = 0;
  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) continue;
    const absolute = path.isAbsolute(value) ? value : cwd ? path.resolve(cwd, value) : undefined;
    const folder = absolute === undefined ? undefined : projectFolder(root, absolute);
    // The project root itself (a search over the whole project) is inside, but names no file.
    if (folder === undefined) outside++;
    else if (folder && !paths.includes(folder)) paths.push(folder);
  }
  return { paths: paths.slice(0, 256), outside };
}
export const editHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);
export const clip = (command: string) => command.length > ACTIVITY_LIMITS.command ? command.slice(0, ACTIVITY_LIMITS.command - 1) + '…' : command;
export const isoTime = (value: unknown): string | undefined => typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? new Date(value).toISOString() : undefined;

/** Builds a session from turns, applying the per-session cap. */
export function finishSession(base: Omit<AgentSession, 'turns' | 'toolCalls' | 'failures' | 'truncated'>, turns: { index: number; started: string; toolCalls: ToolCall[] }[]): { session: AgentSession; truncated: boolean } {
  let budget = ACTIVITY_LIMITS.callsPerSession, truncated = false;
  const kept: AgentTurn[] = [];
  for (const t of turns) {
    const calls = t.toolCalls.slice(0, Math.max(0, budget));
    if (calls.length < t.toolCalls.length) truncated = true;
    budget -= calls.length; kept.push({ index: t.index, started: t.started, toolCalls: calls });
  }
  const all = kept.flatMap(t => t.toolCalls);
  return { session: { ...base, turns: kept, toolCalls: all.length, failures: all.filter(c => c.outcome === 'error' || c.outcome === 'denied').length, truncated }, truncated };
}
