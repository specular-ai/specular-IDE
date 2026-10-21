import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseWorkspaceSession, Settings } from '../src/core/settings';
import { inside } from '../src/core/workspace';
import { DEFAULT_FONT_SIZES } from '../src/shared/font-sizes';

async function fixture(run: (root: string, file: string) => Promise<void>) {
  const base = path.resolve('.cache/settings-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-'));
  try { await run(root, path.join(root, 'settings.json')); }
  finally { assert.ok(inside(base, root) && root !== base); await rm(root, { recursive: true, force: true }); }
}

test('appearance defaults, validates writes, and serializes with unrelated preferences', () => fixture(async (root, file) => {
  for (const theme of [undefined, null, 'system', 1, {}, []]) {
    await writeFile(file, JSON.stringify({ version: 1, theme, fontSizes: { source: 18, preview: 20 }, custom: 'keep' }));
    const settings = await Settings.load(file);
    assert.equal(settings.theme(), 'dark');
    await assert.rejects(settings.saveTheme(theme), /dark or light/);
    await Promise.all([settings.saveTheme('light'), settings.saveFontSizes({ source: 21, preview: 22 }), settings.saveTheme('dark'), settings.saveTheme('light')]);
    const restored = await Settings.load(file);
    assert.equal(restored.theme(), 'light');
    assert.deepEqual(restored.fontSizes(), { source: 21, preview: 22 });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).custom, 'keep');
  }
}));

test('appearance save failure retains disk preference and permits retry', () => fixture(async (root, file) => {
  await mkdir(file);
  const blocked = await Settings.load(path.join(file, 'nested.json'));
  await rmdir(file); await writeFile(file, 'blocked');
  assert.equal((await blocked.saveTheme('light')).ok, false);
  assert.equal(blocked.theme(), 'dark');
  await rm(file); await mkdir(file);
  assert.equal((await blocked.saveTheme('light')).ok, true);
  assert.equal((await Settings.load(path.join(file, 'nested.json'))).theme(), 'light');
}));

test('font sizes recover fields independently and reject invalid writes without changing settings', () => fixture(async (root, file) => {
  assert.deepEqual((await Settings.load(file)).fontSizes(), DEFAULT_FONT_SIZES);
  for (const invalid of [null, [], 'large', -1, 9, 33, 13.5, '18']) {
    await writeFile(file, JSON.stringify({ version: 1, theme: 'dark', fontSizes: { source: invalid, preview: 24 } }));
    const settings = await Settings.load(file);
    assert.deepEqual(settings.fontSizes(), { source: 13, preview: 24 });
    const before = await readFile(file, 'utf8');
    await assert.rejects(settings.saveFontSizes({ source: 20, preview: invalid }), /whole numbers/);
    assert.equal(await readFile(file, 'utf8'), before);
  }
  const settings = await Settings.load(file);
  await Promise.all([settings.saveFontSizes({ source: 10, preview: 32 }), settings.record(root),
    settings.saveFontSizes({ source: 21, preview: 18 }), settings.saveWorkspaceSession(root, { files: ['notes.md'] })]);
  const loaded = await Settings.load(file);
  assert.deepEqual(loaded.fontSizes(), { source: 21, preview: 18 });
  assert.equal(loaded.lastProject(), root);
  assert.deepEqual(loaded.workspaceSession(root)?.files, ['notes.md']);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).theme, 'dark');
}));

test('font-size save failures report session-only use, preserve disk values, and allow retry', () => fixture(async (root, file) => {
  const settings = await Settings.load(file);
  await mkdir(file);
  assert.equal((await settings.saveFontSizes({ source: 20, preview: 18 })).ok, false);
  assert.deepEqual(settings.fontSizes(), DEFAULT_FONT_SIZES);
  await rmdir(file);
  assert.deepEqual(await settings.saveFontSizes({ source: 20, preview: 18 }), { ok: true });
  assert.deepEqual((await Settings.load(file)).fontSizes(), { source: 20, preview: 18 });
  const unsupported = JSON.stringify({ version: 99 });
  await writeFile(file, unsupported);
  const readOnly = await Settings.load(file);
  assert.deepEqual(readOnly.fontSizes(), DEFAULT_FONT_SIZES);
  assert.equal((await readOnly.saveFontSizes({ source: 22, preview: 19 })).ok, false);
  assert.equal(await readFile(file, 'utf8'), unsupported);
}));

test('recent projects persist in MRU order, deduplicate Windows paths, and retain ten entries', () => fixture(async (root, file) => {
  const settings = await Settings.load(file);
  assert.deepEqual(settings.snapshot(), { projects: [] });
  await Promise.all(Array.from({ length: 12 }, (_, i) => settings.record(path.join(root, `project${i}`))));
  assert.equal(settings.snapshot().projects.length, 10);
  assert.equal(settings.snapshot().projects[0].name, 'project11');
  const again = path.join(root, 'project5');
  await settings.record(process.platform === 'win32' ? again.toUpperCase() : again);
  assert.equal(settings.snapshot().projects.length, 10);
  assert.ok(settings.contains(again + path.sep));
  const loaded = await Settings.load(file);
  assert.deepEqual(loaded.snapshot(), settings.snapshot());
  await loaded.remove(again);
  assert.equal(loaded.snapshot().projects.length, 9);
  await loaded.clear();
  assert.deepEqual((await Settings.load(file)).snapshot().projects, []);
}));

