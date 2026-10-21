import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, validateIdConfiguration, type IdCategory, type IdConfiguration } from '../src/core/id-configuration';
import { pathsContain, validateDefinitionPaths } from '../src/core/id-scopes';

const configuration = (category: Partial<IdCategory>, rules: IdConfiguration['rules'] = [{ key: 'T', category: 'tasks', prefix: 'T', separator: '' }]): IdConfiguration =>
  ({ version: 1, categories: [{ key: 'tasks', name: 'Tasks', role: 'task', ...category }], rules, idDefinitionSites: sites });
const sites = { headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' as const }, tables: { enabled: true, column: 'ID', mode: 'exact' as const },
  lists: { enabled: true, types: ['unordered' as const, 'ordered' as const], mode: 'start' as const }, paragraphs: { enabled: false, mode: 'start' as const } };
const index = (documents: Record<string, string>, config: IdConfiguration) => {
  const matcher = compileIdMatcher(config);
  return buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, matcher)));
};
const ids = (items: { id: string; file: string; scope?: string }[]) => items.map(item => `${item.file}:${item.id}${item.scope ? '@' + item.scope : ''}`).sort();

test('onlyInScopes recognizes a category only inside its scope patterns', () => {
  const documents = { 'specs/001/tasks.md': '- T001 Build\n- T002 Test, after T001\n', 'README.md': 'See T001 and T009.\n' };
  const scoped = index(documents, configuration({ idScopes: [{ pattern: 'specs/*' }], onlyInScopes: true }));
  assert.deepEqual(ids(scoped.definitions), ['specs/001/tasks.md:T001@specs/001', 'specs/001/tasks.md:T002@specs/001']);
  assert.deepEqual(ids(scoped.references), ['specs/001/tasks.md:T001@specs/001']);
  assert.equal(scoped.findings.filter(item => item.kind === 'unresolved').length, 0);
  // Without the option, README.md gives project-scope references as before.
  const plain = index(documents, configuration({ idScopes: [{ pattern: 'specs/*' }] }));
  assert.deepEqual(ids(plain.references).filter(item => item.startsWith('README')), ['README.md:T001', 'README.md:T009']);
  assert.equal(plain.findings.filter(item => item.kind === 'unresolved').length, 2);
});

test('a file scope with onlyInScopes limits matching to those files, and disabled patterns do not count', () => {
  const documents = { 'openspec/changes/a/tasks.md': '- 1.1 Add parser\n', 'openspec/changes/a/design.md': '## 1.1 Context\n\nSee 2.3 Options.\n' };
  const rules = [{ key: 'task', category: 'tasks', pattern: String.raw`^\d+\.\d+(?=\s+[A-Z])` }];
  const scoped = index(documents, configuration({ idScopes: [{ pattern: 'openspec/changes/**/tasks.md' }], onlyInScopes: true }, rules));
  assert.deepEqual(ids(scoped.definitions), ['openspec/changes/a/tasks.md:1.1@openspec/changes/a/tasks.md']);
  assert.deepEqual(scoped.references, []);
  const disabled = index(documents, configuration({ idScopes: [{ pattern: 'openspec/changes/**/tasks.md', enabled: false }, { pattern: 'openspec/*' }], onlyInScopes: true }, rules));
  assert.equal(disabled.definitions.length, 2);
});

test('onlyInScopes needs an enabled scope pattern', () => {
  assert.throws(() => validateIdConfiguration(configuration({ onlyInScopes: true })), /at least one enabled scope pattern/);
  assert.throws(() => validateIdConfiguration(configuration({ idScopes: [{ pattern: 'specs/*', enabled: false }], onlyInScopes: true })), /at least one enabled scope pattern/);
  assert.throws(() => validateIdConfiguration(configuration({ idScopes: [{ pattern: 'specs/*' }], onlyInScopes: 'yes' as unknown as boolean })), /onlyInScopes must be a boolean/);
  assert.equal(validateIdConfiguration(configuration({ idScopes: [{ pattern: 'specs/*' }], onlyInScopes: false })).categories[0].onlyInScopes, undefined);
});

test('overlaps are checked only among the rules that run in the file', () => {
  const config: IdConfiguration = { version: 1,
    categories: [{ key: 'tasks', name: 'Tasks', idScopes: [{ pattern: 'specs/*' }], onlyInScopes: true }, { key: 'sections', name: 'Sections' }],
    rules: [{ key: 'task', category: 'tasks', pattern: String.raw`\b\d+\.\d+\b` }, { key: 'section', category: 'sections', pattern: String.raw`§\d+\.\d+` }] };
  assert.doesNotThrow(() => index({ 'docs/guide.md': '# §1.2 Intro\n' }, config));
  assert.throws(() => index({ 'specs/001/guide.md': '# §1.2 Intro\n' }, config), /overlap/);
});

