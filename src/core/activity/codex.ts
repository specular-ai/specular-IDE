import type { ToolCall } from '../../../packages/plugin-api/src/index';
import { clip, editHash, finishSession, isoTime, projectFolder, projectPaths, records, type MutableCall, type ReadResult } from './common';

/** Increment 95: reader for Codex rollouts (`~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`). */
export const CODEX_READER = 'codex-jsonl@1';
const SHELLS = /(^|[\\/])(bash|sh|zsh|dash|powershell(\.exe)?|pwsh(\.exe)?|cmd(\.exe)?)$/i;

/** The command a user would recognize: the script of a shell wrapper (`bash -lc "…"`), otherwise the joined arguments. */
export function commandText(command: unknown): string | undefined {
  if (typeof command === 'string') return command;
  if (!Array.isArray(command) || !command.every(c => typeof c === 'string') || !command.length) return;
  if (SHELLS.test(command[0]) && command.length >= 3 && /^(-l?c|-Command|\/c)$/i.test(command[command.length - 2])) return command[command.length - 1];
  return command.join(' ');
}
const ms = (duration: any) => duration && typeof duration === 'object' && Number.isFinite(duration.secs) ? Math.round(duration.secs * 1000 + (Number(duration.nanos) || 0) / 1e6) : undefined;

/** The `cwd` of a rollout, from its first record (`session_meta`), without reading the rest. */
export async function codexSessionFolder(file: string): Promise<string | undefined> {
  const counter = { skipped: 0 };
  for await (const r of records(file, counter)) return r.type === 'session_meta' && typeof r.payload?.cwd === 'string' ? r.payload.cwd : undefined;
}

