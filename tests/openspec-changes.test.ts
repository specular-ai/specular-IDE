import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ID_DEFINITION_SITES } from '../src/core/definition-sites';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { buildDependencyGraph } from '../src/core/dependencies';
import { compileIdMatcher, validateIdConfiguration } from '../src/core/id-configuration';
import { idKey } from '../src/core/id-identity';

// Increment 85b: OpenSpec changes, delta records, proposed requirements, declared capabilities, and name references.
const sites = (keyword: string, levels: number[]) => ({ headings: { enabled: true, levels, mode: 'keyword', keyword }, tables: { ...DEFAULT_ID_DEFINITION_SITES.tables, enabled: false } });
const scopes = [{ pattern: 'openspec/specs/{capability}/spec.md' }, { pattern: 'openspec/changes/**/specs/{capability}/spec.md' }];
const configuration = validateIdConfiguration({
  version: 1,
  categories: [
    { key: 'requirement', name: 'Requirement', role: 'requirement', idScopes: scopes, idDefinitionSites: sites('Requirement', [3]), deltas: true, nameReferences: true },
    { key: 'scenario', name: 'Scenario', parent: 'requirement', idScopes: scopes, idDefinitionSites: sites('Scenario', [4]) },
    { key: 'capability', name: 'Capability', derive: { pattern: 'openspec/specs/{capability}/spec.md' } },
    { key: 'change', name: 'Change', derive: { pattern: 'openspec/changes/**/{change}/proposal.md' }, changes: { capabilities: 'capability' } },
  ],
  rules: [],
});
const files: Record<string, string> = {
  'openspec/specs/identity/spec.md': '# identity Specification\n\n## Requirements\n\n### Requirement: Users and workspaces\n\n#### Scenario: Create user\n\n### Requirement: Token verification\n\n#### Scenario: Valid token\n\nThe `users and workspaces` requirement applies; `npm test` is just code.\n',
  'openspec/changes/identity-realms/proposal.md': '# Change: Introduce realms\n\n## Capabilities\n\n### New Capabilities\n\n- `identity-realms`: Realm definitions.\n\n### Modified Capabilities\n\n- `identity`: Users scoped to realms.\n- `billing`: Not touched.\n\n## Impact\n\n- `identity` again, outside the lists.\n',
  'openspec/changes/identity-realms/specs/identity/spec.md': '## MODIFIED Requirements\n\n### Requirement: Users and workspaces\n\n#### Scenario: Create user in realm\n\n## ADDED Requirements\n\n### Requirement: Realm isolation\n\n#### Scenario: Siloed users\n\n## REMOVED Requirements\n\n### Requirement: Legacy login\n',
  'openspec/changes/identity-realms/specs/identity-realms/spec.md': '## ADDED Requirements\n\n### Requirement: Realm definitions\n',
  'openspec/changes/identity-realms/specs/undeclared/spec.md': '## ADDED Requirements\n\n### Requirement: Stray\n',
  'openspec/changes/archive/2026-01-01-tokens/proposal.md': '# Change: Tokens\n',
  'openspec/changes/archive/2026-01-01-tokens/specs/identity/spec.md': '## ADDED Requirements\n\n### Requirement: Token verification\n\n#### Scenario: Valid token\n\n### Requirement: Lost in archive\n',
};
const matcher = compileIdMatcher(configuration);
const models = (input = files) => Object.entries(input).map(([file, text]) => analyzeDocument(file, text, matcher));
const ofCategory = <T extends { category?: { key: string } }>(items: T[], key: string) => items.filter(item => item.category?.key === key);

test('changes are elements with an Active or Archived status by location', () => {
  const index = buildIndex(models());
  const changes = ofCategory(index.definitions, 'change');
  assert.deepEqual(changes.map(item => [item.id, item.authoredStatus?.evidence[0].value]), [['identity-realms', 'Active'], ['2026-01-01-tokens', 'Archived']]);
});

