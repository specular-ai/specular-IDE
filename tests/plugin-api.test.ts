import assert from 'node:assert/strict';
import test from 'node:test';
import { isApiCompatible, isPackagePath, validateManifest } from '../packages/plugin-api/src/index.js';

const valid = { manifestVersion: 1, id: 'example.index', version: '1.2.3', api: '>=0.2.0 <0.3.0', entry: 'dist/index.js', capabilities: ['workspace.read', 'source.navigate'], models: ['project@1'], views: [{ id: 'index', title: 'Index', kind: 'list' }] };
test('public manifest accepts supported list, graph, timeline, and custom contracts', () => {
  assert.equal(validateManifest(valid).ok, true);
  assert.equal(validateManifest({ ...valid, api: '0.2.0', capabilities: ['workspace.read'], models: ['physical@1', 'project@1'], views: [{ id: 'graph', title: 'Graph', kind: 'graph' }] }).ok, true);
  assert.equal(validateManifest({ ...valid, views: [{ id: 'custom', title: 'Custom', kind: 'custom' }] }).ok, true);
  assert.equal(validateManifest({ ...valid, views: [{ id: 'timeline', title: 'Timeline', kind: 'timeline' }] }).ok, true);
});
test('API compatibility handles exclusive upper bounds and rejects unsupported range syntax', () => {
  for (const version of ['0.2.0', '0.2.99']) assert.equal(isApiCompatible(valid.api, version), true);
  for (const version of ['0.1.0', '0.3.0', '1.0.0', '0.2.0-beta']) assert.equal(isApiCompatible(valid.api, version), false);
  for (const range of ['*', '^0.1.0', '>=0.1.0', '>=0.2.0 <0.1.0', '>=0.1.0 <0.1.0', '00.1.0', '0.1.0+build', '9007199254740992.1.0']) assert.equal(isApiCompatible(range), false);
});
test('manifest rejects malformed fields, undeclared privileges, and duplicate contributions', () => {
  for (const bad of [null, [], {}, { ...valid, unknown: true }, { ...valid, manifestVersion: 2 }, { ...valid, id: '../bad' }, { ...valid, version: '01.0.0' }, { ...valid, api: '*' }, { ...valid, entry: 'https://example/index.js' }, { ...valid, capabilities: [] }, { ...valid, capabilities: ['workspace.read', 'network'] }, { ...valid, capabilities: ['workspace.read', 'workspace.read'] }, { ...valid, views: [] }, { ...valid, views: [valid.views[0], valid.views[0]] }, { ...valid, views: [{ ...valid.views[0], kind: 'html' }] }, { ...valid, views: [{ ...valid.views[0], title: ' ' }] }, { ...valid, views: [{ ...valid.views[0], extra: true }] }]) assert.equal(validateManifest(bad).ok, false, JSON.stringify(bad));
  for (const key of Object.keys(valid)) { const missing: Record<string, unknown> = { ...valid }; delete missing[key]; assert.equal(validateManifest(missing).ok, false, key); }
});
test('portable package paths reject traversal, absolute paths, alternate separators, and Windows devices', () => {
  for (const bad of ['', '.', '..', '../x.js', '/x.js', 'C:/x.js', 'dist\\x.js', 'dist//x.js', 'dist/./x.js', 'dist/../x.js', 'dist/NUL.js', 'dist/con', 'dist/x./a.js', '%2e%2e/x.js']) assert.equal(isPackagePath(bad), false, bad);
  assert.equal(isPackagePath('dist/my-index.v1.js'), true);
});
test('manifests declare 1-2 distinct known models, and 0.1 manifests are incompatible', () => {
  for (const models of [['physical@1'], ['project@1', 'physical@1']]) assert.equal(validateManifest({ ...valid, models }).ok, true, JSON.stringify(models));
  for (const models of [[], ['project@1', 'project@1'], ['history@1'], ['project@2'], ['project'], 'project@1', [1]]) assert.equal(validateManifest({ ...valid, models }).ok, false, JSON.stringify(models));
  const legacy = validateManifest({ ...valid, api: '>=0.1.0 <0.2.0', models: undefined });
  assert.equal(legacy.ok, false);
  assert.match(legacy.ok ? '' : legacy.errors.join(' '), /incompatible API range/);
});
