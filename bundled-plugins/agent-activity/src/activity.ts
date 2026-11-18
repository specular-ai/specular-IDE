import type { ActivityModel, AgentSession, PhysicalModel, ToolCall } from '@specular/plugin-api';

/** Increment 95b (REQ-225, DD-061): what the Agent activity views show, derived from `activity@1` only. */
export type Agent = AgentSession['agent'];
export interface Filters { agent?: Agent; from?: string; to?: string; session?: string }
export const AGENT_NAMES: Record<Agent, string> = { claude: 'Claude Code', codex: 'Codex' };
/** Failing calls of one command group within a session at which the group is marked as a repeated failure. */
export const REPEATED_FAILURES = 3;

export const sessionKey = (s: AgentSession) => `${s.agent}:${s.id}`;
export const failed = (c: ToolCall) => c.outcome === 'error' || c.outcome === 'denied';
export const callsOf = (s: AgentSession) => s.turns.flatMap(t => t.toolCalls);

/** Local midnight of a `YYYY-MM-DD` day, or undefined when the value is not a day. */
function day(value: string | undefined, offset = 0) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const [y, m, d] = value.split('-').map(Number), time = new Date(y, m - 1, d + offset).getTime();
  return Number.isNaN(time) ? undefined : time;
}

/** Sessions that match the agent, overlap the day range (inclusive, local days), and are the chosen session when one is chosen. */
export function filterSessions(model: ActivityModel, filters: Filters): AgentSession[] {
  const from = day(filters.from), to = day(filters.to, 1);
  return model.sessions.filter(s => {
    if (filters.agent && s.agent !== filters.agent) return false;
    if (filters.session && sessionKey(s) !== filters.session) return false;
    const start = Date.parse(s.started), end = Date.parse(s.ended ?? s.started);
    return (from === undefined || end >= from) && (to === undefined || start < to);
  });
}