test('delta sections record changes instead of defining, and active ADDED requirements become proposed', () => {
  const index = buildIndex(models());
  const requirements = ofCategory(index.definitions, 'requirement').map(item => [item.id, item.scope, item.authoredStatus?.evidence[0].value ?? '-', item.owner?.id ?? '-']);
  assert.deepEqual(requirements, [
    ['Users and workspaces', 'capability:identity', '-', '-'],
    ['Token verification', 'capability:identity', '-', '-'],
    ['Realm isolation', 'capability:identity', 'Proposed', 'identity-realms'],
    ['Realm definitions', 'capability:identity-realms', 'Proposed', 'identity-realms'],
    ['Stray', 'capability:undeclared', 'Proposed', 'identity-realms'],
  ]);
  // The proposed requirement keeps its scenario; scenarios restated under MODIFIED and archived ADDED are not redefined.
  assert.deepEqual(ofCategory(index.definitions, 'scenario').map(item => item.id), ['Users and workspaces / Create user', 'Token verification / Valid token', 'Realm isolation / Siloed users']);
  const records = index.references.filter(item => item.delta && item.category?.key === 'requirement').map(item => [item.delta, item.id, item.owner?.id, item.owner?.file]);
  assert.deepEqual(records, [
    ['modified', 'Users and workspaces', 'identity-realms', 'openspec/changes/identity-realms/proposal.md'],
    ['removed', 'Legacy login', 'identity-realms', 'openspec/changes/identity-realms/proposal.md'],
    ['added', 'Token verification', '2026-01-01-tokens', 'openspec/changes/archive/2026-01-01-tokens/proposal.md'],
  ]);
  // An active change's unknown name is reported; an archived change's record of a requirement that no longer exists is history, not an error.
  const unresolved = index.findings.filter(item => item.kind === 'unresolved').map(item => item.message);
  assert.ok(unresolved.some(message => message.includes('Legacy login')) && !unresolved.some(message => message.includes('Lost in archive')));
  assert.equal(index.findings.filter(item => item.kind === 'duplicate').length, 0);
  // The change links to what it touches; links carry the change in their evidence.
  const graph = buildDependencyGraph(index);
  const change = ofCategory(index.definitions, 'change')[0], modified = index.definitions.find(item => item.id === 'Users and workspaces')!;
  assert.ok([...graph.edges.values()].some(edge => edge.from === idKey(change) && edge.to === idKey(modified) && edge.evidence.some(item => item.delta === 'modified')));
  assert.ok([...graph.edges.values()].some(edge => edge.from === idKey(change) && edge.to === idKey(index.definitions.find(item => item.id === 'Realm isolation')!)));
});

test('declared capabilities link the change, propose new ones, and are checked against its spec folders', () => {
  const index = buildIndex(models());
  assert.deepEqual(ofCategory(index.definitions, 'capability').map(item => [item.id, item.authoredStatus?.evidence[0].value ?? '-']), [['identity', '-'], ['identity-realms', 'Proposed']]);
  assert.deepEqual(index.references.filter(item => item.category?.key === 'capability').map(item => [item.delta, item.id, item.owner?.id]), [['modified', 'identity', 'identity-realms'], ['modified', 'billing', 'identity-realms']]);
  const consistency = index.findings.filter(item => item.kind === 'consistency').map(item => item.message);
  assert.deepEqual(consistency, [
    'identity-realms declares capability billing, but has no openspec/changes/identity-realms/specs/billing/ specification.',
    'identity-realms has openspec/changes/identity-realms/specs/undeclared/, but its proposal does not declare capability undeclared.',
  ]);
  assert.ok(index.findings.some(item => item.kind === 'unresolved' && item.message.includes('billing')));
});

test('backticked names refer to elements in the same scope, ignoring case; other code spans stay code', () => {
  const index = buildIndex(models());
  const names = index.references.filter(item => !item.delta && item.category?.key === 'requirement');
  assert.deepEqual(names.map(item => [item.id, item.file, item.owner?.id]), [['Users and workspaces', 'openspec/specs/identity/spec.md', 'Token verification / Valid token']]);
  const text = files['openspec/specs/identity/spec.md'];
  assert.equal(text.slice(names[0].offset, names[0].end), '`users and workspaces`');
  assert.ok(!index.references.some(item => item.id === 'npm test'));
});

test('cached document models are not changed: once the specs add a requirement, its record is a reference again', () => {
  const cached = models();
  buildIndex(cached);
  const landed = { ...files, 'openspec/specs/identity/spec.md': files['openspec/specs/identity/spec.md'] + '\n### Requirement: Realm isolation\n' };
  const next = cached.map(model => model.file === 'openspec/specs/identity/spec.md' ? analyzeDocument(model.file, landed[model.file], matcher) : model);
  const index = buildIndex(next);
  assert.equal(index.definitions.filter(item => item.id === 'Realm isolation').length, 1);
  assert.ok(index.references.some(item => item.id === 'Realm isolation' && item.delta === 'added'));
  assert.equal(index.findings.filter(item => item.kind === 'duplicate').length, 0);
  assert.deepEqual(buildIndex(cached).definitions.filter(item => item.id === 'Realm isolation').map(item => item.kind), ['definition']);
});

