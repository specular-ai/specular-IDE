import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { compileIdMatcher, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { assignFeatures, removeProjectFeature } from '../src/core/features';
import { assignModules } from '../src/core/modules';
import { removeProjectModule } from '../src/core/module-rule-editing';
import { stageFolderUpdate, type GeneratorTarget } from '../src/core/folder-generators';
import { ProjectConfigurationStore } from '../src/core/project-configuration';

const config: IdConfiguration = { version: 1, categories: [{ key: 'req', name: 'Requirements', idScopes: [{ pattern: 'specs/*' }] }], rules: [{ key: 'req', category: 'req', prefix: 'FR' }],
  folderGenerators: [{ key: 'features', target: 'features', pattern: 'specs/*', exclusions: [] }, { key: 'modules', target: 'modules', pattern: 'specs/*', exclusions: [] }],
  features: [{ key: 'manual', name: 'Manual feature' }], modules: [{ key: 'manual', name: 'Manual module' }],
  featureRules: [{ key: 'manual', scope: 'folder', path: 'specs/a', features: ['manual'] }],
  moduleOverrides: [{ id: 'FR-1', scope: 'specs/a', modules: ['manual'] }] };
const docs: Record<string, string> = { 'specs/a/main.md': '# FR-1 A\nFR-2', 'specs/a/nested/extra.markdown': '# FR-2 Extra', 'specs/b/main.md': '# FR-1 B', 'specs/overview.md': '# FR-3 Overview', 'notes.md': 'FR-999' };
function index(configuration: IdConfiguration, documents = docs) {
  const match = compileIdMatcher(configuration);
  return assignFeatures(assignModules(buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, match))), configuration), configuration);
}
function update(configuration = config, target: GeneratorTarget = 'features', documents = docs) {
  return stageFolderUpdate(configuration, target, Object.keys(documents), index(configuration, documents));
}
function both() { return update(update().configuration!, 'modules').configuration!; }

test('explicit updates preserve manual rules and scoped overrides, union live mappings, and are idempotent', () => {
  const before = JSON.stringify(config), draft = both();
  assert.equal(JSON.stringify(config), before); assert.equal(draft.generatedFolders?.length, 4);
  assert.deepEqual(validateIdConfiguration(draft), draft);
  assert.deepEqual(update(update(draft).configuration!, 'modules').configuration, draft);
  assert.deepEqual(draft.featureRules, config.featureRules); assert.deepEqual(draft.moduleOverrides, config.moduleOverrides);
  const result = index(draft), a = result.definitions.find(item => item.file === 'specs/a/main.md')!;
  assert.deepEqual(a.featureAssignment?.features.map(item => item.name).sort(), ['Manual feature', 'a']);
  assert.deepEqual(a.moduleAssignment?.modules.map(item => item.name), ['Manual module']);
  assert.equal(result.definitions.find(item => item.file === 'specs/b/main.md')?.featureAssignment?.features[0].name, 'b');
  assert.equal(result.references.find(item => item.id === 'FR-2')?.featureAssignment?.features.length, 2);
  assert.deepEqual(result.references.find(item => item.id === 'FR-999')?.featureAssignment?.features, []);
  assert.deepEqual(result.definitions.find(item => item.file === 'specs/overview.md')?.featureAssignment?.features, []);
});

test('new folders require an update, while new definitions in saved folders participate immediately', () => {
  const draft = both(), changed = { ...docs, 'specs/c/main.md': '# FR-7 New', 'specs/b/new.md': '# FR-8 Existing folder' };
  const result = index(draft, changed);
  assert.deepEqual(result.definitions.find(item => item.id === 'FR-7')?.featureAssignment?.features, []);
  assert.equal(result.definitions.find(item => item.id === 'FR-8')?.featureAssignment?.features[0].name, 'b');
  const next = update(draft, 'features', changed).configuration!;
  assert.equal(index(next, changed).definitions.find(item => item.id === 'FR-7')?.featureAssignment?.features[0].name, 'c');
  assert.equal(next.modules!.length, draft.modules!.length);
});

