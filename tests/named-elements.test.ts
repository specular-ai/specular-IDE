import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ID_DEFINITION_SITES } from '../src/core/definition-sites';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { buildDependencyGraph } from '../src/core/dependencies';
import { compileIdMatcher, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { captureForFile, scopeContains, scopeForFile, validateFolderPatterns, validateIdScopes } from '../src/core/id-scopes';
import { idKey } from '../src/core/id-identity';

// Increment 85a: named elements (OpenSpec keyword headings), nested identity, scope patterns, and derived elements.
const keywordSites = (keyword: string, levels: number[], separator?: string) => ({
  headings: { enabled: true, levels, mode: 'keyword', keyword, ...(separator ? { separator } : {}) },
  tables: { ...DEFAULT_ID_DEFINITION_SITES.tables, enabled: false },
});
const openspecScopes = [{ pattern: 'openspec/specs/{capability}/spec.md' }, { pattern: 'openspec/changes/*' }, { pattern: 'openspec/changes/archive/*' }];
const openspec = (extra: Partial<IdConfiguration> = {}): IdConfiguration => validateIdConfiguration({
  version: 1,
  categories: [
    { key: 'requirement', name: 'Requirement', role: 'requirement', idScopes: openspecScopes, idDefinitionSites: keywordSites('Requirement', [3]) },
    { key: 'scenario', name: 'Scenario', parent: 'requirement', idScopes: openspecScopes, idDefinitionSites: keywordSites('Scenario', [4]) },
    { key: 'capability', name: 'Capability', derive: { pattern: 'openspec/specs/{capability}/spec.md' } },
  ],
  rules: [],
  ...extra,
});
const analyze = (files: Record<string, string>, configuration = openspec()) => {
  const matcher = compileIdMatcher(configuration);
  return buildIndex(Object.entries(files).map(([file, text]) => analyzeDocument(file, text, matcher)));
};
const mutators = `# mutators Specification

## Requirements

### Requirement: Mutator interface and \`Mutate\` constructor

The interface SHALL ...

#### Scenario: Valid input

- WHEN a step matches

#### Scenario: No match

### Requirement: Mutator propagation to nested workflows

#### Scenario: Valid input
`;

test('keyword headings define named elements without the keyword, and scenarios are nested in their requirement', () => {
  const file = 'openspec/specs/mutators/spec.md';
  const index = analyze({ [file]: mutators });
  const definitions = index.definitions.map(item => [item.category?.key, item.id, item.scope]);
  assert.deepEqual(definitions, [
    ['requirement', 'Mutator interface and Mutate constructor', 'capability:mutators'],
    ['scenario', 'Mutator interface and Mutate constructor / Valid input', 'capability:mutators'],
    ['scenario', 'Mutator interface and Mutate constructor / No match', 'capability:mutators'],
    ['requirement', 'Mutator propagation to nested workflows', 'capability:mutators'],
    ['scenario', 'Mutator propagation to nested workflows / Valid input', 'capability:mutators'],
    ['capability', 'mutators', 'capability:mutators'],
  ]);
  assert.equal(index.findings.length, 0, 'repeated scenario names under different requirements are not duplicates');
  // A plain name selects exactly its text; a name with inline code selects the heading content.
  const plain = index.definitions.find(item => item.id === 'Mutator propagation to nested workflows')!;
  assert.equal(mutators.slice(plain.offset, plain.end), 'Mutator propagation to nested workflows');
  const coded = index.definitions[0];
  assert.equal(mutators.slice(coded.offset, coded.end), 'Requirement: Mutator interface and `Mutate` constructor');
  assert.equal(mutators.slice(index.definitions[5].offset, index.definitions[5].end), 'mutators Specification');
  // Each scenario is owned by its requirement, which links them in the relationship graph.
  const scenario = index.definitions[1];
  assert.equal(scenario.owner?.id, coded.id);
  const graph = buildDependencyGraph(index);
  assert.ok(graph.edges.has(`${idKey(coded)}\u0000${idKey(scenario)}`) || [...graph.edges.values()].some(edge => edge.from === idKey(coded) && edge.to === idKey(scenario)));
});

test('names ignore case and spacing for identity, keep the first spelling, and keywords need their separator', () => {
  const index = analyze({
    'openspec/specs/auth/spec.md': '### Requirement: User   Login\n\n### requirement: user login\n',
    'openspec/specs/other/spec.md': '### Requirements: plural is not the keyword\n\n### Requirement 2: no separator\n\n## Requirement: wrong level\n',
  });
  assert.deepEqual(index.definitions.filter(item => item.category?.key === 'requirement').map(item => item.id), ['User Login', 'User Login']);
  assert.deepEqual(index.findings.map(item => item.kind), ['duplicate', 'duplicate']);
  const dashed = validateIdConfiguration({ version: 1, categories: [{ key: 'task', name: 'Task', idDefinitionSites: keywordSites('Task', [2], '\u2014') }], rules: [] });
  assert.deepEqual(analyze({ 'plan.md': '## Task \u2014 Split the tests\n## Task: colon\n' }, dashed).definitions.map(item => item.id), ['Split the tests']);
});

test('a keyword heading without an enclosing parent is defined by its own name', () => {
  const index = analyze({ 'openspec/specs/auth/spec.md': '#### Scenario: Orphan\n\n### Requirement: Login\n\n#### Scenario: Valid\n' });
  assert.deepEqual(index.definitions.filter(item => item.category?.key === 'scenario').map(item => item.id), ['Orphan', 'Login / Valid']);
});

test('scope patterns: captures join folders, nested patterns pick the most specific, file globs scope each file', () => {
  const rules = validateIdScopes([{ pattern: 'openspec/specs/{capability}/spec.md' }, { pattern: 'openspec/changes/**/specs/{capability}/spec.md' }]);
  assert.equal(scopeForFile('openspec/specs/identity/spec.md', rules), 'capability:identity');
  assert.equal(scopeForFile('openspec/changes/add-realms/specs/identity/spec.md', rules), 'capability:identity');
  assert.equal(scopeForFile('openspec/changes/archive/2026-05-12-x/specs/identity/spec.md', rules), 'capability:identity');
  assert.equal(scopeForFile('openspec/specs/identity/design.md', rules), undefined);
  const nested = validateIdScopes([{ pattern: 'openspec/changes/*' }, { pattern: 'openspec/changes/archive/*' }]);
  assert.equal(scopeForFile('openspec/changes/add-x/tasks.md', nested), 'openspec/changes/add-x');
  assert.equal(scopeForFile('openspec/changes/archive/2026-01-01-y/tasks.md', nested), 'openspec/changes/archive/2026-01-01-y');
  const files = validateIdScopes([{ pattern: 'specs/*' }, { pattern: 'specs/004-*/P3_*.md' }, { pattern: 'docs/plans/*.md' }]);
  assert.equal(scopeForFile('specs/004-compliance/tasks.md', files), 'specs/004-compliance');
  assert.equal(scopeForFile('specs/004-compliance/P3_TASKS.md', files), 'specs/004-compliance/P3_TASKS.md');
  assert.equal(scopeForFile('docs/plans/2026-05-04-plan.md', files), 'docs/plans/2026-05-04-plan.md');
  assert.equal(scopeForFile('docs/plans/nested/plan.md', files), undefined);
  // Legacy patterns behave exactly as before: files directly in the root are unscoped.
  assert.equal(scopeForFile('specs/README.md', files), undefined);
  assert.ok(scopeContains('specs/004-compliance', 'specs/004-compliance/a.md') && scopeContains('docs/plans/a.md', 'docs/plans/a.md') && scopeContains('capability:identity', 'anything.md'));
  assert.ok(!scopeContains('specs/004-compliance', 'specs/005-other/a.md'));
  assert.equal(captureForFile('openspec/specs/identity/spec.md', 'openspec/specs/{capability}/spec.md'), 'identity');
  assert.equal(scopeForFile('a/b/specs/x/spec.md', validateIdScopes([{ pattern: '**/specs/*' }])), 'a/b/specs/x');
  for (const pattern of ['*', '**/*', 'specs/**', 'specs/{a}/{b}/*', 'specs/*/nested', 'specs/{name}.md', 'docs/*.md/x', 'specs/node_modules/*', 'C:/specs/*', 'specs/../x/*', 'specs/{Bad}/*']) {
    assert.throws(() => validateIdScopes([{ pattern }]), /scope/i, pattern);
  }
  assert.throws(() => validateIdScopes([{ pattern: 'specs/*' }, { pattern: 'SPECS/*' }]), /unique/);
  // Folder generators keep the original non-overlapping folder/* form.
  assert.throws(() => validateFolderPatterns([{ pattern: 'openspec/specs/{capability}/spec.md' }]), /child wildcard/);
  assert.throws(() => validateFolderPatterns([{ pattern: 'specs/*' }, { pattern: 'specs/a/*' }]), /overlap/);
});

test('per-file scopes restart numbering per plan, and nested file scopes split a second task list', () => {
  const configuration = validateIdConfiguration({ version: 1,
    categories: [{ key: 'task', name: 'Task', idScopes: [{ pattern: 'specs/*' }, { pattern: 'specs/004-*/P3_*.md' }, { pattern: 'docs/plans/*.md' }] }],
    rules: [{ key: 'task', category: 'task', pattern: String.raw`\bTask \d+\b` }] });
  const index = analyze({
    'docs/plans/a.md': '## Task 1: first\n', 'docs/plans/b.md': '## Task 1: other\n',
    'specs/004-x/tasks.md': '## Task 1: main list\n', 'specs/004-x/P3_TASKS.md': '## Task 1: phase three\n\nSee Task 1.\n',
  }, configuration);
  assert.equal(index.definitions.length, 4);
  assert.equal(index.findings.length, 0);
  assert.equal(index.references[0].scope, 'specs/004-x/P3_TASKS.md');
});

test('category parent, derive, and keyword settings are validated', () => {
  const base = (categories: unknown[], extra: Record<string, unknown> = {}) => ({ version: 1, categories, rules: [], ...extra });
  const cases: [unknown, RegExp][] = [
    [base([{ key: 'a', name: 'A', parent: 'missing' }]), /unknown parent/],
    [base([{ key: 'a', name: 'A', parent: 'b' }, { key: 'b', name: 'B', parent: 'a' }]), /cyclic parent/],
    [base([{ key: 'a', name: 'A', parent: 'a' }]), /cyclic parent/],
    [base([{ key: 'a', name: 'A', derive: { pattern: 'openspec/specs/*' } }]), /one \{name\} capture/],
    [base([{ key: 'a', name: 'A', derive: { pattern: 'openspec/specs/{capability}/*' } }]), /Markdown file pattern/],
    [base([{ key: 'a', name: 'A', derive: { pattern: 'openspec/specs/{c}/spec.md', extra: 1 } }]), /Unknown configuration field/],
    [base([{ key: 'a', name: 'A', idDefinitionSites: keywordSites('', [3]) }]), /heading keyword/],
    [base([{ key: 'a', name: 'A', idDefinitionSites: keywordSites('Requirement', [3], ';') }]), /separator/],
    [base([{ key: 'a', name: 'A', idDefinitionSites: { ...keywordSites('Requirement', [3]), headings: { enabled: true, levels: [3], mode: 'keyword', keyword: 'R', pattern: 'x' } } }]), /Advanced pattern/],
    [base([{ key: 'a', name: 'A', idDefinitionSites: { ...DEFAULT_ID_DEFINITION_SITES, headings: { ...DEFAULT_ID_DEFINITION_SITES.headings, keyword: 'R' } } }]), /Keyword heading mode/],
    [base([{ key: 'a', name: 'A' }], { idDefinitionSites: keywordSites('Requirement', [3]) }), /per category/],
  ];
  for (const [input, message] of cases) assert.throws(() => validateIdConfiguration(input), message);
  const valid = openspec();
  assert.equal(valid.categories[1].parent, 'requirement');
  assert.equal(valid.categories[0].idDefinitionSites?.headings.keyword, 'Requirement');
});

test('token IDs keep exact identity beside named elements', () => {
  const configuration = openspec({ categories: [...openspec().categories, { key: 'req', name: 'REQ' }], rules: [{ key: 'req', category: 'req', prefix: 'REQ' }] });
  const index = analyze({ 'a.md': '# REQ-1 Login\n\nSee req-1 and REQ-1.\n' }, configuration);
  assert.deepEqual(index.references.map(item => item.id), ['REQ-1']);
});

test('named elements with captured and per-file scopes pass the plugin broker', async () => {
  const { modelsFor } = await import('../src/renderer/plugin-models');
  const { parseRequest } = await import('../src/shared/plugin-runtime');
  const { API_VERSION } = await import('../packages/plugin-api/src/index');
  const configuration = openspec({ categories: [...openspec().categories, { key: 'task', name: 'Task', idScopes: [{ pattern: 'plans/*.md' }] }], rules: [{ key: 'task', category: 'task', pattern: String.raw`\bTask \d+\b` }] });
  const documents = { 'openspec/specs/mutators/spec.md': mutators, 'plans/a.md': '## Task 1: first\n\nSee Task 1.\n' };
  const matcher = compileIdMatcher(configuration);
  const index = buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, matcher)));
  const snapshot = { projectId: 'internal', revision: 1, ready: true, currentFile: 'plans/a.md', configuration, notice: '', documents, folders: ['openspec', 'openspec/specs', 'openspec/specs/mutators', 'plans'],
    files: Object.keys(documents).map(path => ({ path, markdown: true })), index, warnings: [] };
  const models = modelsFor(snapshot as never);
  const manifest = { manifestVersion: 1, id: 'test.named', version: '1.0.0', api: API_VERSION, entry: 'index.js', capabilities: ['workspace.read'], models: ['project@1', 'physical@1'], views: [{ id: 'list', title: 'List', kind: 'list' }] } as never;
  const parsed = parseRequest(JSON.stringify({ apiVersion: API_VERSION, requestId: 'r', viewId: 'list', context: { projectId: 'opaque', revision: 1, currentFile: 'plans/a.md' }, models }), manifest);
  const scopes = new Set(parsed.models.project!.occurrences.map(item => item.scope));
  assert.ok(scopes.has('capability:mutators') && scopes.has('plans/a.md'));
  assert.ok(parsed.models.project!.relationships.some(link => link.to.includes('Valid input')));
});
