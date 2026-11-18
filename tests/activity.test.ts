import assert from 'node:assert/strict';
import test from 'node:test';
import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ActivityReader, ACTIVITY_DISABLED, activityHomes } from '../src/core/activity/reader';
import { readClaudeSession, claudeFolderName } from '../src/core/activity/claude';
import { commandText, readCodexSession } from '../src/core/activity/codex';
import { projectFolder, projectPaths } from '../src/core/activity/common';
import { ACTIVITY_LIMITS, parseActivity } from '../src/shared/activity-model';
import { parseRequest, forPlugin, type PluginManifest } from '../src/shared/plugin-runtime';
import { Settings } from '../src/core/settings';
import { API_VERSION, validateManifest } from '../packages/plugin-api/src/index';
import { modelsFor } from '../src/renderer/plugin-models';
import { LEGACY_ID_CONFIGURATION } from '../src/core/id-configuration';
import { buildIndex } from '../src/core/documents';
import { claudeRecords, jsonl, t, writeHomes } from './helpers/activity-fixtures';

// Increment 95a: the activity model read from synthetic Claude Code and Codex logs.
async function sandbox(run: (base: string, root: string) => Promise<void>) {
  await mkdir(path.resolve('.cache', 'unit-tests'), { recursive: true });
  const base = await mkdtemp(path.resolve('.cache', 'unit-tests', 'activity-'));
  const root = path.join(base, 'project'); await mkdir(root);
  try { await run(base, root); } finally { await rm(base, { recursive: true, force: true }); }
}

test('project folders and paths are project-relative, case-insensitive on Windows, and outside paths are counted', () => {
  const root = path.resolve('/work/project');
  assert.equal(projectFolder(root, root), '');
  assert.equal(projectFolder(root, path.join(root, 'a', 'b')), 'a/b');
  assert.equal(projectFolder(root, root + '-ide'), undefined);
  assert.equal(projectFolder(root, 'relative'), undefined);
  if (process.platform === 'win32') assert.equal(projectFolder(root, root.toUpperCase()), '');
  assert.deepEqual(projectPaths(root, root, [path.join(root, 'x.md'), 'y.md', path.join(root, 'x.md'), path.resolve('/elsewhere/z.md'), root]), { paths: ['x.md', 'y.md'], outside: 1 });
  assert.equal(claudeFolderName('C:\\work\\specular'), 'C--work-specular');
  assert.equal(commandText(['/bin/bash', '-lc', 'npm test']), 'npm test');
  assert.equal(commandText(['powershell.exe', '-Command', 'Get-ChildItem']), 'Get-ChildItem');
  assert.equal(commandText(['git', 'status']), 'git status');
});

test('a Claude Code log gives turns, tool-call kinds, paths, commands, outcomes, sidechains, and edit hashes', () => sandbox(async (base, root) => {
  const file = path.join(base, 's.jsonl'); await writeFile(file, jsonl(claudeRecords(root, 's1', root)));
  const { session, skippedLines } = await readClaudeSession(file, root);
  assert.equal(skippedLines, 2);
  assert.ok(session);
  assert.deepEqual([session.id, session.agent, session.cwd, session.branch, session.model, session.title, session.started, session.ended], ['s1', 'claude', '', 'feature/x', 'claude-test', 'Fix the login spec', t(0), t(9)]);
  assert.deepEqual(session.turns.map(u => [u.index, u.started, u.toolCalls.length]), [[0, t(0), 7], [1, t(8), 1]]);
  const calls = session.turns.flatMap(u => u.toolCalls);
  assert.deepEqual(calls.map(c => [c.tool, c.kind, c.paths.join(','), c.outside, c.command ?? null, c.outcome, c.exitCode ?? null]), [
    ['Read', 'read', 'specs/login.md', 0, null, 'ok', null], ['Edit', 'write', 'specs/login.md', 0, null, 'ok', null],
    ['Bash', 'command', '', 0, 'npm test', 'error', 2], ['Bash', 'command', '', 0, 'rm -rf build', 'denied', null],
    ['Grep', 'search', '', 0, null, 'ok', null], ['Read', 'read', '', 1, null, 'ok', null], ['Read', 'read', 'specs/relative.md', 0, null, 'ok', null],
    ['Write', 'write', 'notes.md', 0, null, 'unknown', null]]);
  assert.deepEqual([calls[6].sidechain, calls[0].sidechain], [true, undefined]);
  assert.match(calls[1].editHash!, /^[0-9a-f]{16}$/); assert.equal(calls[0].editHash, undefined);
  assert.deepEqual([session.toolCalls, session.failures, session.truncated], [8, 2, false]);
  assert.equal((await readClaudeSession(file, path.join(base, 'elsewhere'))).session, undefined);
}));

