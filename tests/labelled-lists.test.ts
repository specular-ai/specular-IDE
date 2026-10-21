import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ID_DEFINITION_SITES } from '../src/core/definition-sites';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { overridesForCategories } from '../src/core/category-overrides';
import { idKey } from '../src/core/id-identity';

// Increment 82: Kiro-style labelled reference lists and paragraph definitions.
const scopes = [{ pattern: '.kiro/specs/*' }];
const kiro = (paragraphs = false): IdConfiguration => validateIdConfiguration({
  version: 1,
  categories: [
    { key: 'req', name: 'Requirement', role: 'requirement', idScopes: scopes },
    { key: 'prop', name: 'Property', role: 'design', idScopes: scopes,
      ...(paragraphs ? { idDefinitionSites: { ...DEFAULT_ID_DEFINITION_SITES, paragraphs: { enabled: true, mode: 'start' } } } : {}) },
  ],
  rules: [
    { key: 'req', category: 'req', pattern: String.raw`\bRequirement \d+\b` },
    { key: 'prop', category: 'prop', pattern: String.raw`\bProperty \d+\b` },
    { key: 'req-list', category: 'req', list: { label: String.raw`Requirements:|\bValidates: Requirements|\bReq`, item: String.raw`(?<number>\d+)(?:\.\d+)?`, id: 'Requirement {number}' } },
  ],
});
const analyze = (files: Record<string, string>, configuration = kiro()) => {
  const matcher = compileIdMatcher(configuration);
  return buildIndex(Object.entries(files).map(([file, text]) => analyzeDocument(file, text, matcher)));
};
const spec = (name: string) => `.kiro/specs/${name}`;
const requirements = `# Requirements

### Requirement 1: Create the module

#### Acceptance Criteria

1. THE module SHALL exist

### Requirement 6: Document it

### Requirement 3: Ranges
`;

test('each listed number references the templated ID at the exact item text', () => {
  const tasks = `# Tasks

- [x] 1. Create the module
  - _Requirements: 1.1, 1.2, 6.1_
`;
  const index = analyze({ [spec('a/requirements.md')]: requirements, [spec('a/tasks.md')]: tasks });
  const refs = index.references.filter(item => item.file.endsWith('tasks.md'));
  assert.deepEqual(refs.map(item => item.id), ['Requirement 1', 'Requirement 1', 'Requirement 6']);
  assert.deepEqual(refs.map(item => tasks.slice(item.offset, item.end)), ['1.1', '1.2', '6.1']);
  assert.ok(refs.every(item => item.scope === '.kiro/specs/a' && item.category?.key === 'req'));
  assert.equal(index.findings.length, 0);
});

test('emphasis, ranges, and "and"-separated lists are read; the list ends at other text', () => {
  const design = `# Design

### Property 1: Factory completeness

**Validates: Requirements 1.1, 6.2**

### Property 2: Ranges

Validates: Req 3.4-3.10 and 6.1. Later numbers 4.2, 5.1 are prose.
`;
  const index = analyze({ [spec('a/requirements.md')]: requirements, [spec('a/design.md')]: design });
  const refs = index.references.filter(item => item.file.endsWith('design.md'));
  assert.deepEqual(refs.map(item => [design.slice(item.offset, item.end), item.id, item.owner?.id]), [
    ['1.1', 'Requirement 1', 'Property 1'], ['6.2', 'Requirement 6', 'Property 1'],
    ['3.4', 'Requirement 3', 'Property 2'], ['3.10', 'Requirement 3', 'Property 2'], ['6.1', 'Requirement 6', 'Property 2'],
  ]);
});

test('labels without items, fenced and quoted lists, and mid-word labels produce nothing', () => {
  const text = `# Notes

Requirements: none yet.

Requirements Document follows.

> _Requirements: 1.1_

\`\`\`
_Requirements: 6.1_
\`\`\`

PreReq 1.1 is a different word.
`;
  const index = analyze({ [spec('a/requirements.md')]: requirements, [spec('a/notes.md')]: text });
  assert.deepEqual(index.references.filter(item => item.file.endsWith('notes.md')), []);
});

test('references resolve within their spec folder only and unknown numbers are unresolved', () => {
  const tasks = '# Tasks\n\n- _Requirements: 1.1, 9.1_\n';
  const index = analyze({ [spec('a/requirements.md')]: requirements, [spec('b/tasks.md')]: tasks, [spec('b/requirements.md')]: '### Requirement 9: Other\n' });
  const unresolved = index.findings.filter(item => item.kind === 'unresolved');
  assert.deepEqual(unresolved.map(item => [(item as { id?: string }).id, item.scope]), [['Requirement 1', '.kiro/specs/b']]);
  const definition = index.definitions.find(item => item.id === 'Requirement 9')!;
  assert.ok(index.references.some(item => item.id === 'Requirement 9' && idKey(item) === idKey(definition)));
});

test('list items never define IDs, even at the start of a heading or list item', () => {
  const text = '### Requirements: 1.1\n\n- Requirements: 6.1 first\n';
  const index = analyze({ [spec('a/requirements.md')]: requirements, [spec('a/other.md')]: text });
  assert.deepEqual(index.definitions.filter(item => item.file.endsWith('other.md')), []);
  assert.equal(index.references.filter(item => item.file.endsWith('other.md')).length, 2);
});

