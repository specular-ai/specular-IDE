import type { ToolCall } from '../../../packages/plugin-api/src/index';
import { clip, editHash, finishSession, isoTime, projectFolder, projectPaths, records, type MutableCall, type ReadResult } from './common';

/** Increment 95: reader for Claude Code session logs (`~/.claude/projects/<encoded path>/<session>.jsonl`). */
export const CLAUDE_READER = 'claude-jsonl@1';
const KIND: Record<string, ToolCall['kind']> = { Read: 'read', NotebookRead: 'read', Edit: 'write', MultiEdit: 'write', Write: 'write', NotebookEdit: 'write',
  Bash: 'command', PowerShell: 'command', BashOutput: 'command', Grep: 'search', Glob: 'search', LS: 'search', WebSearch: 'search', WebFetch: 'read' };
const text = (content: unknown): string => typeof content === 'string' ? content : Array.isArray(content) ? content.map(c => c && typeof c === 'object' && typeof c.text === 'string' ? c.text : '').join('\n') : '';

/** The folder name Claude Code uses for a path: every character that is not a letter or digit becomes `-`. */
export const claudeFolderName = (absolute: string) => absolute.replace(/[^A-Za-z0-9]/g, '-');

export async function readClaudeSession(file: string, root: string): Promise<ReadResult> {
  const counter = { skipped: 0 };
  let id: string | undefined, cwd: string | undefined, folder: string | undefined, started: string | undefined, ended: string | undefined, branch: string | undefined, model: string | undefined, title: string | undefined;
  const turns: { index: number; started: string; toolCalls: ToolCall[] }[] = [];
  const pending = new Map<string, { call: MutableCall }>();
  const turn = (at: string) => { if (!turns.length) turns.push({ index: 0, started: at, toolCalls: [] }); return turns[turns.length - 1]; };
  for await (const r of records(file, counter)) {
    const at = isoTime(r.timestamp);
    if (r.type === 'ai-title' && typeof r.aiTitle === 'string') title = r.aiTitle.slice(0, 256);
    if (typeof r.sessionId === 'string' && !id) id = r.sessionId;
    if (typeof r.cwd === 'string' && cwd === undefined) {
      cwd = r.cwd; folder = projectFolder(root, cwd);
      if (folder === undefined) return { skippedLines: counter.skipped, truncated: false };
    }
    if (!at) continue;
    started ??= at; ended = at;
    if (typeof r.gitBranch === 'string' && r.gitBranch) branch = r.gitBranch.slice(0, 256);
    const content = r.message?.content;
    if (r.type === 'assistant' && typeof r.message?.model === 'string' && r.message.model !== '<synthetic>') model = r.message.model.slice(0, 128);
    // A human prompt starts a turn: user text that is not a tool result, a meta record, or a subagent's.
    if (r.type === 'user' && !r.isMeta && !r.isSidechain && (typeof content === 'string' || Array.isArray(content) && !content.some((b: any) => b?.type === 'tool_result'))) {
      turns.push({ index: turns.length, started: at, toolCalls: [] }); continue;
    }
    if (!Array.isArray(content)) continue;
    for (const b of content) {
      if (!b || typeof b !== 'object') continue;
      if (r.type === 'assistant' && b.type === 'tool_use' && typeof b.name === 'string') {
        const input = b.input && typeof b.input === 'object' ? b.input : {};
        const named = projectPaths(root, cwd, [input.file_path, input.notebook_path, input.path].filter(v => v !== undefined));
        const written = typeof input.new_string === 'string' ? input.new_string : typeof input.content === 'string' ? input.content
          : Array.isArray(input.edits) ? input.edits.map((e: any) => typeof e?.new_string === 'string' ? e.new_string : '').join('\n') : undefined;
        const kind = KIND[b.name] ?? 'other';
        const call: MutableCall = { at, tool: b.name.slice(0, 128), kind, paths: named.paths, outside: named.outside,
          ...(kind === 'command' && typeof input.command === 'string' ? { command: clip(input.command) } : {}), outcome: 'unknown',
          ...(r.isSidechain ? { sidechain: true as const } : {}), ...(kind === 'write' && written !== undefined ? { editHash: editHash(written) } : {}) };
        turn(at).toolCalls.push(call);
        if (typeof b.id === 'string') pending.set(b.id, { call });
      } else if (r.type === 'user' && b.type === 'tool_result' && typeof b.tool_use_id === 'string') {
        const waiting = pending.get(b.tool_use_id); if (!waiting) continue;
        pending.delete(b.tool_use_id);
        const result = text(b.content).trimStart(), exit = /^Exit code (-?\d+)/.exec(result);
        // A refusal is the user's or a permission rule's, not a failure of the tool.
        waiting.call.outcome = !b.is_error ? 'ok' : /^(The user doesn't want to proceed|Permission to use .* (has been )?denied|.*was blocked by)/i.test(result) ? 'denied' : 'error';
        if (exit) waiting.call.exitCode = Number(exit[1]);
        const duration = typeof r.durationMs === 'number' ? r.durationMs : typeof r.toolUseResult?.durationMs === 'number' ? r.toolUseResult.durationMs : undefined;
        if (duration !== undefined && Number.isFinite(duration) && duration >= 0) waiting.call.durationMs = Math.round(duration);
      }
    }
  }
  if (!id || folder === undefined || !started) return { skippedLines: counter.skipped, truncated: false };
  const { session, truncated } = finishSession({ id: id.slice(0, 128), agent: 'claude', started, ...(ended && ended !== started ? { ended } : {}), cwd: folder,
    ...(branch ? { branch } : {}), ...(model ? { model } : {}), ...(title ? { title } : {}) }, turns);
  return { session, skippedLines: counter.skipped, truncated };
}