test('generator edits keep applied mappings frozen until update; renamed display names and retained mappings survive', () => {
  const draft = both(), mapping = draft.generatedFolders!.find(item => item.target === 'features' && item.folder === 'specs/a')!;
  draft.features!.find(item => item.key === mapping.entry)!.name = 'Sign in';
  draft.folderGenerators![0].exclusions = ['specs/a/nested'];
  assert.equal(index(draft).definitions.find(item => item.id === 'FR-2')?.featureAssignment?.features.length, 2);
  const next = update(draft).configuration!;
  assert.deepEqual(index(next).definitions.find(item => item.id === 'FR-2')?.featureAssignment?.features.map(item => item.name), ['Manual feature']);
  assert.equal(next.features!.find(item => item.key === mapping.entry)!.name, 'Sign in');
  const moved = Object.fromEntries(Object.entries(docs).map(([file, text]) => [file.replace('specs/b/', 'specs/renamed/'), text]));
  const retained = update(next, 'features', moved);
  assert.equal(retained.preview.entries.find(entry => entry.name === 'b')?.change, 'retained');
  assert.ok(retained.configuration!.generatedFolders!.some(item => item.folder === 'specs/b'));
  assert.ok(retained.configuration!.generatedFolders!.some(item => item.folder === 'specs/renamed'));
  next.folderGenerators = [];
  assert.deepEqual(update(next).configuration?.generatedFolders, next.generatedFolders);
});

test('name collisions stage nothing; resolving a manual name allows explicit update', () => {
  const collision = structuredClone(config); collision.features![0].name = 'a';
  const result = update(collision); assert.equal(result.configuration, undefined); assert.ok(result.preview.entries.some(entry => entry.blocked));
  assert.equal(collision.generatedFolders, undefined);
  collision.features![0].name = 'Manual'; assert.ok(update(collision).configuration);
});

test('generated duplicate conflicts stay explicit and exact empty overrides take precedence', () => {
  const unscoped = { ...both(), categories: [{ key: 'req', name: 'Requirements' }] };
  const result = index(unscoped); assert.equal(result.definitions[0].featureAssignment?.state, 'conflict');
  const overridden = { ...unscoped, featureOverrides: [{ id: 'FR-1', features: [] }] };
  assert.equal(index(overridden).definitions[0].featureAssignment?.state, 'unassigned');
  assert.equal(update(overridden).preview.entries[0].members[0].state, 'override');
});

test('schema rejects forged mappings, unknown targets, duplicated provenance and editable generated rules', () => {
  const draft = both(), mapping = draft.generatedFolders![0];
  for (const patch of [{ folder: '../outside' }, { folder: 'specs/a/nested' }, { entry: 'missing' }, { target: 'statuses' }, { unexpected: true }, { exclusions: ['outside'] }])
    assert.throws(() => validateIdConfiguration({ ...draft, generatedFolders: [{ ...mapping, ...patch }] }));
  assert.throws(() => validateIdConfiguration({ ...draft, generatedFolders: [mapping, mapping] }), /unique/);
  assert.throws(() => validateIdConfiguration({ ...draft, featureRules: [{ key: 'bad', scope: 'folder', path: 'specs', features: [mapping.entry] }] }), /manual file rules/);
  const moduleMapping = draft.generatedFolders!.find(item => item.target === 'modules')!;
  removeProjectFeature(draft, mapping.entry); removeProjectModule(draft, moduleMapping.entry);
  assert.doesNotThrow(() => validateIdConfiguration(draft));
  assert.ok(!draft.generatedFolders!.some(item => item.target === 'features' && item.entry === mapping.entry));
});

test('saved generators and provenance round-trip; stale writes, duplicate saves and failed source checks are atomic', async () => {
  await mkdir('.cache', { recursive: true }); const root = await mkdtemp(path.resolve('.cache/folder-update-'));
  const store = new ProjectConfigurationStore(root), initial = await store.load(), draft = both();
  const saved = await store.save(draft, initial.diskVersion), file = path.join(root, '.specular/project.json');
  assert.deepEqual((await new ProjectConfigurationStore(root).load()).configuration, draft);
  const bytes = await readFile(file, 'utf8');
  await assert.rejects(store.save({ ...draft, folderGenerators: [] }, initial.diskVersion), /changed on disk/);
  await assert.rejects(store.save({ ...draft, folderGenerators: [] }, saved.diskVersion, async () => { throw new Error('Sources changed'); }), /Sources changed/);
  assert.equal(await readFile(file, 'utf8'), bytes);
  const outcomes = await Promise.allSettled([store.save({ ...draft, folderGenerators: [] }, saved.diskVersion), store.save(draft, saved.diskVersion)]);
  assert.deepEqual(outcomes.map(outcome => outcome.status), ['fulfilled', 'rejected']);
  const final = await new ProjectConfigurationStore(root).load(); assert.deepEqual(final.configuration.generatedFolders, draft.generatedFolders);
});