export function durationText(started: string, ended?: string) {
  const ms = ended ? Date.parse(ended) - Date.parse(started) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return '';
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} s`;
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

export interface Resource { path: string; reads: number; writes: number; other: number; sessions: number; last: string; spec: boolean }
export interface Resources { files: Resource[]; outside: number }
/**
 * Project files named by tool calls, with reads, writes, and other mentions (searches and commands that name a file),
 * the sessions that touched them, and the last access. Spec files are the Markdown documents of the physical model.
 */
export function resources(sessions: readonly AgentSession[], physical?: PhysicalModel): Resources {
  const specs = new Set(physical?.documents.map(d => d.file) ?? []);
  const files = new Map<string, Resource & { seen: Set<string> }>();
  let outside = 0;
  for (const s of sessions) for (const c of callsOf(s)) {
    outside += c.outside;
    for (const p of new Set(c.paths)) {
      let r = files.get(p);
      if (!r) files.set(p, r = { path: p, reads: 0, writes: 0, other: 0, sessions: 0, last: c.at, spec: specs.has(p), seen: new Set() });
      if (c.kind === 'read') r.reads++; else if (c.kind === 'write') r.writes++; else r.other++;
      if (c.at > r.last) r.last = c.at;
      r.seen.add(sessionKey(s));
    }
  }
  return { outside, files: [...files.values()].map(({ seen, ...r }) => ({ ...r, sessions: seen.size }))
    .sort((a, b) => (b.reads + b.writes + b.other) - (a.reads + a.writes + a.other) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

/** Segments that only prepare the command: folder changes, environment and PowerShell variable assignments, shell options. */
const PREPARES = [/^(?:cd|pushd|chdir|Set-Location|sl)(?:\s|$)/i, /^[A-Za-z_][A-Za-z0-9_]*=(?:\$\(.*\)|"[^"]*"|'[^']*'|\S*)$/s, /^\$[\w:]+\s*=/, /^export\s+\S+=/, /^set\s+[-+]/];
/** Words before the program: assignments, PowerShell's call operator, braces, and wrappers that run the next word. */
const LEADING = /^(?:[A-Za-z_][A-Za-z0-9_]*=.*|&|\{|\(|sudo|time|env|nohup)$/;
/** Programs whose next word is a tool or script rather than a subcommand: `npx playwright test`, `npm run build`. */
const RUNNERS = new Set(['npx', 'pnpx', 'bunx', 'uvx']), SCRIPTED = new Set(['npm', 'pnpm', 'yarn', 'bun']);
/** Shell control words: a loop or condition is grouped by its keyword alone. */
const KEYWORDS = new Set(['for', 'foreach', 'while', 'until', 'if', 'function']);
/** Git options taking a value before the subcommand (`git -c safe.directory=x status`). */
const GIT_VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace']);
/** Programs without subcommands, whose next word is an argument (`ls examples`); PowerShell cmdlets (`Get-ChildItem`) too. */
const PLAIN = new Set(['ls', 'dir', 'cat', 'head', 'tail', 'wc', 'grep', 'rg', 'sed', 'awk', 'find', 'echo', 'mv', 'cp', 'rm', 'mkdir', 'touch', 'which', 'where']);
const CMDLET = /^[A-Z][a-z]+-[A-Za-z]+$/;
const WORD = /^[A-Za-z][\w:.-]*$/;
/** The group of a PowerShell here-string whose program was clipped from the command text. */
export const HERE_STRING = 'PowerShell here-string';

/**
 * Splits a command at `&&`, `||`, `;`, `|`, and line ends outside quotes and parentheses (`f=$(ls | head -1)`), joining
 * continued lines. A leading PowerShell here-string (`@' … '@ | python -`) is the input of the program after it, so it is
 * skipped; when the command text was clipped before the here-string ends, there is no program to name.
 */
function segments(command: string): string[] {
  let text = command.trim();
  if (/^@['"]\r?\n/.test(text)) {
    const here = /^@(['"])\r?\n[\s\S]*?\r?\n\1@/.exec(text);
    if (!here) return [HERE_STRING];
    text = text.slice(here[0].length);
  }
  const out: string[] = [];
  let current = '', quote = '', depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) { current += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; current += ch; continue; }
    if (ch === '(') depth++; else if (ch === ')') depth = Math.max(0, depth - 1);
    if ((ch === '\\' || ch === '`') && text[i + 1] === '\n') { current += ' '; i++; continue; }
    if (!depth && (ch === '\n' || ch === ';' || ch === '|' || (ch === '&' && text[i + 1] === '&'))) {
      out.push(current.trim()); current = '';
      if (text[i + 1] === ch && ch !== '\n') i++;
      continue;
    }
    current += ch;
  }
  out.push(current.trim());
  return out.filter(Boolean);
}
/** Splits on whitespace outside quotes; quoted text stays one token, quotes included. */
function tokens(text: string): string[] {
  return [...text.matchAll(/(?:"[^"]*"?|'[^']*'?|[^\s"']+)+/g)].map(m => m[0]);
}
/**
 * The group a command belongs to: its first words, after leading folder changes (`cd x &&`), environment and variable
 * assignments (`FOO=1`, `$env:FOO='1';`, `export FOO=1`), and a program's path (`node_modules/.bin/vitest` is `vitest`).
 * A program keeps one subcommand word (`git status`), a runner keeps two (`npx playwright test`, `npm run build`);
 * options, paths, and quoted text end the group.
 */
export function commandGroup(command: string): string {
  const parts = segments(command);
  while (parts.length > 1 && PREPARES.some(p => p.test(parts[0]))) parts.shift();
  if (parts[0] === HERE_STRING) return HERE_STRING;
  const words = tokens(parts[0] ?? '');
  while (words.length > 1 && LEADING.test(words[0])) words.shift();
  if (!words.length) return command.trim().slice(0, 60);
  const first = words[0].replace(/^[({]+/, '').replace(/^["']|["']$/g, '').replace(/[(){}].*$/, '');
  const program = first.split(/[\\/]/).pop()!.replace(/\.(?:exe|cmd|bat|ps1)$/i, '') || words[0];
  if (KEYWORDS.has(program) || PLAIN.has(program) || CMDLET.test(program)) return program;
  let rest = words.slice(1);
  if (program === 'git') {
    while (rest.length && rest[0].startsWith('-')) rest = rest.slice(GIT_VALUE_OPTIONS.has(rest[0]) ? 2 : 1);
  }
  const depth = RUNNERS.has(program) || (SCRIPTED.has(program) && ['run', 'exec', 'x', 'dlx'].includes(rest[0] ?? '')) ? 2 : 1;
  const group = [program];
  for (const word of rest.slice(0, depth)) {
    if (!WORD.test(word) || /\.[A-Za-z0-9]{1,5}$/.test(word)) break;
    group.push(word);
  }
  return group.join(' ');
}

export interface CommandGroup {
  name: string; count: number; failures: number; sessions: number;
  last: { at: string; outcome: ToolCall['outcome']; exitCode?: number; command: string };
  /** Sessions in which the group failed at least `REPEATED_FAILURES` times. */
  repeated: number;
}
/** Shell commands grouped by `commandGroup`, most used first. Calls without command text are not commands. */
export function commandGroups(sessions: readonly AgentSession[]): CommandGroup[] {
  const groups = new Map<string, CommandGroup & { perSession: Map<string, number>; seen: Set<string> }>();
  for (const s of sessions) for (const c of callsOf(s)) {
    if (!c.command) continue;
    const name = commandGroup(c.command);
    let g = groups.get(name);
    if (!g) groups.set(name, g = { name, count: 0, failures: 0, sessions: 0, repeated: 0, last: { at: '', outcome: c.outcome, command: c.command }, perSession: new Map(), seen: new Set() });
    g.count++; g.seen.add(sessionKey(s));
    if (failed(c)) { g.failures++; g.perSession.set(sessionKey(s), (g.perSession.get(sessionKey(s)) ?? 0) + 1); }
    if (c.at >= g.last.at) g.last = { at: c.at, outcome: c.outcome, command: c.command, ...(c.exitCode === undefined ? {} : { exitCode: c.exitCode }) };
  }
  return [...groups.values()].map(({ perSession, seen, ...g }) => ({ ...g, sessions: seen.size, repeated: [...perSession.values()].filter(n => n >= REPEATED_FAILURES).length }))
    .sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** A group's calls, newest first, with their sessions: the commands view's detail. */
export function groupCalls(sessions: readonly AgentSession[], name: string, limit = 50) {
  return sessions.flatMap(s => callsOf(s).filter(c => c.command && commandGroup(c.command) === name).map(call => ({ session: s, call })))
    .sort((a, b) => (a.call.at < b.call.at ? 1 : a.call.at > b.call.at ? -1 : 0)).slice(0, limit);
}

export interface Totals { sessions: number; turns: number; toolCalls: number; failures: number }
export function totals(sessions: readonly AgentSession[]): Totals {
  return sessions.reduce((t, s) => ({ sessions: t.sessions + 1, turns: t.turns + s.turns.length, toolCalls: t.toolCalls + s.toolCalls, failures: t.failures + s.failures }), { sessions: 0, turns: 0, toolCalls: 0, failures: 0 });
}

/** What a tool call names, for a one-line description: its command, else its paths, else the outside count. */
export function callTarget(c: ToolCall) {
  if (c.command) return c.command;
  const named = c.paths.join(', '), outside = c.outside ? `${c.outside} ${c.outside === 1 ? 'path' : 'paths'} outside the project` : '';
  return [named, outside].filter(Boolean).join(' · ');
}