test('Codex rollouts use structured items, or function calls in older logs, without counting twice', () => sandbox(async (base, root) => {
  const homes = await writeHomes(base, root), day = path.join(homes.codex, 'sessions', '2026', '10', '23');
  const { session } = await readCodexSession(path.join(day, 'rollout-a.jsonl'), root);
  assert.ok(session);
  assert.deepEqual([session.id, session.model, session.cwd, session.turns.length], ['x-root', 'gpt-test', '', 2]);
  const calls = session.turns.flatMap(u => u.toolCalls);
  assert.deepEqual(calls.map(c => [c.tool, c.kind, c.paths.join(','), c.outside, c.command ?? null, c.outcome, c.exitCode ?? null, c.durationMs ?? null]), [
    ['CommandExecution', 'command', '', 0, 'npx playwright test', 'error', 1, 2500], ['CommandExecution', 'read', 'README.md', 0, 'Get-Content README.md', 'ok', 0, 1],
    ['FileChange', 'write', 'src/a.ts', 0, null, 'ok', null, null], ['ImageView', 'read', '', 1, null, 'ok', null, null], ['web.search', 'search', '', 0, null, 'ok', null, null],
    ['CommandExecution', 'command', '', 0, 'git status', 'ok', 0, null]]);
  assert.deepEqual(session.turns.map(u => u.toolCalls.length), [5, 1]);
  const legacy = (await readCodexSession(path.join(day, 'rollout-c.jsonl'), root)).session!;
  assert.equal(legacy.cwd, 'docs');
  assert.deepEqual(legacy.turns.flatMap(u => u.toolCalls).map(c => [c.tool, c.kind, c.paths.join(','), c.command ?? null, c.outcome, c.exitCode ?? null]), [
    ['shell', 'command', '', 'npm run build', 'ok', 0], ['shell', 'command', '', 'npm test', 'error', 3], ['apply_patch', 'write', 'docs/docs/spec.md', null, 'unknown', null]]);
  assert.equal((await readCodexSession(path.join(day, 'rollout-b.jsonl'), root)).session, undefined);
}));

test('the model finds the project sessions of both agents, checks each cwd, and keeps one revision while logs are unchanged', () => sandbox(async (base, root) => {
  const homes = await writeHomes(base, root);
  const reader = new ActivityReader({ claude: homes.claude, codex: homes.codex });
  const off = await reader.model(root, false);
  assert.deepEqual([off.enabled, off.ready, off.sessions, off.warnings, off.sources], [false, true, [], [ACTIVITY_DISABLED], []]);
  const model = await reader.model(root, true);
  assert.deepEqual(model.sessions.map(s => [s.agent, s.id, s.cwd]), [['codex', 'x-legacy', 'docs'], ['codex', 'x-root', ''], ['claude', 'c-sub', 'sub'], ['claude', 'c-root', '']]);
  assert.deepEqual(model.sources, [{ agent: 'claude', reader: 'claude-jsonl@1', files: 2, skippedLines: 4, truncated: false }, { agent: 'codex', reader: 'codex-jsonl@1', files: 2, skippedLines: 0, truncated: false }]);
  assert.deepEqual(parseActivity(JSON.parse(JSON.stringify(model))), model);
  assert.equal(await reader.model(root, true), model);
  await appendFile(path.join(homes.folder(root), 'c-root.jsonl'), jsonl([{ sessionId: 'c-root', cwd: root, type: 'assistant', timestamp: t(19), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'z', name: 'Read', input: { file_path: path.join(root, 'z.md') } }] } }]));
  const next = await reader.model(root, true);
  assert.equal(next.revision, model.revision + 1);
  assert.equal(next.sessions.find(s => s.id === 'c-root')!.toolCalls, 9);
  assert.equal(next.sessions.find(s => s.id === 'c-sub'), model.sessions.find(s => s.id === 'c-sub'));
  assert.deepEqual(activityHomes({ CLAUDE_CONFIG_DIR: 'C1', CODEX_HOME: 'C2' }), { claude: 'C1', codex: 'C2' });
}));

