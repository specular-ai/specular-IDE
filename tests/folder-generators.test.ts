import { test } from 'node:test';
import assert from 'node:assert/strict';
import { previewFolderGenerators, provenanceKey, validateFolderGenerators, type FolderGenerator } from '../src/core/folder-generators';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, type IdConfiguration } from '../src/core/id-configuration';
import { assignFeatures } from '../src/core/features';
import { assignModules } from '../src/core/modules';

const config: IdConfiguration = { version: 1, categories: [{ key: 'req', name: 'Requirements', idScopes: [{ pattern: 'specs/*' }] }], rules: [{ key: 'req', category: 'req', prefix: 'FR' }] };
const generator: FolderGenerator = { key: 'features', target: 'features', pattern: 'specs/*', exclusions: [] };
const docs = { 'specs/authentication/main.md': '# FR-001 Authentication\nFR-002', 'specs/authentication/nested/extra.markdown': '# FR-002 Nested',
  'specs/reporting/main.md': '# FR-001 Reporting\nFR-999', 'specs/overview.md': '# FR-003 Overview', 'specs/empty/main.md': 'Just prose.' };
function preview(documents = docs as Record<string, string>, configuration = config, generators = [generator], previous: Parameters<typeof previewFolderGenerators>[4] = []) {
  const matcher = compileIdMatcher(configuration), index = assignFeatures(assignModules(buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, matcher))), configuration), configuration);
  return previewFolderGenerators(generators, Object.keys(documents), index, configuration, previous);
}

test('folder previews include descendant definitions, preserve scoped identities and ignore mentions and root files', () => {
  const before = JSON.stringify([docs, config, generator]), result = preview();
  assert.deepEqual(result.entries.map(entry => entry.name), ['authentication', 'empty', 'reporting']);
  const [auth, empty, reporting] = result.entries;
  assert.equal(auth.files, 2); assert.equal(auth.members.length, 2); assert.equal(empty.members.length, 0);
  assert.notEqual(auth.members[0].key, reporting.members[0].key);
  assert.ok(auth.members.every(member => member.state === 'assigned'));
  assert.equal(reporting.members.length, 1); assert.ok(!JSON.stringify(result).includes('FR-999'));
  assert.equal(JSON.stringify([docs, config, generator]), before);
  assert.deepEqual(preview(Object.fromEntries(Object.entries(docs).reverse())), result);
  assert.deepEqual(preview(docs, config, [] ).entries, []); // ID scope settings never create features.
});

test('modules are independent; explicit overrides including empty assignments supersede generation', () => {
  const configuration = { ...config, features: [{ key: 'manual', name: 'Manual' }],
    featureOverrides: [{ id: 'FR-001', scope: 'specs/authentication', features: [] }] };
  const result = preview(docs, configuration, [generator, { ...generator, key: 'modules', target: 'modules' }]);
  const auth = result.entries.filter(entry => entry.name === 'authentication');
  assert.equal(auth[0].members[0].state, 'override'); assert.equal(auth[1].members[0].state, 'assigned');
  assert.deepEqual(configuration.features, [{ key: 'manual', name: 'Manual' }]);
});

test('duplicate definition conflicts include definitions outside the pattern and exclusions', () => {
  const unscoped = { ...config, categories: [{ key: 'req', name: 'Requirements' }] };
  const result = preview({ ...docs, 'other.md': '# FR-002 Outside' }, unscoped);
  assert.ok(result.entries[0].members.every(member => member.state === 'conflict'));
  assert.match(result.entries[0].issues.join(), /Duplicate/);
  const excluded = preview(docs, config, [{ ...generator, exclusions: ['specs/authentication/nested', 'specs/empty'] }]);
  assert.deepEqual(excluded.entries.map(entry => entry.name), ['authentication', 'reporting']);
  assert.equal(excluded.entries[0].members.length, 1);
});