test('paragraph definitions start a plain paragraph and own the blocks up to the next heading or definition', () => {
  const design = `# Bugfix design

## Correctness Properties

Property 1: Bug Condition - Generator produces falsy values

_For any_ generated value, the result SHALL be false.

**Validates: Requirements 1.1**

**Property 2 — Preservation.** Behaviour is unchanged. **Validates: Req 6.1**

Verify that Property 1 tests continue to pass.

- Property 3: in a list item, so not a paragraph definition

> Property 4: quoted

## Fix

See Requirement 3.
`;
  const files = { [spec('a/requirements.md')]: requirements, [spec('a/design.md')]: design };
  assert.deepEqual(analyze(files).definitions.filter(item => item.file.endsWith('design.md')), [], 'disabled by default');
  const index = analyze(files, kiro(true));
  const definitions = index.definitions.filter(item => item.file.endsWith('design.md'));
  assert.deepEqual(definitions.map(item => [item.id, design.slice(item.offset, item.end), item.label]), [
    ['Property 1', 'Property 1', 'Property 1: Bug Condition - Generator produces falsy values'],
    ['Property 2', 'Property 2', 'Property 2 — Preservation. Behaviour is unchanged. Validates: Req 6.1'],
  ]);
  const owners = index.references.filter(item => item.file.endsWith('design.md')).map(item => [item.id, item.owner?.id]);
  assert.deepEqual(owners, [['Requirement 1', 'Property 1'], ['Requirement 6', 'Property 2'], ['Property 1', 'Property 2'], ['Property 3', 'Property 2'], ['Requirement 3', undefined]]);
});

test('labelled-list settings are validated', () => {
  const base = (list: unknown) => ({ version: 1, categories: [{ key: 'req', name: 'Requirement' }], rules: [{ key: 'list', category: 'req', list }] });
  const valid = validateIdConfiguration(base({ label: 'Requirements:', id: 'Requirement {number}' }));
  assert.equal(valid.rules[0].list?.item, String.raw`(?<number>\d+)(?:\.\d+)?`, 'the item pattern defaults to N or N.M');
  for (const [list, message] of [
    [{ label: '', id: 'Requirement {number}' }, /label must contain/],
    [{ label: '(', id: 'Requirement {number}' }, /label is an invalid/],
    [{ label: 'x?', id: 'Requirement {number}' }, /label matches empty text/],
    [{ label: 'Req', item: String.raw`\d+`, id: 'Requirement {number}' }, /named \(\?<number>/],
    [{ label: 'Req', item: String.raw`(?<number>\d*)`, id: 'Requirement {number}' }, /item pattern matches empty text/],
    [{ label: 'Req', id: 'Requirement' }, /needs \{placeholders\}/],
    [{ label: 'Req', id: 'Requirement {number' }, /needs \{placeholders\}/],
    [{ label: 'Req', id: 'Requirement {minor}' }, /uses \{minor\}/],
    [{ label: 'Req', id: 'Requirement {number}', extra: 1 }, /Unknown configuration field/],
  ] as const) assert.throws(() => validateIdConfiguration(base(list)), message);
  assert.throws(() => validateIdConfiguration({ ...base({ label: 'Req', id: 'R {number}' }), rules: [{ key: 'list', category: 'req', prefix: 'REQ', list: { label: 'Req', id: 'R {number}' } }] }), /exactly one prefix, pattern, or labelled list/);
  assert.throws(() => validateIdConfiguration({ ...base(undefined), rules: [{ key: 'list', category: 'req', separator: '-', list: { label: 'Req', id: 'R {number}' } }] }), /Separator applies only/);
  assert.throws(() => validateIdConfiguration({ version: 1, categories: [{ key: 'p', name: 'P', idDefinitionSites: { ...DEFAULT_ID_DEFINITION_SITES, paragraphs: { enabled: 'yes', mode: 'start' } } }], rules: [] }), /paragraph definition site/);
});

test('custom item captures fill the template, and other rules keep working beside list rules', () => {
  const configuration = validateIdConfiguration({ version: 1, categories: [{ key: 'req', name: 'Requirements' }],
    rules: [{ key: 'req', category: 'req', prefix: 'REQ' }, { key: 'list', category: 'req', list: { label: String.raw`\bsee requirements`, item: String.raw`(?<number>\d+)`, id: 'REQ-{number}' }, ignoreCase: true }] });
  const text = '# REQ-4 Login\n\n# REQ-7 Logout\n\nSee Requirements 4 and 7, and REQ-4.\n';
  const index = analyze({ 'a.md': text }, configuration);
  assert.deepEqual(index.references.map(item => [item.id, text.slice(item.offset, item.end)]), [['REQ-4', '4'], ['REQ-7', '7'], ['REQ-4', 'REQ-4']]);
  assert.equal(index.findings.length, 0);
  // Category removal looks at ID rules only; list rules have no ID pattern.
  assert.deepEqual(overridesForCategories({ ...configuration, moduleOverrides: [{ id: 'REQ-4', modules: [] }] } as IdConfiguration, ['req']), [idKey({ id: 'REQ-4' })]);
});

test('a paragraph definition owns the status paragraph that follows it, until the next heading', () => {
  const design = '# Design\n\nProperty 1: Round trip - values survive\n\nStatus: Implemented\n\n## Later\n\nStatus: Draft\n';
  const index = analyze({ [spec('a/requirements.md')]: requirements, [spec('a/design.md')]: design }, kiro(true));
  const property = index.definitions.find(item => item.id === 'Property 1')!;
  assert.deepEqual(property.authoredStatus?.evidence.map(item => item.value), ['Implemented']);
});
