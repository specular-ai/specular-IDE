import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { idKey, identityFromKey } from '../src/core/id-identity';
import { scopeForFile } from '../src/core/id-scopes';
import type { IdScopeRule } from '../src/core/id-scopes';
import { assignModules } from '../src/core/modules';
import { overridesForCategories } from '../src/core/category-overrides';
import { editModuleOverride, mergeModuleOverride } from '../src/core/module-rule-editing';
import { buildDependencyGraph, dependencyPaths } from '../src/core/dependencies';
import { relationshipsFor } from '../src/core/relationships';
import { Workspace } from '../src/core/workspace';
import { ProjectConfigurationStore } from '../src/core/project-configuration';
import { parseRequest, type PluginManifest } from '../src/shared/plugin-runtime';
import type { IdOccurrence } from '../packages/plugin-api/src/index';
import { hostRequest, withProject } from './helpers/plugin-request';

const first = 'specs/002-swift-version-compat', second = 'specs/003-test-architecture';
const scopes = [{ pattern: 'specs/*' }];
const config: IdConfiguration = { version: 1,
  categories: [{ key: 'FR', name: 'Requirements', role: 'requirement', idScopes: structuredClone(scopes) }, { key: 'DD', name: 'Design', role: 'design', idScopes: structuredClone(scopes) }],
  rules: [{ key: 'FR', category: 'FR', prefix: 'FR' }, { key: 'DD', category: 'DD', prefix: 'DD' }],
  modules: [{ key: 'swift', name: 'Swift' }, { key: 'test', name: 'Tests' }],
  moduleRules: [{ key: 'swift', path: first, scope: 'folder', modules: ['swift'] }, { key: 'test', path: second, scope: 'folder', modules: ['test'] }] };
const files = {
  [`${first}/spec.md`]: '# FR-001 Swift\nStatus: Draft\n\nDD-001\n\nTODO review FR-001.\n',
  [`${first}/contracts/nested/api.md`]: '# DD-001 Swift design\nFR-001\n',
  [`${second}/spec.md`]: '# FR-001 Tests\nStatus: Confirmed\n\nDD-001\n',
  [`${second}/research.md`]: '# DD-001 Test design\nFR-001\n',
  'specs/readme.md': 'FR-001\n', 'readme.md': 'FR-001\n', 'specs/004-new/notes.md': 'FR-001\n',
};
const indexOf = (documents: Record<string, string> = files, configuration = config) => assignModules(buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, compileIdMatcher(configuration)))), configuration);
const key = (scope: string, id = 'FR-001') => idKey({ scope, id });
const withScopes = (idScopes?: IdScopeRule[]): IdConfiguration => ({ ...config, categories: config.categories.map(category => ({ ...category, idScopes })) });

test('Spec Kit children have distinct identities, inherited scopes and local-only resolution', () => {
  const index = indexOf();
  assert.equal(index.definitions.length, 4);
  assert.equal(index.findings.filter(f => f.kind === 'duplicate').length, 0);
  assert.deepEqual(index.findings.filter(f => f.kind === 'unresolved').map(f => f.file).sort(), ['readme.md', 'specs/004-new/notes.md', 'specs/readme.md']);
  for (const item of [...index.definitions, ...index.references]) {
    assert.equal(files[item.file as keyof typeof files].slice(item.offset, item.end), item.id);
    if (item.owner) assert.equal(item.owner.scope, item.scope);
  }
  assert.equal(index.references.find(r => r.file.includes('/contracts/'))?.scope, first);
  assert.equal(index.findings.find(f => f.kind === 'pending')?.scope, first);
  const updated = indexOf({ ...files, 'specs/004-new/spec.md': '# FR-001 New\n' });
  assert.equal(updated.findings.filter(f => f.kind === 'unresolved').length, 2);
  assert.equal(scopeForFile('specs/spec.md', scopes), undefined);
  assert.equal(scopeForFile('specs-other/a/spec.md', scopes), undefined);
});

