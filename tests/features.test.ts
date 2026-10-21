import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { idKey } from '../src/core/id-identity';
import { assignFeatures, removeProjectFeature, editFeatureOverride, mergeFeatureOverride, editFeatureFileRule, removeFeatureFileRule } from '../src/core/features';
import { validateIdConfiguration, compileIdMatcher, LEGACY_ID_CONFIGURATION, type IdConfiguration } from '../src/core/id-configuration';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { assignModules } from '../src/core/modules';
import { overridesForCategories } from '../src/core/category-overrides';
import { ProjectConfigurationStore } from '../src/core/project-configuration';

const config: IdConfiguration = {
  version: 1, categories: [{ key: 'req', name: 'Requirements', idScopes: [{ pattern: 'specs/*', enabled: true }] }],
  rules: [{ key: 'req', category: 'req', prefix: 'REQ' }],
  features: [{ key: 'auth', name: 'Authentication' }, { key: 'audit', name: 'Audit' }],
  featureOverrides: [{ id: 'REQ-1', scope: 'specs/a', features: ['auth', 'audit'] }],
  modules: [{ key: 'gui', name: 'GUI' }, { key: 'api', name: 'API' }],
  moduleOverrides: [{ id: 'REQ-1', scope: 'specs/a', modules: ['gui', 'api'] }],
};
function index(configuration = config) {
  const match = compileIdMatcher(configuration);
  return assignFeatures(assignModules(buildIndex([
    analyzeDocument('specs/a/main.md', '# REQ-1 First\nREQ-1\n', match),
    analyzeDocument('specs/b/main.md', '# REQ-1 Second\nREQ-1\n', match),
    analyzeDocument('root.md', 'REQ-1\n', match),
  ]), configuration), configuration);
}
test('feature memberships use scoped identity on every occurrence and remain independent of modules', () => {
  const initial = index();
  for (const item of [...initial.definitions, ...initial.references]) {
    assert.deepEqual(item.featureAssignment?.features.map(f => f.key), item.scope === 'specs/a' ? ['audit', 'auth'] : []);
    if (item.scope === 'specs/a') assert.equal(item.moduleAssignment?.modules.length, 2);
  }
  const changed = structuredClone(config); changed.features![0].name = 'Sign in';
  assert.equal(index(changed).definitions[0].featureAssignment?.features[1].name, 'Sign in');
  removeProjectFeature(changed, 'auth'); assert.deepEqual(changed.featureOverrides![0].features, ['audit']);
  removeProjectFeature(changed, 'audit'); assert.deepEqual(changed.featureOverrides![0].features, []);
  const cleared = index(changed).definitions[0]; assert.deepEqual(cleared.featureAssignment, { explicit: true, state: 'unassigned', features: [], evidence: [{ kind: 'id-override', id: 'REQ-1', features: [] }] });
  assert.deepEqual(cleared.moduleAssignment, initial.definitions[0].moduleAssignment);
  assert.deepEqual(cleared.category, initial.definitions[0].category);
  assert.deepEqual(overridesForCategories(config, ['req']), [idKey(config.moduleOverrides![0]), idKey(config.featureOverrides![0])]);
});
test('feature validation accepts old and empty configurations and rejects invalid membership data', () => {
  assert.deepEqual(validateIdConfiguration(LEGACY_ID_CONFIGURATION), LEGACY_ID_CONFIGURATION);
  assert.deepEqual(validateIdConfiguration(config), config);
  assert.doesNotThrow(() => validateIdConfiguration({ ...config, features: [], featureOverrides: [] }));
  for (const patch of [
    { features: [{ key: 'auth', name: '' }] }, { features: [config.features![0], config.features![0]] },
    { featureOverrides: [{ id: 'REQ-1', features: ['missing'] }] },
    { featureOverrides: [{ id: 'REQ-1', features: ['auth', 'auth'] }] },
    { featureOverrides: [{ id: 'REQ-1', scope: '../bad', features: [] }] },
    { featureOverrides: [config.featureOverrides![0], config.featureOverrides![0]] },
    { featureOverrides: [{ id: '', features: [] }] },
    { features: [{ key: 'auth', name: 'Auth', unexpected: true }] },
  ]) assert.throws(() => validateIdConfiguration({ ...config, ...patch }));
  assert.doesNotThrow(() => validateIdConfiguration({ ...config, featureOverrides: [...config.featureOverrides!, { id: 'REQ-1', scope: 'specs/b', features: [] }] }));
});
test('feature configuration survives restart, isolates projects, and preserves disk content on rejected saves', async () => {
  await mkdir('.cache/feature-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.cache/feature-tests/project-')), other = await mkdtemp(path.resolve('.cache/feature-tests/other-'));
  const store = new ProjectConfigurationStore(root), saved = await store.save(config, 'absent');
  assert.deepEqual((await new ProjectConfigurationStore(root).load()).configuration, config);
  assert.equal((await new ProjectConfigurationStore(other).load()).configuration.features, undefined);
  const file = path.join(root, '.specular/project.json');
  await writeFile(file, JSON.stringify({ ...config, features: [] })); const before = await readFile(file, 'utf8');
  await assert.rejects(store.save(config, saved.diskVersion), /changed on disk/);
  assert.equal(await readFile(file, 'utf8'), before);
  const invalid = await store.load(); assert.deepEqual(invalid.configuration, config); assert.ok(invalid.warning);
  await assert.rejects(store.save({ ...config, featureOverrides: [{ id: '', features: [] }] }, invalid.diskVersion));
  assert.equal(await readFile(file, 'utf8'), before);
});