test('change settings are validated', () => {
  const base = (categories: unknown[]) => ({ version: 1, categories, rules: [] });
  for (const [input, message] of [
    [base([{ key: 'c', name: 'C', changes: {} }]), /derive pattern/],
    [base([{ key: 'c', name: 'C', derive: { pattern: 'x/{change}/proposal.md' }, changes: { capabilities: 'missing' } }]), /unknown capability category/],
    [base([{ key: 'c', name: 'C', derive: { pattern: 'x/{change}/proposal.md' }, changes: { archive: 'a/b' } }]), /one folder name/],
    [base([{ key: 'c', name: 'C', derive: { pattern: 'x/{change}/proposal.md' }, changes: { other: 1 } }]), /Unknown configuration field/],
    [base([{ key: 'r', name: 'R', deltas: 'yes' }]), /deltas must be a boolean/],
    [base([{ key: 'r', name: 'R', nameReferences: 1 }]), /nameReferences must be a boolean/],
  ] as const) assert.throws(() => validateIdConfiguration(input), message);
});

test('current specifications that keep ADDED headings still define their requirements', () => {
  const index = buildIndex(models({ ...files, 'openspec/specs/branching/spec.md': '# branching Specification\n\n## ADDED Requirements\n\n### Requirement: Branch on condition\n' }));
  assert.ok(index.definitions.some(item => item.id === 'Branch on condition' && item.kind === 'definition' && !item.authoredStatus));
});

test('a file whose first heading defines another element is still derived, at its first line (85e)', () => {
  const spec = '### Requirement: Default bindings\r\n\r\n#### Scenario: Windows keys\r\n';
  const proposal = '### Requirement: Quick fix\n\n## Capabilities\n\n### Modified Capabilities\n\n- `shortcuts`: Bindings.\n';
  const index = buildIndex(models({ 'openspec/specs/shortcuts/spec.md': spec, 'openspec/changes/quick-fix/proposal.md': proposal, 'openspec/changes/quick-fix/specs/shortcuts/spec.md': '## MODIFIED Requirements\n\n### Requirement: Default bindings\n' }));
  const capability = ofCategory(index.definitions, 'capability').find(item => item.id === 'shortcuts')!;
  assert.deepEqual([capability.offset, capability.end, capability.label], [0, spec.indexOf('\r'), 'openspec/specs/shortcuts/spec.md']);
  const requirement = ofCategory(index.definitions, 'requirement').find(item => item.id === 'Default bindings')!;
  assert.equal(spec.slice(requirement.offset, requirement.end), 'Default bindings');
  assert.equal(requirement.scope, ofCategory(index.references, 'requirement').find(item => item.delta === 'modified')!.scope);
  assert.deepEqual(ofCategory(index.definitions, 'scenario').map(item => item.id), ['Default bindings / Windows keys']);
  assert.deepEqual(ofCategory(index.definitions, 'change').map(item => [item.id, item.offset, item.label]), [['quick-fix', 0, 'openspec/changes/quick-fix/proposal.md']]);
  assert.deepEqual(index.findings.filter(item => item.kind === 'unresolved' || item.kind === 'consistency'), []);
});

test('change links, cross-file owners, and delta kinds pass the plugin broker', async () => {
  const { modelsFor } = await import('../src/renderer/plugin-models');
  const { parseRequest } = await import('../src/shared/plugin-runtime');
  const { API_VERSION } = await import('../packages/plugin-api/src/index');
  const index = buildIndex(models());
  const folders = [...new Set(Object.keys(files).flatMap(file => file.split('/').slice(0, -1).map((_part, n, parts) => parts.slice(0, n + 1).join('/'))))];
  const snapshot = { projectId: 'internal', revision: 1, ready: true, currentFile: 'openspec/specs/identity/spec.md', configuration, notice: '', documents: files, folders,
    files: Object.keys(files).map(path => ({ path, markdown: true })), index, warnings: [] };
  const manifest = { manifestVersion: 1, id: 'test.changes', version: '1.0.0', api: API_VERSION, entry: 'index.js', capabilities: ['workspace.read'], models: ['project@1', 'physical@1'], views: [{ id: 'list', title: 'List', kind: 'list' }] } as never;
  const parsed = parseRequest(JSON.stringify({ apiVersion: API_VERSION, requestId: 'r', viewId: 'list', context: { projectId: 'opaque', revision: 1, currentFile: snapshot.currentFile }, models: modelsFor(snapshot as never) }), manifest);
  const project = parsed.models.project!;
  assert.ok(project.relationships.some(link => link.deltas?.includes('modified')));
  assert.ok(project.occurrences.some(item => item.owner && item.owner.source.file !== item.source.file));
});
