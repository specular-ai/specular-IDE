import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { inside, Workspace } from '../src/core/workspace';

async function fixture(run: (root: string, workspace: Workspace) => Promise<void>) {
  const base = path.resolve('.cache', 'unit-tests');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'project-'));
  try { await run(root, await Workspace.open(root)); }
  finally { assert.ok(inside(base, root) && root !== base); await rm(root, { recursive: true, force: true }); }
}

test('creates empty root Markdown files that can be saved and discovered', async () => fixture(async (root, workspace) => {
  const document = await workspace.createMarkdown('Design notes');
  assert.equal(document.path, 'Design notes.md');
  assert.equal(await readFile(path.join(root, document.path), 'utf8'), '');
  assert.deepEqual(await workspace.read(document.path), document);
  assert.ok((await workspace.save(document.path, '# REQ-201\n\nA new requirement.\n', document.version)).ok);
  assert.equal((await workspace.snapshot()).documents[document.path], '# REQ-201\n\nA new requirement.\n');
  assert.equal((await workspace.createMarkdown('Résumé.MD')).path, 'Résumé.MD');
}));

test('rejects unsafe or invalid Windows names without creating any files', async () => fixture(async (root, workspace) => {
  for (const name of ['', ' ', '.', '..', '.md', ' notes', 'notes ', 'notes.', '../escape.md', 'docs/spec.md', 'docs\\spec.md',
    'C:\\escape.md', '//server/share.md', 'bad:name.md', 'bad?.md', 'bad*.md', 'bad".md', 'bad<.md', 'bad|.md',
    'bad\0.md', 'bad\n.md', 'CON', 'nul.md', 'COM1.md', 'LPT9.md', 'COM¹.md', 'CON .md', 'CONIN$.md', 'notes.txt', 'a'.repeat(253)]) {
    await assert.rejects(() => workspace.createMarkdown(name), name);
  }
  assert.deepEqual(await readdir(root), []);
}));

test('exclusive creation preserves existing files, directories, links, and concurrent winners', async () => fixture(async (root, workspace) => {
  await writeFile(path.join(root, 'existing.md'), 'Keep this content');
  await assert.rejects(() => workspace.createMarkdown('existing'), /already exists/);
  if (process.platform === 'win32') await assert.rejects(() => workspace.createMarkdown('EXISTING.MD'), /already exists/);
  assert.equal(await readFile(path.join(root, 'existing.md'), 'utf8'), 'Keep this content');
  await mkdir(path.join(root, 'folder.md'));
  await assert.rejects(() => workspace.createMarkdown('folder.md'));
  await symlink(path.dirname(root), path.join(root, 'external.md'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => workspace.createMarkdown('external.md'));
  const attempts = await Promise.allSettled([workspace.createMarkdown('race'), workspace.createMarkdown('race')]);
  assert.equal(attempts.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(await readFile(path.join(root, 'race.md'), 'utf8'), '');
}));

test('saves Markdown with its BOM and CRLF encoding and a new content version', async () => fixture(async (root, workspace) => {
  await writeFile(path.join(root, 'spec.md'), '\uFEFF# REQ-001\r\n\r\nOriginal.\r\n');
  const document = await workspace.read('spec.md');
  assert.ok(!document.text.startsWith('\uFEFF'));
  const result = await workspace.save('spec.md', '# REQ-001\n\nChanged.\n', document.version);
  assert.ok(result.ok);
  assert.equal(await readFile(path.join(root, 'spec.md'), 'utf8'), '\uFEFF# REQ-001\r\n\r\nChanged.\r\n');
  assert.notEqual(result.document.version, document.version);
}));

test('an external edit prevents saving a stale document', async () => fixture(async (root, workspace) => {
  await writeFile(path.join(root, 'spec.md'), 'Original');
  const document = await workspace.read('spec.md');
  await writeFile(path.join(root, 'spec.md'), 'External update');
  const result = await workspace.save('spec.md', 'Unsaved editor text', document.version);
  assert.equal(result.ok, false);
  assert.equal(await readFile(path.join(root, 'spec.md'), 'utf8'), 'External update');
}));

test('project traversal, absolute paths, and external directory links are rejected', async () => fixture(async (root, workspace) => {
  await assert.rejects(() => workspace.read('../outside.md'), /outside/);
  await assert.rejects(() => workspace.read(path.resolve(root, 'spec.md')), /relative/);
  // Junction creation does not require Windows symbolic-link privileges.
  const outside = path.dirname(root);
  await symlink(outside, path.join(root, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => workspace.resolve('external'), /outside/);
  assert.equal((await workspace.snapshot()).files.length, 0);
  assert.deepEqual((await workspace.snapshot()).folders, []);
}));

test('relative file links and fragments resolve, while remote links do not execute', async () => fixture(async (root, workspace) => {
  await mkdir(path.join(root, 'docs'));
  await writeFile(path.join(root, 'design notes.md'), '# States');
  assert.deepEqual(await workspace.resolveLink('docs/requirements.md', '../design%20notes.md#states'), { path: 'design notes.md', anchor: 'states' });
  await assert.rejects(() => workspace.resolveLink('spec.md', 'javascript:alert(1)'), /Only links/);
  await assert.rejects(() => workspace.resolveLink('spec.md', 'https://example.com'), /Only links/);
}));

test('index excludes dependency folders, marks configuration, and lists code read-only', async () => fixture(async (root, workspace) => {
  await mkdir(path.join(root, 'node_modules'));
  await writeFile(path.join(root, 'node_modules', 'noise.md'), '# REQ-999');
  await writeFile(path.join(root, 'AGENTS.md'), 'Instructions');
  await writeFile(path.join(root, 'code.ts'), 'export const value = 1;');
  const snapshot = await workspace.snapshot();
  assert.deepEqual(snapshot.files.map(file => file.path), ['AGENTS.md', 'code.ts']);
  assert.ok(snapshot.files[0].configuration);
  const document = await workspace.read('code.ts');
  await assert.rejects(() => workspace.save('code.ts', 'changed', document.version), /read-only/);
  await assert.rejects(() => workspace.read('node_modules/noise.md'), /excluded/);
}));

test('invalid UTF-8 and binary content are rejected rather than rewritten', async () => fixture(async (root, workspace) => {
  await writeFile(path.join(root, 'binary.md'), Buffer.from([0, 1, 2]));
  await writeFile(path.join(root, 'latin.md'), Buffer.from([0xff, 0xfe, 0x41]));
  await assert.rejects(() => workspace.read('binary.md'), /Binary/);
  await assert.rejects(() => workspace.read('latin.md'), /UTF-8/);
}));

test('discovers nested and empty folders without including excluded directories', async () => fixture(async (root, workspace) => {
  await mkdir(path.join(root, 'docs', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'empty'));
  await mkdir(path.join(root, 'docs', 'node_modules'));
  await writeFile(path.join(root, 'docs', 'nested', 'spec.md'), '# REQ-001');
  await writeFile(path.join(root, 'docs', 'spec.md'), '# REQ-002');
  await writeFile(path.join(root, 'docs', 'node_modules', 'hidden.md'), '# REQ-003');
  const snapshot = await workspace.snapshot();
  assert.deepEqual(snapshot.folders, ['docs', 'docs/nested', 'empty']);
  assert.deepEqual(snapshot.files.map(file => file.path), ['docs/nested/spec.md', 'docs/spec.md']);
  assert.equal(Object.keys(snapshot.documents).length, 2);
}));
