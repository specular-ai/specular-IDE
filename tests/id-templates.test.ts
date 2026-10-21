import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, matchesIds, validateIdConfiguration, type IdConfiguration, type IdRule } from '../src/core/id-configuration';
import { overridesForCategories } from '../src/core/category-overrides';

// Increment 89: ID templates make aliases such as US1 references to the templated ID, such as User Story 1.
const stories = (rules: Omit<IdRule, 'category'>[] = [
  { key: 'story', pattern: String.raw`\bUser Story \d+\b` },
  { key: 'us', pattern: String.raw`\bUS(?<n>\d+)\b`, id: 'User Story {n}' },
]): IdConfiguration => validateIdConfiguration({
  version: 1,
  categories: [{ key: 'story', name: 'User story', idScopes: [{ pattern: 'specs/*' }] }, { key: 'task', name: 'Task', role: 'task', idScopes: [{ pattern: 'specs/*' }] }],
  rules: [...rules.map(rule => ({ ...rule, category: 'story' })), { key: 'task', category: 'task', pattern: String.raw`\bT\d{3}\b` }],
});
const analyze = (files: Record<string, string>, configuration: IdConfiguration) => {
  const matcher = compileIdMatcher(configuration);
  return buildIndex(Object.entries(files).map(([file, text]) => analyzeDocument(file, text, matcher)));
};
const spec = `# Feature

### User Story 1 - Generate the summary (Priority: P1)

### User Story 2 - Export it (Priority: P2)
`;
const tasks = `# Tasks

## Phase 3: User Story 1

- [ ] T001 [US1] Build the summary
- [ ] T002 [US2] Export, after US1
- [ ] T003 [US3] Unknown story
`;

test('US1, [US1], and a User Story 1 heading are one element, resolved within their folder', () => {
  const index = analyze({ 'specs/001-a/spec.md': spec, 'specs/001-a/tasks.md': tasks, 'specs/002-b/spec.md': '### User Story 1 - Other\n' }, stories());
  const refs = index.references.filter(item => item.file === 'specs/001-a/tasks.md' && item.category?.key === 'story');
  assert.deepEqual(refs.map(item => [tasks.slice(item.offset, item.end), item.id, item.scope]), [
    ['User Story 1', 'User Story 1', 'specs/001-a'], ['US1', 'User Story 1', 'specs/001-a'], ['US2', 'User Story 2', 'specs/001-a'],
    ['US1', 'User Story 1', 'specs/001-a'], ['US3', 'User Story 3', 'specs/001-a'],
  ]);
  const unresolved = index.findings.filter(item => item.kind === 'unresolved').map(item => tasks.slice(item.offset, item.end));
  assert.deepEqual(unresolved.filter(text => text.startsWith('US')), ['US3']);
  assert.equal(index.definitions.filter(item => item.category?.key === 'story').length, 3);
});

test('templated matches starting headings and list items do not define IDs', () => {
  const text = '# Notes\n\n## US1 overview\n\n- US2 first\n';
  const index = analyze({ 'specs/001-a/spec.md': spec, 'specs/001-a/notes.md': text }, stories());
  assert.deepEqual(index.definitions.filter(item => item.file.endsWith('notes.md')), []);
  assert.deepEqual(index.references.filter(item => item.file.endsWith('notes.md')).map(item => [text.slice(item.offset, item.end), item.id]), [['US1', 'User Story 1'], ['US2', 'User Story 2']]);
});