test('category patterns resolve targets independently from their owners and permit roots shared across categories', () => {
  const mixed = structuredClone(config); delete mixed.categories[1].idScopes;
  const documents = { [`${first}/spec.md`]: '# FR-001 Scoped requirement\nDD-001\nTODO review design\n', 'design.md': '# DD-001 Shared design\nFR-001\n' };
  const index = indexOf(documents, mixed);
  const designReference = index.references.find(item => item.id === 'DD-001')!;
  assert.equal(designReference.scope, undefined);
  assert.equal(designReference.owner?.scope, first);
  assert.deepEqual(relationshipsFor(index, key(first)).groups.map(group => group.id), ['DD-001']);
  assert.deepEqual(dependencyPaths(buildDependencyGraph(index), key(first), 'outgoing').ids, ['DD-001', 'FR-001']);
  assert.equal(index.findings.find(item => item.kind === 'unresolved')?.file, 'design.md');
  assert.equal(index.findings.find(item => item.kind === 'pending')?.scope, first);
  mixed.categories[1].idScopes = [{ pattern: first + '/*' }];
  assert.doesNotThrow(() => validateIdConfiguration(mixed));
  const nested = indexOf({ [`${first}/contracts/api.md`]: '# DD-001 Nested design\nFR-001\n' }, mixed);
  assert.equal(nested.definitions[0].scope, first + '/contracts');
  assert.equal(nested.references[0].scope, first);
  assert.equal(nested.references[0].owner?.scope, first + '/contracts');
});

test('legacy global scope patterns normalize into independent category settings without persisting a global field', () => {
  const migrated = validateIdConfiguration({ ...withScopes(), idScopes: scopes });
  assert.ok(!('idScopes' in migrated));
  assert.deepEqual(migrated.categories.map(category => category.idScopes), [scopes, scopes]);
  migrated.categories[0].idScopes![0].enabled = false;
  assert.equal(migrated.categories[1].idScopes![0].enabled, undefined);
  const explicit = validateIdConfiguration({ ...withScopes([]), idScopes: scopes });
  assert.deepEqual(explicit.categories.map(category => category.idScopes), [[], []]);
  assert.throws(() => validateIdConfiguration({ ...config, categories: [{ ...config.categories[0], idScopes: null }] }), /scope/i);
});

test('statuses, module rules, exact overrides, relationships and dependencies stay scoped', () => {
  const index = indexOf();
  const definition = (scope: string) => index.definitions.find(d => idKey(d) === key(scope))!;
  assert.equal(definition(first).authoredStatus?.evidence[0].value, 'Draft');
  assert.equal(definition(second).authoredStatus?.evidence[0].value, 'Confirmed');
  assert.deepEqual(definition(first).moduleAssignment?.modules.map(m => m.key), ['swift']);
  assert.deepEqual(definition(second).moduleAssignment?.modules.map(m => m.key), ['test']);
  assert.deepEqual(relationshipsFor(index, key(first)).groups.map(g => g.id), [key(first, 'DD-001')]);
  assert.equal(relationshipsFor(index, 'FR-001').definitionCount, 0);
  const graph = buildDependencyGraph(index);
  assert.deepEqual(dependencyPaths(graph, key(first), 'outgoing').ids, [key(first, 'DD-001')]);
  assert.equal(graph.nodes.get(key(second))?.definitions.length, 1);
  const overridden = indexOf(files, { ...config, moduleOverrides: [{ id: 'FR-001', scope: first, modules: [] }, { id: 'FR-001', modules: ['swift'] }] });
  assert.equal(overridden.definitions.find(d => idKey(d) === key(first))?.moduleAssignment?.state, 'unassigned');
  assert.deepEqual(overridden.definitions.find(d => idKey(d) === key(second))?.moduleAssignment?.modules.map(m => m.key), ['test']);
  for (const reference of overridden.references.filter(r => r.scope === first && r.id === 'FR-001')) assert.equal(reference.moduleAssignment?.state, 'unassigned');
});

