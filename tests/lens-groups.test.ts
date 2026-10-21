import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupDefinitions } from '../src/renderer/lens-groups';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { mapStatuses } from '../src/core/statuses';
import { assignModules } from '../src/core/modules';
import { assignFeatures } from '../src/core/features';
import { DEFAULT_ID_DEFINITION_SITES } from '../src/core/definition-sites';
import { compileIdMatcher, LEGACY_ID_CONFIGURATION, validateIdConfiguration } from '../src/core/id-configuration';

test('status groups use mapped display values and preserve conflict evidence and missing values', () => {
  const index = buildIndex([
    analyzeDocument('a.md', '# REQ-1 First\nStatus: Implemented in 40\n# REQ-2 Second\nStatus: implemented in 41\n# REQ-3 Conflict\nStatus: Draft\n# REQ-4 Missing\n'),
    analyzeDocument('b.md', '# REQ-3 Duplicate\nStatus: Accepted\n'),
  ]);
  const mapped = mapStatuses(index, [{ name: 'Delivered', rules: [{ mode: 'startsWith', value: 'Implemented' }] }]);
  const groups = groupDefinitions(mapped.definitions, 'status');
  assert.deepEqual(groups.map(g => [g.label, g.count, g.items.length]), [['Delivered', 2, 2], ['No status', 1, 1], ['Status conflicts', 1, 2]]);
  assert.equal(groups[2].items[0].authoredStatus?.evidence.length, 2);
  assert.deepEqual(groupDefinitions(mapped.definitions.filter(d => d.id === 'REQ-2'), 'status').map(g => [g.label, g.count]), [['Delivered', 1]]);
  assert.deepEqual(groupDefinitions([], 'status'), []);
});

test('module groups count shared IDs per group, keep conflicts separate and retain duplicate sources', () => {
  const configuration = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION,
    modules: [{ key: 'gui', name: 'GUI' }, { key: 'api', name: 'API' }, { key: 'empty', name: 'Unused' }],
    moduleRules: [{ key: 'a', scope: 'file', path: 'a.md', modules: ['gui'] }, { key: 'b', scope: 'file', path: 'b.md', modules: ['api'] }],
    moduleOverrides: [{ id: 'REQ-1', modules: ['gui', 'api'] }, { id: 'REQ-2', modules: [] }],
  });
  const index = assignModules(buildIndex([analyzeDocument('a.md', '# REQ-1 Shared\n# REQ-2 Missing\n# REQ-3 Conflict\n'), analyzeDocument('b.md', '# REQ-3 Duplicate\n')]), configuration);
  const groups = groupDefinitions(index.definitions, 'module');
  assert.deepEqual(groups.map(g => [g.label, g.count, g.items.length]), [['API', 1, 1], ['GUI', 1, 1], ['Module conflicts', 1, 2], ['No module', 1, 1]]);
  assert.equal(groups[2].items[0].moduleAssignment?.evidence.length, 2);
});

test('scoped identities count separately and user labels cannot collide with special group keys', () => {
  const [definition] = buildIndex([analyzeDocument('a.md', '# REQ-1 Title\nStatus: No status\n')]).definitions;
  const scoped = [{ ...definition, scope: 'specs/one' }, { ...definition, scope: 'specs/two' }, { ...definition, scope: 'specs/two', file: 'duplicate.md' }];
  const groups = groupDefinitions([...scoped, { ...definition, id: 'REQ-2', authoredStatus: undefined }], 'status');
  assert.equal(groups.length, 2);
  assert.equal(groups.find(g => g.key === 'value:no status')?.count, 2);
  assert.equal(groups.find(g => g.key === 'missing')?.count, 1);
  const modules = scoped.map(d => ({ ...d, moduleAssignment: { state: 'assigned' as const, modules: [{ key: 'a', name: 'Same' }, { key: 'b', name: 'Same' }], evidence: [] } }));
  assert.deepEqual(groupDefinitions(modules, 'module').map(g => [g.key, g.count]), [['value:a', 2], ['value:b', 2]]);
});

test('feature grouping uses effective scoped list memberships independently of modules', () => {
  const configuration = validateIdConfiguration({ version: 1,
    categories: [{ key: 'req', name: 'Requirements', idScopes: [{ pattern: 'spec/*' }], idDefinitionSites: { ...DEFAULT_ID_DEFINITION_SITES, lists: { enabled: true, types: ['unordered'], mode: 'start' } } }],
    rules: [{ key: 'req', category: 'req', prefix: 'FR' }],
    features: [{ key: 'loans', name: 'Loans' }, { key: 'audit', name: 'Audit' }, { key: 'unused', name: 'Unused' }],
    featureRules: [{ key: 'loans', scope: 'folder', path: 'spec/loans', features: ['loans'] }],
    featureOverrides: [{ id: 'FR-001', scope: 'spec/loans', features: ['loans', 'audit'] }, { id: 'FR-002', scope: 'spec/loans', features: [] }],
    modules: [{ key: 'api', name: 'API' }], moduleRules: [{ key: 'all', scope: 'folder', path: '.', modules: ['api'] }],
  });
  const match = compileIdMatcher(configuration);
  const index = assignFeatures(assignModules(buildIndex([
    analyzeDocument('spec/loans/main.md', '- **FR-001**: Shared\n- FR-002: Explicitly unassigned\n- FR-003: Inherited\n', match),
    analyzeDocument('spec/audit/main.md', '- FR-001: Different scope\n', match),
  ]), configuration), configuration);
  const groups = groupDefinitions(index.definitions, 'feature');
  assert.deepEqual(groups.map(g => [g.label, g.count]), [['Audit', 1], ['Loans', 2], ['No feature', 2]]);
  assert.deepEqual(groupDefinitions(index.definitions, 'module').map(g => [g.label, g.count]), [['API', 4]]);
  assert.deepEqual(groupDefinitions(index.definitions.filter(d => d.id === 'FR-001'), 'feature').map(g => [g.label, g.count]), [['Audit', 1], ['Loans', 1], ['No feature', 1]]);
  assert.equal(groups.find(g => g.label === 'Loans')?.items[0].file, 'spec/loans/main.md');
  assert.deepEqual(groupDefinitions([], 'feature'), []);
});

test('feature conflicts preserve all source cards, and counts update after explicit resolution', () => {
  const configuration = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION,
    features: [{ key: 'one', name: 'One' }, { key: 'two', name: 'Two' }],
    featureRules: [{ key: 'one', scope: 'file', path: 'a.md', features: ['one'] }, { key: 'two', scope: 'file', path: 'b.md', features: ['two'] }],
  });
  const base = buildIndex([analyzeDocument('a.md', '# REQ-1 First\n'), analyzeDocument('b.md', '# REQ-1 Duplicate\n')]);
  const conflict = groupDefinitions(assignFeatures(base, configuration).definitions, 'feature');
  assert.deepEqual(conflict.map(g => [g.label, g.count, g.items.length]), [['Feature conflicts', 1, 2]]);
  assert.equal(conflict[0].items[0].featureAssignment?.evidence.length, 2);
  const resolved = groupDefinitions(assignFeatures(base, { ...configuration, featureOverrides: [{ id: 'REQ-1', features: ['one', 'two'] }] }).definitions, 'feature');
  assert.deepEqual(resolved.map(g => [g.label, g.count, g.items.length]), [['One', 1, 2], ['Two', 1, 2]]);
});