test('settings preserve unrelated fields and project files when removing history', () => fixture(async (root, file) => {
  const project = path.join(root, 'project'); await mkdir(project);
  await writeFile(path.join(project, 'spec.md'), 'Keep me');
  await writeFile(file, JSON.stringify({ version: 1, theme: 'dark', futureWorkspace: { tabs: ['spec.md'] } }));
  const settings = await Settings.load(file);
  await settings.record(project); await settings.clear();
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.theme, 'dark'); assert.deepEqual(saved.futureWorkspace, { tabs: ['spec.md'] });
  assert.equal(await readFile(path.join(project, 'spec.md'), 'utf8'), 'Keep me');
  assert.deepEqual((await readdir(root)).sort(), ['project', 'settings.json']);
}));

test('malformed JSON is backed up before recovery and unsupported versions remain untouched', () => fixture(async (root, file) => {
  await writeFile(file, '{broken');
  const settings = await Settings.load(file);
  assert.match(settings.snapshot().warning!, /invalid JSON/);
  await settings.record(root);
  assert.equal(settings.snapshot().warning, undefined);
  const backup = (await readdir(root)).find(name => name.endsWith('.bak'))!;
  assert.equal(await readFile(path.join(root, backup), 'utf8'), '{broken');
  const future = JSON.stringify({ version: 2, something: 'future' }); await writeFile(file, future);
  const newer = await Settings.load(file); await newer.record(root);
  assert.match(newer.snapshot().warning!, /unsupported/);
  assert.equal(await readFile(file, 'utf8'), future);
}));

test('invalid recent entries are ignored without probing missing folders', () => fixture(async (root, file) => {
  const missing = path.join(root, 'missing');
  await writeFile(file, JSON.stringify({ version: 1, recentProjects: [null, {}, { path: '../outside' }, { path: missing }, { path: missing }, { path: 1 }] }));
  const settings = await Settings.load(file);
  assert.deepEqual(settings.snapshot().projects, [{ path: missing, name: 'missing' }]);
  assert.match(settings.snapshot().warning!, /ignored/);
}));

test('write failure retains the previous list and a later retry succeeds', () => fixture(async (root, file) => {
  const settings = await Settings.load(file);
  await mkdir(file); // Force atomic replacement to fail without platform-dependent chmod behavior.
  await settings.record(root);
  assert.deepEqual(settings.snapshot().projects, []);
  assert.match(settings.snapshot().warning!, /could not be saved/);
  assert.deepEqual(await readdir(root), ['settings.json']);
  await rmdir(file);
  await settings.record(root);
  assert.equal(settings.snapshot().projects.length, 1);
  assert.equal(settings.snapshot().warning, undefined);
}));

test('workspace sessions preserve tab order, active and empty states, and remain independent of recent history', () => fixture(async (root, file) => {
  const settings = await Settings.load(file);
  const session = { files: ['notes.md', 'README.md', 'src/code.ts'], activeFile: 'README.md' };
  await Promise.all([settings.record(root), settings.saveWorkspaceSession(root, session)]);
  await settings.saveWorkspaceSession(path.join(root, 'other'), { files: [] });
  await settings.clear(); await settings.flush();
  const loaded = await Settings.load(file);
  assert.deepEqual(loaded.workspaceSession(root), session);
  assert.deepEqual(loaded.workspaceSession(path.join(root, 'other')), { files: [], activeFile: undefined });
  assert.equal(loaded.lastProject(), root);
  assert.deepEqual(loaded.snapshot().projects, []);
  assert.equal(loaded.workspaceSession(path.join(root, 'new')), undefined);
}));

test('unsafe or invalid saved sessions are ignored and active tabs fall back to an available entry', () => fixture(async (root, file) => {
  for (const value of [null, {}, { files: [42] }, { files: ['../outside.md'] }, { files: ['C:\\outside.md'] },
    { files: ['/outside.md'] }, { files: ['bad\0.md'] }, { files: Array(101).fill('a.md') }]) assert.equal(parseWorkspaceSession(value), undefined);
  assert.deepEqual(parseWorkspaceSession({ files: ['a.md', 'a.md', 'b.md'], activeFile: 'gone.md' }), { files: ['a.md', 'b.md'], activeFile: 'a.md' });
  await writeFile(file, JSON.stringify({ version: 1, lastProject: '../invalid', workspaceSessions: [{ root, files: ['../escape'] }] }));
  const loaded = await Settings.load(file);
  assert.equal(loaded.lastProject(), undefined); assert.equal(loaded.workspaceSession(root), undefined);
  assert.match(loaded.snapshot().warning!, /ignored/);
}));

test('session retention is bounded and failed updates retain the previous workspace record', () => fixture(async (root, file) => {
  const settings = await Settings.load(file);
  for (let i = 0; i < 11; i++) await settings.saveWorkspaceSession(path.join(root, String(i)), { files: ['README.md'] });
  assert.equal(settings.workspaceSession(path.join(root, '0')), undefined);
  assert.deepEqual(settings.workspaceSession(path.join(root, '10'))?.files, ['README.md']);
  await rm(file); await mkdir(file);
  const failed = await settings.saveWorkspaceSession(path.join(root, '10'), { files: [] });
  assert.match(failed.warning!, /could not be saved/);
  assert.deepEqual(settings.workspaceSession(path.join(root, '10'))?.files, ['README.md']);
}));