test('{n:03} makes FR-1 refer to FR-001, and {n:int} makes FR-001 refer to FR-1', () => {
  const requirements = (defined: string, aliases: string, id: string): IdConfiguration => validateIdConfiguration({ version: 1, categories: [{ key: 'fr', name: 'Requirement' }],
    rules: [{ key: 'fr', category: 'fr', pattern: defined }, { key: 'alias', category: 'fr', pattern: aliases, id }] });
  const text = '### FR-001 Login\n\nSee FR-1, FR-12, and FR-001.\n';
  const padded = analyze({ 'spec.md': text }, requirements(String.raw`\bFR-\d{3}\b`, String.raw`\bFR-(?<n>[1-9]\d?)\b`, 'FR-{n:03}'));
  assert.deepEqual(padded.references.map(item => item.id), ['FR-001', 'FR-012', 'FR-001']);
  assert.deepEqual(padded.findings.filter(item => item.kind === 'unresolved').map(item => text.slice(item.offset, item.end)), ['FR-12']);
  const plain = analyze({ 'spec.md': '### FR-1 Login\n\nSee FR-001 and FR-1.\n' }, requirements(String.raw`\bFR-[1-9]\d*\b`, String.raw`\bFR-(?<n>0\d+)\b`, 'FR-{n:int}'));
  assert.deepEqual(plain.references.map(item => item.id), ['FR-1', 'FR-1']);
  assert.equal(plain.findings.filter(item => item.kind === 'unresolved').length, 0);
});

test('formats leave non-digit captures unchanged, and labelled lists share them', () => {
  const configuration = validateIdConfiguration({ version: 1, categories: [{ key: 'r', name: 'R' }], rules: [
    { key: 'alias', category: 'r', pattern: String.raw`\bR(?<n>[0-9A-Z]+)\b`, id: 'Req {n:int}' },
    { key: 'list', category: 'r', list: { label: 'Requirements:', id: 'Req {number:02}' } },
  ] });
  const matches = compileIdMatcher(configuration)('R007 RAB Requirements: 3.1, 012');
  assert.deepEqual(matches.map(item => [item.id, item.listed]), [['Req 7', true], ['Req AB', true], ['Req 03', true], ['Req 12', true]]);
});

test('invalid templates are rejected', () => {
  const rule = (extra: Record<string, unknown>) => () => validateIdConfiguration({ version: 1, categories: [{ key: 'us', name: 'Story' }], rules: [{ key: 'us', category: 'us', ...extra }] });
  assert.throws(rule({ pattern: String.raw`\bUS(?<n>\d+)\b`, id: 'User Story' }), /needs \{placeholders\} such as User Story \{n\}/);
  assert.throws(rule({ pattern: String.raw`\bUS(?<n>\d+)\b`, id: 'User Story {m}' }), /uses \{m\}, which the pattern does not capture/);
  assert.throws(rule({ pattern: String.raw`\bUS(?<n>\d+)\b`, id: 'User Story {n:hex}' }), /format in \{n:hex\} is unknown/);
  assert.throws(rule({ pattern: String.raw`\bUS(?<n>\d+)\b`, id: 'User Story {n:3}' }), /format in \{n:3\} is unknown/);
  assert.throws(rule({ pattern: String.raw`\bUS(?<n>\d+)\b`, id: '' }), /1-128 characters/);
  assert.throws(rule({ prefix: 'US', id: 'User Story {n}' }), /applies only to regex pattern rules/);
  assert.throws(rule({ list: { label: 'US:', id: 'User Story {number}' }, id: 'User Story {number}' }), /applies only to regex pattern rules/);
  assert.throws(rule({ list: { label: 'US:', id: 'User Story {number:pad}' } }), /format in \{number:pad\} is unknown/);
});

test('an alias overlapping another rule stays a recognition error', () => {
  const configuration = stories([
    { key: 'story', pattern: String.raw`\bUser Story \d+\b` },
    { key: 'us', pattern: String.raw`\bUS(?<n>\d+)\b`, id: 'User Story {n}' },
    { key: 'list', list: { label: String.raw`\[`, item: String.raw`US(?<number>\d+)`, id: 'User Story {number}' } },
  ]);
  assert.throws(() => compileIdMatcher(configuration)('- [ ] T001 [US1] Build'), /overlap on "User Story 1"/);
});

test('category removal treats templated rules as non-ID rules', () => {
  const configuration = stories();
  assert.deepEqual(configuration.rules.map(matchesIds), [true, false, true]);
  const removed = overridesForCategories({ ...configuration, moduleOverrides: [{ id: 'User Story 1', modules: [] }, { id: 'US1', modules: [] }] } as IdConfiguration, ['story']);
  assert.deepEqual(removed, ['User Story 1']);
});