test('sessions are capped per session and in total, newest first, and truncation is reported', () => sandbox(async (base, root) => {
  const claude = path.join(base, 'claude'), folder = path.join(claude, 'projects', claudeFolderName(path.resolve(root)));
  await mkdir(folder, { recursive: true });
  const many = (id: string, minute: number, count: number) => jsonl([{ sessionId: id, cwd: root, type: 'user', timestamp: t(minute), message: { role: 'user', content: 'go' } },
    ...Array.from({ length: count }, (_, i) => ({ sessionId: id, cwd: root, type: 'assistant', timestamp: t(minute), message: { role: 'assistant', content: [{ type: 'tool_use', id: `${id}-${i}`, name: 'Bash', input: { command: 'echo' } }] } }))]);
  for (let i = 0; i < 5; i++) await writeFile(path.join(folder, `s${i}.jsonl`), many(`s${i}`, i, ACTIVITY_LIMITS.callsPerSession + 5));
  const model = await new ActivityReader({ claude, codex: path.join(base, 'codex') }).model(root, true);
  assert.deepEqual(model.sessions.map(s => [s.id, s.toolCalls, s.truncated]), [['s4', 5000, true], ['s3', 5000, true], ['s2', 5000, true], ['s1', 5000, true]]);
  assert.equal(model.sources[0].truncated, true);
  assert.equal(model.sessions.reduce((n, s) => n + s.toolCalls, 0), ACTIVITY_LIMITS.calls);
}));

test('the broker accepts activity only for plugins that declare it and rejects malformed models', () => {
  const manifest: PluginManifest = { manifestVersion: 1, id: 'test.activity', version: '1.0.0', api: API_VERSION, entry: 'index.js', capabilities: ['workspace.read'], models: ['activity@1', 'physical@1'], views: [{ id: 'v', title: 'V', kind: 'list' }] };
  const activity = { name: 'activity', version: 1, revision: 7, ready: true, provenance: { extractor: 'specular.activity', extractorVersion: '1' }, warnings: [], enabled: true,
    sessions: [{ id: 's', agent: 'claude', started: t(0), cwd: '', turns: [{ index: 0, started: t(0), toolCalls: [{ at: t(1), tool: 'Read', kind: 'read', paths: ['a.md'], outside: 0, outcome: 'ok' }] }], toolCalls: 1, failures: 0, truncated: false }],
    sources: [{ agent: 'claude', reader: 'claude-jsonl@1', files: 1, skippedLines: 0, truncated: false }] };
  const snapshot = { projectId: 'p', revision: 3, ready: true, notice: '', documents: {}, configuration: LEGACY_ID_CONFIGURATION, folders: [], files: [], index: buildIndex([]), warnings: [] };
  const request = (models: object) => JSON.stringify({ apiVersion: API_VERSION, requestId: 'r', viewId: 'v', context: { projectId: 'p', revision: 3 }, models });
  const parsed = parseRequest(request({ ...modelsFor(snapshot), activity }), manifest);
  assert.deepEqual(parsed.models.activity, activity);
  assert.deepEqual(Object.keys(forPlugin(parsed, manifest).models).sort(), ['activity', 'physical']);
  assert.throws(() => parseRequest(request({ ...modelsFor(snapshot), activity }), { ...manifest, models: ['project@1', 'physical@1'] }), /Invalid plugin models/);
  for (const bad of [{ ...activity, enabled: false }, { ...activity, sessions: [{ ...activity.sessions[0], cwd: '../x' }] },
    { ...activity, sessions: [{ ...activity.sessions[0], turns: [{ ...activity.sessions[0].turns[0], toolCalls: [{ ...activity.sessions[0].turns[0].toolCalls[0], paths: ['C:/x.md'] }] }] }] }, { ...activity, extra: 1 }])
    assert.throws(() => parseActivity(bad), /activity/i);
  assert.equal(validateManifest({ ...manifest, models: ['activity@1'] }).ok, true);
  assert.equal(validateManifest({ ...manifest, models: ['chat@1'] }).ok, false);
});

test('reading is enabled per project in settings', () => sandbox(async base => {
  const file = path.join(base, 'settings.json'), project = path.join(base, 'p');
  const settings = await Settings.load(file);
  assert.equal(settings.activityEnabled(project), false);
  await settings.saveActivityEnabled(project, true);
  assert.equal((await Settings.load(file)).activityEnabled(project), true);
  await settings.saveActivityEnabled(project, false);
  assert.equal((await Settings.load(file)).activityEnabled(project), false);
}));