test('disabled/removed patterns preview duplicates and status conflicts; missing rules preserve project identity', () => {
  for (const idScopes of [undefined, [], [{ pattern: 'specs/*', enabled: false }]]) {
    const index = indexOf(files, withScopes(idScopes));
    assert.equal(index.findings.filter(f => f.kind === 'duplicate').length, 4);
    assert.equal(index.definitions.find(d => d.id === 'FR-001')?.authoredStatus?.state, 'conflict');
    assert.ok(index.definitions.every(d => d.scope === undefined && idKey(d) === d.id));
  }
  const localDuplicate = indexOf({ ...files, [`${first}/extra.md`]: '# FR-001 Duplicate\n' });
  assert.equal(localDuplicate.findings.filter(f => f.kind === 'duplicate').length, 2);
  assert.ok(localDuplicate.findings.filter(f => f.kind === 'duplicate').every(f => f.scope === first));
});

test('scope patterns reject ambiguous roots, noncanonical paths and excluded folders', () => {
  for (const pattern of ['*', '/specs/*', 'specs/**', 'specs/*/nested', 'specs/../other/*', './specs/*', 'specs//a/*', 'specs\\*', 'C:/specs/*', 'specs/./*', '.specular/*', 'specs/node_modules/*', 'specs /a/*']) {
    assert.throws(() => validateIdConfiguration(withScopes([{ pattern }])), /scope/i, pattern);
  }
  // Increment 85a: nested roots are allowed (the most specific pattern wins); only duplicates are rejected.
  for (const pattern of ['specs/*', 'SPECS/*']) assert.throws(() => validateIdConfiguration(withScopes([...scopes, { pattern, enabled: false }])), /unique/);
  assert.equal(validateIdConfiguration(withScopes([...scopes, { pattern: 'specs/child/*' }])).categories[0].idScopes?.length, scopes.length + 1);
  assert.equal(validateIdConfiguration(withScopes([{ pattern: 'specs/*' }, { pattern: 'other/*' }])).categories[0].idScopes?.length, 2);
  assert.equal(scopeForFile('specs/a/../b/spec.md', scopes), undefined);
  assert.equal(scopeForFile('specs/a/node_modules/spec.md', scopes), undefined);
  const identities = [{ id: 'FR-001' }, { id: 'FR-001', scope: first }, { id: key(first) }, { id: '@odd' }, { id: 'x/y', scope: second }];
  assert.equal(new Set(identities.map(idKey)).size, identities.length);
  for (const identity of identities) assert.deepEqual(identityFromKey(idKey(identity)), identity);
});

test('exact override validation, category removal and shared-rule editing use the composite selector', () => {
  const draft = validateIdConfiguration({ ...config, moduleOverrides: [{ id: 'FR-001', scope: first, modules: ['swift', 'test'] }, { id: 'FR-001', scope: second, modules: ['test'] }] });
  assert.deepEqual(overridesForCategories(draft, ['FR']), [key(first), key(second)]);
  assert.throws(() => validateIdConfiguration({ ...draft, moduleOverrides: [...draft.moduleOverrides!, draft.moduleOverrides![0]] }), /only one/);
  assert.throws(() => validateIdConfiguration({ ...draft, moduleOverrides: [{ id: 'FR-001', scope: '../bad', modules: [] }] }), /scope/);
  const owned = editModuleOverride(draft, draft.moduleOverrides![0], 'swift', 'FR-001', '');
  assert.equal(owned.scope, undefined);
  assert.equal(mergeModuleOverride(draft, owned), owned);
  assert.equal(draft.moduleOverrides!.length, 3);
  assert.deepEqual(draft.moduleOverrides![0].modules, ['test']);
});

