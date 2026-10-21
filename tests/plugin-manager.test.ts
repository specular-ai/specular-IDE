import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PluginManager } from '../src/core/plugin-manager';
import { inside } from '../src/core/workspace';

async function fixture(run: (root: string, source: string, store: string) => Promise<void>) {
  const base = path.resolve('.cache/plugin-manager-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-')), source = path.join(root, 'source'), store = path.join(root, 'installed'); await mkdir(source);
  try { await run(root, source, store); }
  finally { assert.ok(inside(base, root) && root !== base); await rm(root, { recursive: true, force: true }); }
}
async function plugin(source: string, version = '1.0.0', code = 'export function render(){}') {
  await writeFile(path.join(source, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(source, 'specular-plugin.json'), JSON.stringify({ manifestVersion: 1, id: 'test.installed', version, api: '0.2.0', entry: 'dist/index.js', capabilities: ['workspace.read'], models: ['project@1'], views: [{ id: 'index', title: 'Installed test', kind: 'list' }] }));
  await mkdir(path.join(source, 'dist'), { recursive: true }); await writeFile(path.join(source, 'dist/index.js'), code);
}
function zip(entries: Record<string, string>) {
  const table = Array.from({ length: 256 }, (_, n) => { let value = n; for (let i = 0; i < 8; i++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1; return value >>> 0; });
  const crc = (data: Buffer) => { let value = 0xffffffff; for (const byte of data) value = table[(value ^ byte) & 255] ^ (value >>> 8); return (value ^ 0xffffffff) >>> 0; };
  const locals: Buffer[] = [], centrals: Buffer[] = []; let offset = 0;
  for (const [filename, content] of Object.entries(entries)) {
    const name = Buffer.from(filename), data = Buffer.from(content), checksum = crc(data);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data); centrals.push(central, name); offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(entries).length, 8); end.writeUInt16LE(Object.keys(entries).length, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

test('installed plugins survive restart and retain enable state', () => fixture(async (_root, source, store) => {
  await plugin(source); const manager = await PluginManager.load(store); const installed = await manager.install(source);
  assert.equal(installed.installed, true); assert.equal(manager.package('test.installed')?.manifest.version, '1.0.0');
  await manager.setEnabled('test.installed', false);
  const restarted = await PluginManager.load(store); assert.equal(restarted.list()[0].enabled, false); assert.equal(restarted.package('test.installed'), undefined);
  await restarted.setEnabled('test.installed', true); assert.equal(restarted.package('test.installed')?.manifest.id, 'test.installed');
}));

test('bundles default on, preserve disable across upgrades, and restore after replacements fail', () => fixture(async (root, source, store) => {
  await plugin(source); let manager = await PluginManager.load(store, [source]);
  assert.equal(manager.list()[0].origin, 'bundled'); assert.equal(manager.list()[0].enabled, true);
  await manager.setEnabled('test.installed', false); await plugin(source, '1.1.0');
  manager = await PluginManager.load(store, [source]);
  assert.equal(manager.list()[0].manifest.version, '1.1.0'); assert.equal(manager.package('test.installed'), undefined);
  const replacement = path.join(root, 'replacement'); await mkdir(replacement); await plugin(replacement, '2.0.0');
  assert.equal((await manager.install(replacement)).installed, false);
  await manager.install(replacement, true); assert.equal(manager.list()[0].enabled, false);
  manager = await PluginManager.load(store, [source]);
  assert.equal(manager.list()[0].origin, 'installed'); assert.equal(manager.list()[0].manifest.version, '2.0.0');
  await manager.setEnabled('test.installed', true);
  await rm(path.join(store, 'test.installed/dist/index.js'));
  manager = await PluginManager.load(store, [source]);
  assert.equal(manager.list()[0].status, 'invalid'); assert.equal(manager.package('test.installed'), undefined);
  await manager.restoreBundled('test.installed');
  assert.equal(manager.package('test.installed')?.manifest.version, '1.1.0');
  await assert.rejects(manager.uninstall('test.installed'), /disabled or restored/);
  await manager.setEnabled('test.installed', false); await manager.restoreBundled('test.installed');
  manager = await PluginManager.load(store, [source]); assert.equal(manager.list()[0].enabled, false);
}));

test('preexisting user identity wins over a new bundle and duplicate bundles are rejected', () => fixture(async (_root, source, store) => {
  await plugin(source, '2.0.0'); const original = await PluginManager.load(store); await original.install(source);
  await plugin(source, '1.0.0'); const manager = await PluginManager.load(store, [source]);
  assert.equal(manager.package('test.installed')?.manifest.version, '2.0.0'); assert.equal(manager.list()[0].bundledVersion, '1.0.0');
  await assert.rejects(PluginManager.load(store, [source, source]), /Duplicate bundled/);
}));

test('replacement is explicit and a failed candidate preserves the working package', () => fixture(async (_root, source, store) => {
  await plugin(source, '1.0.0', 'export const marker="original"'); const manager = await PluginManager.load(store); await manager.install(source);
  await plugin(source, '2.0.0', 'export const marker="replacement"');
  const collision = await manager.install(source); assert.equal(collision.installed, false); assert.equal(manager.package('test.installed')?.manifest.version, '1.0.0');
  await rm(path.join(source, 'dist/index.js'));
  await assert.rejects(manager.install(source, true)); assert.equal(manager.package('test.installed')?.manifest.version, '1.0.0');
  assert.equal((await readFile(path.join(store, 'test.installed/dist/index.js'), 'utf8')), 'export const marker="original"');
}));

test('uninstall removes only the managed package', () => fixture(async (root, source, store) => {
  const project = path.join(root, 'project.md'); await writeFile(project, 'unsaved project source'); await plugin(source);
  const manager = await PluginManager.load(store); await manager.install(source); await manager.uninstall('test.installed');
  assert.deepEqual(manager.list(), []); assert.equal(await readFile(project, 'utf8'), 'unsaved project source');
}));

test('zip installation accepts a valid package and rejects traversal without writing outside storage', () => fixture(async (root, _source, store) => {
  const manifest = JSON.stringify({ manifestVersion: 1, id: 'test.installed', version: '1.0.0', api: '0.2.0', entry: 'dist/index.js', capabilities: ['workspace.read'], models: ['project@1'], views: [{ id: 'index', title: 'Archive', kind: 'list' }] });
  const valid = path.join(root, 'valid.zip'); await writeFile(valid, zip({ 'package.json': '{"type":"module"}', 'specular-plugin.json': manifest, 'dist/index.js': 'export function render(){}' }));
  const manager = await PluginManager.load(store); assert.equal((await manager.install(valid)).installed, true);
  const malicious = path.join(root, 'malicious.zip'); await writeFile(malicious, zip({ '../escape.js': 'escaped', 'package.json': '{"type":"module"}', 'specular-plugin.json': manifest, 'dist/index.js': 'x' }));
  await assert.rejects(manager.install(malicious, true)); await assert.rejects(readFile(path.join(store, 'escape.js')));
  assert.equal(manager.package('test.installed')?.manifest.version, '1.0.0');
}));