test('provenance survives display-name edits; removals and possible renames retain previous entries for review', () => {
  const previous = preview().entries; previous[0].name = 'Sign in';
  const same = preview(docs, config, [generator], previous);
  assert.equal(same.entries[0].name, 'Sign in'); assert.equal(same.entries[0].change, 'existing');
  assert.equal(provenanceKey(same.entries[0].provenance), provenanceKey(previous[0].provenance));
  const renamed = Object.fromEntries(Object.entries(docs).map(([file, text]) => [file.replace('authentication', 'login'), text]));
  const result = preview(renamed, config, [generator], previous);
  const retained = result.entries.find(entry => entry.name === 'Sign in')!;
  assert.equal(retained.change, 'retained'); assert.equal(retained.members.length, 0); assert.match(retained.issues.join(), /rename/);
  assert.equal(result.entries.find(entry => entry.name === 'login')!.change, 'new');
  assert.ok(preview(docs, config, [], previous).entries.every(entry => entry.change === 'retained'));
});

test('generation cannot hide an existing manual membership conflict between definitions in the same folder', () => {
  const configuration: IdConfiguration = { ...config, features: [{ key: 'manual', name: 'Manual' }], modules: [{ key: 'manual', name: 'Manual' }],
    featureRules: [{ key: 'one', scope: 'file', path: 'specs/a/one.md', features: ['manual'] }],
    moduleRules: [{ key: 'one', scope: 'file', path: 'specs/a/one.md', modules: ['manual'] }] };
  const result = preview({ 'specs/a/one.md': '# FR-1', 'specs/a/two.md': '# FR-1' }, configuration, [generator, { ...generator, key: 'modules', target: 'modules' }]);
  assert.ok(result.entries.every(entry => entry.members[0].state === 'conflict'));
});

test('manual and generated name collisions are visible without merging entries', () => {
  const result = preview({ ...docs, 'other/authentication/main.md': '# FR-7 Other' }, { ...config, features: [{ key: 'manual', name: 'Reporting' }] },
    [generator, { ...generator, key: 'other', pattern: 'other/*' }]);
  assert.equal(result.entries.filter(entry => entry.issues.some(issue => issue.includes('Name collision'))).length, 3);
});

test('path validation rejects unsafe paths, same-target overlaps and malformed settings', () => {
  for (const pattern of ['../specs/*', '/specs/*', 'C:/specs/*', 'specs\\*', 'specs/**', 'specs/*/nested', '.git/*', 'specs/node_modules/*', './specs/*'])
    assert.throws(() => validateFolderGenerators([{ ...generator, pattern }]));
  for (const exclusions of [['other/folder'], ['specs/../outside'], ['specs/a', 'specs/A'], ['specs/a/*']])
    assert.throws(() => validateFolderGenerators([{ ...generator, exclusions }]));
  assert.throws(() => validateFolderGenerators([generator, { ...generator, key: 'nested', pattern: 'specs/a/*' }]), /overlap/);
  assert.throws(() => validateFolderGenerators([generator, generator]), /unique/);
  assert.throws(() => validateFolderGenerators([{ ...generator, unknown: true }]));
  assert.doesNotThrow(() => validateFolderGenerators([generator, { ...generator, key: 'modules', target: 'modules' }]));
});

test('scanner exclusions, empty results, stale definition sources and bounded output are explicit', () => {
  const matcher = compileIdMatcher(config), empty = buildIndex([]);
  const excluded = previewFolderGenerators([generator], ['specs/node_modules/a.md', 'specs/a/dist/b.md', 'specs/overview.md', 'specs/a/image.png'], empty, config);
  assert.deepEqual(excluded.entries, []); assert.match(excluded.notices[0], /No matching/);
  const index = buildIndex([analyzeDocument('specs/a/main.md', '# FR-1', matcher)]);
  assert.throws(() => previewFolderGenerators([generator], [], index, config), /stale/);
  assert.throws(() => previewFolderGenerators([generator], ['specs/a/main.md'], { ...index, definitions: Array(20001).fill(index.definitions[0]) }, config), /20,000/);
  assert.throws(() => previewFolderGenerators([generator], Array.from({ length: 65 }, (_, n) => `specs/f${n}/main.md`), empty, config), /64 features/);
  assert.throws(() => previewFolderGenerators([generator], Array(10001).fill('a.md'), empty, config), /limit/);
  assert.throws(() => validateFolderGenerators(Array.from({ length: 33 }, (_, n) => ({ ...generator, key: `generator${n}`, pattern: `specs${n}/*` }))), /32/);
  const longName = previewFolderGenerators([generator], [`specs/${'a'.repeat(129)}/main.md`], empty, config);
  assert.match(longName.entries[0].issues.join(), /128-character/);
});
