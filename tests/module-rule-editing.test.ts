import { test } from 'node:test';
import assert from 'node:assert/strict';
import { editModuleFileRule, removeModuleFileRule, removeProjectModule, editModuleOverride, mergeModuleOverride, removeModuleOverride } from '../src/core/module-rule-editing';
import { compileIdMatcher, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { assignModules } from '../src/core/modules';

function fixture(): IdConfiguration {
  return { version: 1, categories: [{ key: 'req', name: 'Requirements' }], rules: [{ key: 'req', category: 'req', prefix: 'REQ' }],
    modules: [{ key: 'gui', name: 'GUI' }, { key: 'backend', name: 'Backend' }, { key: 'api', name: 'API' }],
    moduleRules: [{ key: 'shared', path: 'gui', scope: 'folder', modules: ['gui', 'backend', 'api'] }],
    moduleOverrides: [{ id: 'REQ-2', modules: ['api'] }, { id: 'REQ-3', modules: [] }] };
}
function assignments(config: IdConfiguration) {
  const valid = validateIdConfiguration(JSON.parse(JSON.stringify(config))), matcher = compileIdMatcher(valid);
  return assignModules(buildIndex([analyzeDocument('gui/a.md', '# REQ-1\n# REQ-2\n# REQ-3', matcher), analyzeDocument('backend/a.md', '# REQ-4', matcher)]), valid).definitions;
}
test('shared module rules detach only an edited owner and preserve matching, override precedence, and source evidence after round-trip', () => {
  const config = fixture(), shared = config.moduleRules![0], before = structuredClone(shared);
  assert.equal(editModuleFileRule(config, shared, 'gui', { path: 'gui', scope: 'folder' }), shared);
  assert.deepEqual(shared, before); assert.equal(config.moduleRules!.length, 1);
  assert.deepEqual(assignments(config)[0].moduleAssignment?.modules.map(m => m.key), ['api', 'backend', 'gui']);
  const owned = editModuleFileRule(config, shared, 'gui', { path: 'backend/a.md', scope: 'file' });
  assert.deepEqual(shared, { ...before, modules: ['backend', 'api'] }); assert.deepEqual(owned.modules, ['gui']); assert.notEqual(owned.key, shared.key);
  const result = assignments(config);
  assert.deepEqual(result.map(d => d.moduleAssignment?.modules.map(m => m.key)), [['api', 'backend'], ['api'], [], ['gui']]);
  assert.equal(result[0].moduleAssignment?.evidence[0].rule, 'shared'); assert.equal(result[0].moduleAssignment?.evidence[0].source?.file, 'gui/a.md');
  const same = editModuleFileRule(config, owned, 'gui', { path: 'backend', scope: 'folder' }); assert.equal(same, owned); assert.equal(config.moduleRules!.length, 2);
  removeModuleFileRule(config, shared, 'backend'); assert.deepEqual(shared.modules, ['api']);
  removeModuleFileRule(config, shared, 'api'); assert.deepEqual(config.moduleRules, [owned]); validateIdConfiguration(config);
});
test('shared-rule split checks capacity before mutation and gives every detached rule a unique bounded key', () => {
  const config = fixture();
  config.moduleRules!.push(...Array.from({ length: 127 }, (_, i) => ({ key: i === 0 ? 'files' : `files-${i + 1}`, path: 'gui', scope: 'folder' as const, modules: ['gui'] })));
  const before = structuredClone(config), shared = config.moduleRules![0];
  assert.throws(() => editModuleFileRule(config, shared, 'backend', { path: 'backend' }), /128/); assert.deepEqual(config, before);
  assert.equal(editModuleFileRule(config, shared, 'backend', { path: 'gui' }), shared);
  removeModuleFileRule(config, config.moduleRules![1], 'gui');
  const owned = editModuleFileRule(config, shared, 'backend', { path: 'backend' });
  assert.equal(owned.key, 'files'); assert.equal(new Set(config.moduleRules!.map(r => r.key)).size, 128); validateIdConfiguration(config);
});
test('module deletion removes only its assignments and preserves empty overrides instead of restoring inherited memberships', () => {
  const config = fixture(); config.moduleOverrides!.push({ id: 'REQ-1', modules: ['gui', 'backend'] });
  removeProjectModule(config, 'api'); removeProjectModule(config, 'gui');
  assert.deepEqual(config.moduleRules![0].modules, ['backend']);
  assert.deepEqual(config.moduleOverrides, [{ id: 'REQ-2', modules: [] }, { id: 'REQ-3', modules: [] }, { id: 'REQ-1', modules: ['backend'] }]);
  assert.deepEqual(assignments(config).map(d => d.moduleAssignment?.modules.map(m => m.key)), [['backend'], [], [], []]);
  removeProjectModule(config, 'backend'); assert.deepEqual(config.moduleRules, []); validateIdConfiguration(config);
});

test('nested override edits detach one owner and merge completed IDs without losing other explicit targets', () => {
  const config = fixture(); config.moduleOverrides = [{ id: 'REQ-1', modules: ['gui', 'backend'] }, { id: 'REQ-4', modules: ['api'] }];
  const shared = config.moduleOverrides[0]; assert.equal(editModuleOverride(config, shared, 'gui', 'REQ-1'), shared);
  const owned = editModuleOverride(config, shared, 'gui', 'REQ-4'); assert.deepEqual(shared, { id: 'REQ-1', modules: ['backend'] });
  const merged = mergeModuleOverride(config, owned); assert.deepEqual(merged, { id: 'REQ-4', modules: ['api', 'gui'] }); assert.equal(config.moduleOverrides.length, 2);
  assert.deepEqual(assignments(config)[3].moduleAssignment?.modules.map(m => m.key), ['api', 'gui']);
  removeModuleOverride(config, merged, 'gui'); assert.deepEqual(merged.modules, ['api']);
  removeModuleOverride(config, merged, 'api'); assert.deepEqual(merged.modules, []); assert.equal(assignments(config)[3].moduleAssignment?.state, 'unassigned');
  const fresh = { id: 'REQ-4', modules: ['backend'] }; config.moduleOverrides.push(fresh);
  assert.equal(mergeModuleOverride(config, fresh), merged); assert.deepEqual(merged.modules, ['backend']); validateIdConfiguration(config);
});

test('shared override edits reject over-capacity mutations; single-target edits and duplicate-target merges stay valid', () => {
  const config = fixture(); config.moduleOverrides = [{ id: 'REQ-1', modules: ['gui', 'backend'] }, ...Array.from({ length: 255 }, (_, i) => ({ id: `REQ-${i + 2}`, modules: ['gui'] }))];
  const before = structuredClone(config); assert.throws(() => editModuleOverride(config, config.moduleOverrides![0], 'gui', 'REQ-999'), /256/); assert.deepEqual(config, before);
  const single = config.moduleOverrides[1]; editModuleOverride(config, single, 'gui', 'REQ-1');
  const merged = mergeModuleOverride(config, single); assert.deepEqual(merged.modules, ['gui', 'backend']); assert.equal(config.moduleOverrides.length, 255); validateIdConfiguration(config);
});