export async function readCodexSession(file: string, root: string): Promise<ReadResult> {
  const counter = { skipped: 0 };
  let id: string | undefined, cwd: string | undefined, folder: string | undefined, started: string | undefined, ended: string | undefined, model: string | undefined, branch: string | undefined;
  // Current rollouts log structured items; older ones only function calls. One source per file avoids counting twice.
  const items: { turn: number; call: ToolCall }[] = [], fallback: { turn: number; call: MutableCall }[] = [];
  const pending = new Map<string, MutableCall>();
  const turns: { index: number; started: string; toolCalls: ToolCall[] }[] = [];
  const current = (at: string) => { if (!turns.length) turns.push({ index: 0, started: at, toolCalls: [] }); return turns.length - 1; };
  for await (const r of records(file, counter)) {
    const at = isoTime(r.timestamp), p = r.payload && typeof r.payload === 'object' ? r.payload : {};
    if (r.type === 'session_meta') {
      id = typeof p.id === 'string' ? p.id : typeof p.session_id === 'string' ? p.session_id : id;
      cwd = typeof p.cwd === 'string' ? p.cwd : cwd; folder = projectFolder(root, cwd);
      if (folder === undefined) return { skippedLines: counter.skipped, truncated: false };
      if (typeof p.git?.branch === 'string') branch = p.git.branch.slice(0, 256);
    }
    if (!at || folder === undefined) continue;
    started ??= at; ended = at;
    if (r.type === 'turn_context' && typeof p.model === 'string') model = p.model.slice(0, 128);
    if (r.type === 'event_msg' && p.type === 'task_started') { turns.push({ index: turns.length, started: at, toolCalls: [] }); continue; }
    if (r.type === 'event_msg' && p.type === 'item_completed' && p.item && typeof p.item === 'object') {
      const it = p.item, failed = it.status === 'failed';
      let call: ToolCall | undefined;
      if (it.type === 'CommandExecution') {
        const command = commandText(it.command), parsed = Array.isArray(it.parsed_cmd) ? it.parsed_cmd : [];
        const kinds = new Set(parsed.map((c: any) => c?.type));
        const kind: ToolCall['kind'] = parsed.length && [...kinds].every(k => k === 'read') ? 'read' : parsed.length && [...kinds].every(k => k === 'search' || k === 'list_files') ? 'search' : 'command';
        const named = projectPaths(root, typeof it.cwd === 'string' ? it.cwd : cwd, parsed.map((c: any) => c?.path ?? (kind === 'read' ? c?.name : undefined)).filter((v: unknown) => v !== undefined));
        const exit = Number.isSafeInteger(it.exit_code) ? it.exit_code : undefined, duration = ms(it.duration);
        call = { at, tool: 'CommandExecution', kind, paths: named.paths, outside: named.outside, ...(command ? { command: clip(command) } : {}),
          outcome: failed || (exit !== undefined && exit !== 0) ? 'error' : it.status === 'completed' ? 'ok' : 'unknown', ...(exit !== undefined ? { exitCode: exit } : {}), ...(duration !== undefined ? { durationMs: duration } : {}) };
      } else if (it.type === 'FileChange' && it.changes && typeof it.changes === 'object') {
        const named = projectPaths(root, cwd, Object.keys(it.changes));
        const written = Object.values(it.changes).map((c: any) => typeof c?.content === 'string' ? c.content : typeof c?.unified_diff === 'string' ? c.unified_diff : '').join('\n');
        call = { at, tool: 'FileChange', kind: 'write', paths: named.paths, outside: named.outside, outcome: failed ? 'error' : it.status === 'completed' ? 'ok' : 'unknown', ...(written ? { editHash: editHash(written) } : {}) };
      } else if (it.type === 'ImageView') {
        const named = projectPaths(root, cwd, [it.path]);
        call = { at, tool: 'ImageView', kind: 'read', paths: named.paths, outside: named.outside, outcome: 'ok' };
      } else if (it.type === 'Extension' || it.type === 'McpToolCall' || it.type === 'WebSearch') {
        const name = String(it.kind ?? it.tool ?? it.type).slice(0, 128);
        call = { at, tool: name, kind: /search/i.test(name) ? 'search' : 'other', paths: [], outside: 0, outcome: failed ? 'error' : 'ok' };
      }
      if (call) items.push({ turn: current(at), call });
      continue;
    }
    if (r.type === 'response_item' && (p.type === 'function_call' || p.type === 'local_shell_call' || p.type === 'custom_tool_call')) {
      let args: any = {};
      try { args = p.type === 'function_call' ? JSON.parse(p.arguments ?? '{}') : p.type === 'local_shell_call' ? p.action ?? {} : {}; } catch { args = {}; }
      let call: (MutableCall) | undefined;
      if (p.type === 'custom_tool_call' && p.name === 'apply_patch' && typeof p.input === 'string') {
        const named = projectPaths(root, cwd, [...p.input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)].map(m => m[1].trim()));
        call = { at, tool: 'apply_patch', kind: 'write', paths: named.paths, outside: named.outside, outcome: 'unknown', editHash: editHash(p.input) };
      } else if (p.type === 'local_shell_call' || ['shell', 'exec_command', 'container.exec', 'local_shell'].includes(p.name)) {
        const command = commandText(args.command ?? args.cmd);
        call = { at, tool: String(p.name ?? 'local_shell').slice(0, 128), kind: 'command', paths: [], outside: 0, ...(command ? { command: clip(command) } : {}), outcome: 'unknown' };
      }
      if (call) { fallback.push({ turn: current(at), call }); if (typeof p.call_id === 'string') pending.set(p.call_id, call); }
      continue;
    }
    if (r.type === 'response_item' && (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') && typeof p.call_id === 'string') {
      const call = pending.get(p.call_id); if (!call) continue;
      pending.delete(p.call_id);
      const raw = typeof p.output === 'string' ? p.output : Array.isArray(p.output) ? p.output.map((o: any) => o?.text ?? '').join('\n') : '';
      let exit: number | undefined;
      try { const j = JSON.parse(raw); if (Number.isSafeInteger(j?.metadata?.exit_code)) exit = j.metadata.exit_code; } catch { const m = /Exit code:?\s*(-?\d+)/i.exec(raw); if (m) exit = Number(m[1]); }
      if (exit !== undefined) { call.exitCode = exit; call.outcome = exit === 0 ? 'ok' : 'error'; }
      else call.outcome = /^(Script failed|error|failed)/i.test(raw.trim()) ? 'error' : 'ok';
    }
  }
  if (!id || folder === undefined || !started) return { skippedLines: counter.skipped, truncated: false };
  for (const { turn, call } of items.length ? items : fallback) turns[turn].toolCalls.push(call);
  const { session, truncated } = finishSession({ id: id.slice(0, 128), agent: 'codex', started, ...(ended && ended !== started ? { ended } : {}), cwd: folder,
    ...(branch ? { branch } : {}), ...(model ? { model } : {}) }, turns);
  return { session, skippedLines: counter.skipped, truncated };
}
