import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIdConfiguration, compileIdMatcher, type IdConfiguration } from '../src/core/id-configuration';
import { assignModules } from '../src/core/modules';
import { analyzeDocument, buildIndex } from '../src/core/documents';
const config: IdConfiguration = { version: 1, categories: [{ key: 'needs', name: 'Requirements', role: 'requirement' }, { key: 'work', name: 'Tasks', role: 'task' }],
  rules: [{ key: 'ref', category: 'needs', prefix: 'REF' }, { key: 'task', category: 'work', prefix: 'WORK' }],
  modules: [{ key: 'gui', name: 'GUI' }, { key: 'backend', name: 'Backend' }],
  moduleRules: [{ key: 'gui-files', scope: 'folder', path: 'gui', modules: ['gui'] }, { key: 'shared', scope: 'file', path: 'gui/shared.md', modules: ['backend'] }, { key: 'backend-files', scope: 'folder', path: 'backend', modules: ['backend'] }],
};
function index(documents: Record<string, string>, configuration = config) {
  const validated = validateIdConfiguration(configuration), match = compileIdMatcher(validated);
  const base = buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, match)));
  const before = JSON.stringify(base); const result = assignModules(base, validated); assert.equal(JSON.stringify(base), before); return result;
}
test('file rules classify requirements and tasks independently; overlapping rules combine and references inherit definition membership', () => {
  const result = index({ 'gui/shared.md': '# REF-1 Requirement\nWORK-1\n# WORK-1 Task', 'backend/mention.md': 'REF-1 REF-404', 'gui-other/a.md': '# REF-2' });
  for (const item of [...result.definitions, ...result.references].filter(item => ['REF-1', 'WORK-1'].includes(item.id))) {
    assert.equal(item.moduleAssignment?.state, 'assigned'); assert.deepEqual(item.moduleAssignment?.modules.map(m => m.key), ['backend', 'gui']);
    assert.equal(item.moduleAssignment?.evidence.length, 2); assert.equal(item.moduleAssignment?.evidence[0].source?.file, 'gui/shared.md');
  }
  assert.equal(result.definitions[0].category?.role, 'requirement'); assert.equal(result.definitions[1].category?.role, 'task');
  assert.equal(result.definitions.find(item => item.id === 'REF-2')?.moduleAssignment?.state, 'unassigned');
  assert.equal(result.references.find(item => item.id === 'REF-404')?.moduleAssignment?.state, 'unassigned');
});
test('exact-ID overrides replace combined file rules, support explicit unassigned and preserve exact spelling', () => {
  const result = index({ 'gui/shared.md': '# REF-1\n# WORK-1\nREF-404 REF-01' }, { ...config, moduleOverrides: [{ id: 'REF-1', modules: ['backend'] }, { id: 'WORK-1', modules: [] }, { id: 'REF-404', modules: ['gui'] }] });
  assert.deepEqual(result.definitions[0].moduleAssignment?.modules.map(m => m.key), ['backend']);
  assert.deepEqual(result.definitions[1].moduleAssignment?.evidence, [{ kind: 'id-override', id: 'WORK-1', modules: [] }]);
  assert.equal(result.references.find(item => item.id === 'REF-404')?.moduleAssignment?.state, 'assigned');
  assert.equal(result.references.find(item => item.id === 'REF-01')?.moduleAssignment?.state, 'unassigned');
});
test('duplicate definitions keep conflicting candidates as evidence without guessing a membership; overrides resolve only assignment conflict', () => {
  const documents = { 'gui/a.md': '# REF-1', 'backend/b.md': '# REF-1', 'notes.md': 'REF-1' };
  const result = index(documents);
  assert.equal(result.definitions[0].moduleAssignment?.state, 'conflict'); assert.deepEqual(result.definitions[0].moduleAssignment?.modules, []);
  assert.deepEqual(result.definitions[0].moduleAssignment?.evidence.map(e => e.modules[0].key), ['gui', 'backend']);
  assert.equal(result.findings.filter(item => item.kind === 'module-conflict').length, 2);
  assert.equal(result.references[0].moduleAssignment?.state, 'conflict');
  const resolved = index(documents, { ...config, moduleOverrides: [{ id: 'REF-1', modules: [] }] });
  assert.deepEqual(resolved.findings.map(item => item.kind), ['duplicate', 'duplicate']);
  assert.equal(resolved.definitions[0].moduleAssignment?.state, 'unassigned');
  assert.equal(index({ 'gui/a.md': '# REF-1', 'gui/b.md': '# REF-1' }).definitions[0].moduleAssignment?.state, 'assigned');
});
test('moving a definition refreshes modules without altering ID/category; absent configuration remains compatible', () => {
  const before = index({ 'gui/a.md': '# REF-1' }), after = index({ 'backend/a.md': '# REF-1' });
  assert.equal(before.definitions[0].moduleAssignment?.modules[0].key, 'gui'); assert.equal(after.definitions[0].moduleAssignment?.modules[0].key, 'backend');
  assert.equal(after.definitions[0].id, before.definitions[0].id); assert.deepEqual(after.definitions[0].category, before.definitions[0].category);
  const legacy = { version: 1 as const, categories: config.categories, rules: config.rules };
  assert.equal(index({ 'gui/a.md': '# REF-1' }, legacy).definitions[0].moduleAssignment, undefined);
});
test('module schema rejects traversal, wildcard/absolute paths, unknown/duplicate modules and conflicting override entries', () => {
  for (const path of ['../outside', '/absolute', 'C:/outside', 'gui\\a.md', 'gui/*.md', 'gui/', 'gui//a.md', 'gui/../a.md']) assert.throws(() => validateIdConfiguration({ ...config, moduleRules: [{ ...config.moduleRules![0], path }] }), /project-relative/);
  for (const patch of [{ modules: [config.modules![0], config.modules![0]] }, { modules: [{ key: 'a', name: '' }] },
    { moduleRules: [{ ...config.moduleRules![0], modules: [] }] }, { moduleRules: [{ ...config.moduleRules![0], modules: ['missing'] }] },
    { moduleRules: [config.moduleRules![0], config.moduleRules![0]] }, { moduleOverrides: [{ id: 'REF-1', modules: ['gui', 'gui'] }] },
    { moduleOverrides: [{ id: 'REF-1', modules: [] }, { id: 'REF-1', modules: ['gui'] }] }, { moduleOverrides: [{ id: '', modules: [] }] }]) assert.throws(() => validateIdConfiguration({ ...config, ...patch }));
  assert.equal(index({ 'nested/a.md': '# REF-1' }, { ...config, moduleRules: [{ key: 'all', scope: 'folder', path: '.', modules: ['gui'] }] }).definitions[0].moduleAssignment?.state, 'assigned');
});