test('feature-owned selector edits split shared memberships and completed selectors merge by scope', () => {
  const draft = structuredClone(config), shared = draft.featureOverrides![0];
  const owned = editFeatureOverride(draft, shared, 'auth', 'REQ-1', 'specs/b');
  assert.deepEqual(shared.features, ['audit']); assert.deepEqual(owned.features, ['auth']);
  assert.equal(draft.featureOverrides!.length, 2);
  editFeatureOverride(draft, owned, 'auth', 'REQ-1', 'specs/a');
  assert.equal(mergeFeatureOverride(draft, owned), shared);
  assert.deepEqual(shared.features, ['audit', 'auth']); assert.equal(draft.featureOverrides!.length, 1);
});


test('feature file/folder rules combine definitions, ignore mentions and honor scoped overrides and conflicts', () => {
  const draft = structuredClone(config); draft.featureOverrides = [];
  draft.featureRules = [{ key: 'auth', path: 'specs/a', scope: 'folder', features: ['auth'] }, { key: 'audit', path: 'specs/a/main.md', scope: 'file', features: ['audit'] }];
  validateIdConfiguration(draft);
  const assigned = index(draft);
  assert.deepEqual(assigned.definitions[0].featureAssignment?.features.map(f => f.key), ['audit', 'auth']);
  assert.deepEqual(assigned.definitions[1].featureAssignment?.features, []);
  assert.deepEqual(assigned.references.find(r => r.file === 'root.md')?.featureAssignment?.features, []);
  draft.featureOverrides = [{ id: 'REQ-1', scope: 'specs/a', features: [] }];
  assert.deepEqual(index(draft).definitions[0].featureAssignment?.features, []);
  draft.featureOverrides = []; draft.categories[0].idScopes = [];
  assert.equal(index(draft).definitions[0].featureAssignment?.state, 'conflict');
  assert.ok(index(draft).findings.some(f => f.kind === 'feature-conflict'));
  draft.featureOverrides = [{ id: 'REQ-1', features: ['audit'] }];
  assert.equal(index(draft).findings.filter(f => f.kind === 'feature-conflict').length, 0);
  assert.ok(index(draft).definitions.every(d => d.featureAssignment?.features[0].key === 'audit'));
  for (const patch of [{ path: '../bad' }, { path: 'specs/*' }, { features: [] }, { features: ['missing'] }, { scope: 'wildcard' }]) {
    assert.throws(() => validateIdConfiguration({ ...draft, featureRules: [{ ...draft.featureRules![0], ...patch }] }));
  }
});

test('shared feature file rules split on edit, remove independently and clean up on feature deletion', () => {
  const draft = structuredClone(config); draft.featureRules = [{ key: 'shared', path: 'specs', scope: 'folder', features: ['auth', 'audit'] }];
  const shared = draft.featureRules[0], owned = editFeatureFileRule(draft, shared, 'auth', { path: 'specs/a' });
  assert.deepEqual(shared.features, ['audit']); assert.deepEqual(owned.features, ['auth']);
  assert.equal(shared.path, 'specs'); assert.equal(owned.path, 'specs/a');
  removeFeatureFileRule(draft, owned, 'auth'); assert.deepEqual(draft.featureRules, [shared]);
  removeProjectFeature(draft, 'audit'); assert.deepEqual(draft.featureRules, []);
});


test('feature evidence retains rule paths, sources and explicit overrides for every scoped occurrence', () => {
  const draft = structuredClone(config); draft.featureOverrides = [];
  draft.featureRules = [{ key: 'auth-files', path: 'specs/a', scope: 'folder', features: ['auth'] }];
  const result = index(draft), assignment = result.definitions[0].featureAssignment!;
  assert.equal(assignment.explicit, false); assert.equal(assignment.evidence[0].kind, 'file-rule');
  assert.equal(assignment.evidence[0].path, 'specs/a'); assert.equal(assignment.evidence[0].source?.file, 'specs/a/main.md');
  assert.deepEqual(result.references.find(item => item.scope === 'specs/a')?.featureAssignment, assignment);
  draft.featureOverrides = [{ id: 'REQ-1', scope: 'specs/a', features: ['audit'] }];
  assert.deepEqual(index(draft).definitions[0].featureAssignment?.evidence, [{ kind: 'id-override', id: 'REQ-1', features: [draft.features![1]] }]);
});
