import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { claudeFolderName } from '../../src/core/activity/claude';

/** Increment 95: synthetic Claude Code and Codex logs shaped like the real ones (field names only; no real content). */
export const t = (minute: number) => new Date(Date.UTC(2026, 9, 23, 10, minute)).toISOString();
export const jsonl = (records: unknown[]) => records.map(r => typeof r === 'string' ? r : JSON.stringify(r)).join('\n') + '\n';

export function claudeRecords(root: string, sessionId: string, cwd: string, minute = 0) {
  const base = { sessionId, cwd, gitBranch: 'feature/x', userType: 'external', version: '2.1.309' };
  const use = (id: string, name: string, input: Record<string, unknown>, at: number, extra: Record<string, unknown> = {}) =>
    ({ ...base, ...extra, type: 'assistant', timestamp: t(minute + at), message: { role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id: string, at: number, is_error = false, content = 'done') =>
    ({ ...base, type: 'user', timestamp: t(minute + at), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, is_error, content }] }, toolUseResult: { stdout: '', stderr: '' } });
  return [
    { type: 'ai-title', aiTitle: 'Fix the login spec', sessionId },
    { ...base, type: 'user', timestamp: t(minute), message: { role: 'user', content: 'First prompt' } },
    use('a', 'Read', { file_path: path.join(root, 'specs', 'login.md') }, 1), result('a', 1),
    use('b', 'Edit', { file_path: path.join(root, 'specs', 'login.md'), old_string: 'x', new_string: 'y' }, 2), result('b', 2),
    use('c', 'Bash', { command: 'npm test' }, 3), result('c', 3, true, 'Exit code 2\nfailed'),
    use('d', 'Bash', { command: 'rm -rf build' }, 4), result('d', 4, true, "The user doesn't want to proceed with this tool use."),
    use('e', 'Grep', { pattern: 'REQ', path: root }, 5), result('e', 5),
    use('f', 'Read', { file_path: path.join(path.dirname(root), 'elsewhere.md') }, 6), result('f', 6),
    use('g', 'Read', { file_path: 'specs/relative.md' }, 7, { isSidechain: true }), result('g', 7),
    'not json {', 'x'.repeat(1_000_001),
    { ...base, type: 'user', timestamp: t(minute + 8), message: { role: 'user', content: [{ type: 'text', text: 'Second prompt' }] } },
    { ...base, type: 'user', isMeta: true, timestamp: t(minute + 8), message: { role: 'user', content: 'meta, not a prompt' } },
    use('h', 'Write', { file_path: path.join(root, 'notes.md'), content: 'hello' }, 9),
  ];
}

export function codexRecords(sessionId: string, cwd: string, root: string, minute = 0) {
  const item = (at: number, value: Record<string, unknown>) => ({ timestamp: t(minute + at), type: 'event_msg', payload: { type: 'item_completed', item: value } });
  return [
    { timestamp: t(minute), type: 'session_meta', payload: { id: sessionId, cwd, cli_version: '0.200.0' } },
    { timestamp: t(minute), type: 'turn_context', payload: { cwd, model: 'gpt-test' } },
    { timestamp: t(minute), type: 'event_msg', payload: { type: 'task_started', turn_id: 'u1' } },
    item(1, { type: 'UserMessage', content: [{ type: 'text', text: 'prompt' }] }),
    item(2, { type: 'CommandExecution', command: ['/bin/bash', '-lc', 'npx playwright test'], cwd, parsed_cmd: [{ type: 'unknown', cmd: 'npx playwright test' }], status: 'failed', exit_code: 1, duration: { secs: 2, nanos: 500_000_000 } }),
    item(3, { type: 'CommandExecution', command: ['powershell.exe', '-Command', 'Get-Content README.md'], cwd, parsed_cmd: [{ type: 'read', cmd: 'cat', name: 'README.md' }], status: 'completed', exit_code: 0, duration: { secs: 0, nanos: 1_000_000 } }),
    item(4, { type: 'FileChange', changes: { [path.join(root, 'src', 'a.ts')]: { type: 'update', unified_diff: '@@ -1 +1 @@' } }, status: 'completed' }),
    item(5, { type: 'ImageView', path: path.join(path.dirname(root), 'shot.png') }),
    item(6, { type: 'Extension', kind: 'web.search', query: 'q' }),
    { timestamp: t(minute + 7), type: 'response_item', payload: { type: 'custom_tool_call', name: 'exec', call_id: 'x', input: 'text(await tools.exec_command({cmd:"ls"}))' } },
    { timestamp: t(minute + 8), type: 'event_msg', payload: { type: 'task_started', turn_id: 'u2' } },
    item(9, { type: 'CommandExecution', command: ['git', 'status'], cwd, parsed_cmd: [], status: 'completed', exit_code: 0 }),
  ];
}

/** An older rollout without structured items: function calls, their outputs, and an apply_patch call. */
export function codexLegacyRecords(sessionId: string, cwd: string, minute = 0) {
  return [
    { timestamp: t(minute), type: 'session_meta', payload: { id: sessionId, cwd } },
    { timestamp: t(minute + 1), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c1', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm run build'] }) } },
    { timestamp: t(minute + 1), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c1', output: JSON.stringify({ output: 'ok', metadata: { exit_code: 0 } }) } },
    { timestamp: t(minute + 2), type: 'response_item', payload: { type: 'function_call', name: 'shell', call_id: 'c2', arguments: JSON.stringify({ command: ['bash', '-lc', 'npm test'] }) } },
    { timestamp: t(minute + 2), type: 'response_item', payload: { type: 'function_call_output', call_id: 'c2', output: 'Exit code: 3\nboom' } },
    { timestamp: t(minute + 3), type: 'response_item', payload: { type: 'custom_tool_call', name: 'apply_patch', call_id: 'c3', input: '*** Begin Patch\n*** Update File: docs/spec.md\n@@\n-a\n+b\n*** End Patch' } },
  ];
}

/** Writes Claude and Codex homes for `root`: sessions at the root, in a subfolder, in a look-alike sibling, and in another project. */
export async function writeHomes(base: string, root: string) {
  const claude = path.join(base, 'claude'), codex = path.join(base, 'codex');
  const folder = (cwd: string) => path.join(claude, 'projects', claudeFolderName(path.resolve(cwd)));
  const sibling = root + '-ide', other = path.join(path.dirname(root), 'other');
  for (const [cwd, id, minute] of [[root, 'c-root', 0], [path.join(root, 'sub'), 'c-sub', 20], [sibling, 'c-sibling', 30], [other, 'c-other', 40]] as const) {
    await mkdir(folder(cwd), { recursive: true });
    await writeFile(path.join(folder(cwd), `${id}.jsonl`), jsonl(claudeRecords(root, id, cwd, minute)));
  }
  const day = path.join(codex, 'sessions', '2026', '10', '23');
  await mkdir(day, { recursive: true });
  await writeFile(path.join(day, 'rollout-a.jsonl'), jsonl(codexRecords('x-root', root, root, 50)));
  await writeFile(path.join(day, 'rollout-b.jsonl'), jsonl(codexRecords('x-other', other, other, 55)));
  await writeFile(path.join(day, 'rollout-c.jsonl'), jsonl(codexLegacyRecords('x-legacy', path.join(root, 'docs'), 58)));
  return { claude, codex, folder };
}