test('workspace scanning excludes junctions and private folders; scopes and overrides survive guarded save/restart', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'specular-scopes-'));
  try {
    for (const [file, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, file)), { recursive: true }); await writeFile(path.join(root, file), text); }
    await mkdir(path.join(root, 'specs', 'ignored', 'node_modules'), { recursive: true });
    await writeFile(path.join(root, 'specs', 'ignored', 'node_modules', 'hidden.md'), '# FR-001');
    await symlink(path.join(root, first), path.join(root, 'specs', 'linked'), 'junction');
    const workspace = await Workspace.open(root), state = await workspace.configuration.load();
    const saved = await workspace.configuration.save({ ...config, moduleOverrides: [{ id: 'FR-001', scope: first, modules: [] }] }, state.diskVersion);
    const restored = await new ProjectConfigurationStore(root).load();
    assert.deepEqual(restored.configuration, saved.configuration);
    const snapshot = await workspace.snapshot();
    assert.ok(!Object.keys(snapshot.documents).some(file => file.includes('linked') || file.includes('node_modules')));
    await assert.rejects(workspace.read('specs/linked/spec.md'), /links are excluded/);
    await assert.rejects(workspace.resolveLink('readme.md', 'specs/linked/spec.md'), /links are excluded/);
    assert.equal(indexOf(snapshot.documents, restored.configuration).definitions.length, 4);
    await assert.rejects(workspace.configuration.save(config, state.diskVersion), /changed on disk/);
    await writeFile(path.join(root, '.specular', 'project.json'), JSON.stringify(withScopes([{ pattern: '../*' }])));
    const bad = await workspace.configuration.load(); assert.match(bad.warning!, /scope/); assert.deepEqual(bad.configuration, saved.configuration);
    for (const [file, text] of Object.entries(files)) assert.equal(await readFile(path.join(root, file), 'utf8'), text);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('public snapshots retain authored IDs with optional scoped keys and reject malformed identities', () => {
  const index = indexOf();
  const occurrences = [...index.definitions, ...index.references].map(o => ({ id: o.id, key: idKey(o), scope: o.scope, category: o.category && { key: o.category.key, name: o.category.name, role: o.category.role }, kind: o.kind, label: o.label,
    source: { file: o.file, start: o.offset, end: o.end }, ...(o.owner ? { owner: { id: o.owner.id, key: idKey(o.owner), scope: o.owner.scope, source: { file: o.file, start: o.owner.offset, end: o.owner.offset + o.owner.id.length } } } : {}) }));
  const request = hostRequest({ projectId: 'project', viewId: 'focus', configurationRevision: 'scope-config', documents: Object.entries(files).map(([file, text]) => ({ file, text })), occurrences: occurrences as IdOccurrence[] });
  const manifest: PluginManifest = { manifestVersion: 1, id: 'test.scope', version: '1.0.0', api: '0.2.0', entry: 'index.js', capabilities: ['workspace.read'], models: ['project@1'], views: [{ id: 'focus', title: 'Focus', kind: 'list' }] };
  const project = parseRequest(JSON.stringify(request), manifest).models.project!;
  assert.equal(project.occurrences[0].id, 'FR-001'); assert.equal(project.occurrences[0].key, key(first));
  assert.equal(new Set(project.occurrences.filter(o => o.kind === 'definition').map(o => o.key ?? o.id)).size, 4);
  const owned = occurrences.find(o => o.owner)!;
  const mixed = { ...owned, scope: undefined, key: owned.id };
  const mixedProject = parseRequest(JSON.stringify(withProject(request, { occurrences: [mixed] })), manifest).models.project!;
  assert.equal(mixedProject.occurrences[0].scope, undefined);
  assert.equal(mixedProject.occurrences[0].owner?.scope, first);
  for (const patch of [{ key: 'FR-001' }, { scope: second }, { scope: '../bad' }, { key: undefined }]) {
    assert.throws(() => parseRequest(JSON.stringify(withProject(request, { occurrences: [{ ...occurrences[0], ...patch }] })), manifest), /occurrence/);
  }
});