test('definition paths make definition sites elsewhere references in their file scope', () => {
  const config = configuration({ idScopes: [{ pattern: 'specs/*' }], definitionPaths: ['specs/*/tasks.md'] });
  const result = index({ 'specs/001/tasks.md': '- T001 Build the parser\n', 'specs/001/plan.md': '- T001 Build the parser (summary)\n\n## T002 Not here\n' }, config);
  assert.deepEqual(ids(result.definitions), ['specs/001/tasks.md:T001@specs/001']);
  assert.deepEqual(ids(result.references), ['specs/001/plan.md:T001@specs/001', 'specs/001/plan.md:T002@specs/001']);
  assert.equal(result.findings.filter(item => item.kind === 'duplicate').length, 0);
  assert.deepEqual(result.findings.filter(item => item.kind === 'unresolved').map(item => item.message), ['No definition found for T002 · specs/001.']);
});

test('definition paths do not affect derived elements, and a folder path covers everything below it', () => {
  const config: IdConfiguration = { version: 1,
    categories: [{ key: 'capability', name: 'Capabilities', derive: { pattern: 'openspec/specs/{capability}/spec.md' }, definitionPaths: ['docs'] }, { key: 'tasks', name: 'Tasks', definitionPaths: ['docs'] }],
    rules: [{ key: 'T', category: 'tasks', prefix: 'T', separator: '' }] };
  const result = index({ 'openspec/specs/auth/spec.md': '# Auth\n\n## T001 Login\n', 'docs/deep/tasks.md': '## T001 Login\n' }, config);
  assert.deepEqual(ids(result.definitions), ['docs/deep/tasks.md:T001', 'openspec/specs/auth/spec.md:auth@capability:auth']);
  assert.deepEqual(ids(result.references), ['openspec/specs/auth/spec.md:T001']);
});

test('definition paths use the scope syntax without captures', () => {
  assert.deepEqual(validateDefinitionPaths(['specs/*/tasks.md', 'docs/specs', '**/tasks.md', 'plans/004-*']), ['specs/*/tasks.md', 'docs/specs', '**/tasks.md', 'plans/004-*']);
  for (const invalid of [[], ['specs/{feature}/tasks.md'], ['../tasks.md'], ['node_modules/x.md'], ['/abs/tasks.md'], ['*'], ['specs/'], [1], 'specs', ['a.md', 'A.md'],
    Array.from({ length: 33 }, (_value, index) => `f${index}.md`)]) {
    assert.throws(() => validateDefinitionPaths(invalid), /Definition path/, JSON.stringify(invalid));
  }
  assert.throws(() => validateIdConfiguration(configuration({ definitionPaths: ['specs/{x}/tasks.md'] })), /Category 1: Definition path/);
  assert.ok(pathsContain('specs/001/tasks.md', ['specs/*/tasks.md']));
  assert.ok(!pathsContain('specs/001/plan.md', ['specs/*/tasks.md']));
  assert.ok(pathsContain('docs/specs/a/b.md', ['docs/specs']));
  assert.ok(!pathsContain('docs/specsx/b.md', ['docs/specs']));
  assert.ok(pathsContain('a/b/tasks.md', ['**/tasks.md']));
});

test('rejections name a misplaced field and suggest a glob for a literal scope folder (92)', () => {
  const base = (category: object, extra: object = {}) => ({ version: 1, categories: [{ key: 'a', name: 'A', ...category }], rules: [], ...extra });
  const error = (input: unknown) => { try { validateIdConfiguration(input); } catch (e) { return (e as Error).message; } return ''; };
  assert.match(error(base({ idScopes: [{ pattern: 'specs/013-layout-routing-refactor' }] })), /ends in a literal folder.*such as specs\/013-\*.*use definitionPaths/);
  assert.match(error(base({ idScopes: [{ pattern: 'docs' }] })), /such as docs\/\*/);
  assert.match(error(base({ idDefinitionSites: { ...sites, definitionPaths: ['a.md'] } })), /Unknown ID definition site field "definitionPaths"\. definitionPaths is a category field; put it on the category\./);
  assert.match(error(base({}, { onlyInScopes: true })), /Unknown configuration field "onlyInScopes"\. onlyInScopes is a category field/);
  assert.match(error(base({ prefix: 'A' })), /Unknown configuration field "prefix"\. prefix is a rule field; put it in a rule\./);
});
