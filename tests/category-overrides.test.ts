import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overridesForCategories } from '../src/core/category-overrides';
import type { IdConfiguration } from '../src/core/id-configuration';

const configuration: IdConfiguration = {
  version: 1, categories: [{ key: 'needs', name: 'Requirements' }, { key: 'other', name: 'Other' }],
  rules: [
    { key: 'ref', category: 'needs', prefix: 'REF', separator: '_', ignoreCase: true },
    { key: 'feature', category: 'needs', pattern: 'feature/[a-z]+' },
    { key: 'req', category: 'other', prefix: 'REQ' },
  ],
  modules: [{ key: 'gui', name: 'GUI' }],
  moduleOverrides: ['REF_01', 'ref_999', 'feature/login', 'feature/future', 'REQ-01', 'UNKNOWN-1', 'REF-01', 'REF_01/extra', 'feature/login/extra']
    .map(id => ({ id, modules: id === 'ref_999' ? [] : ['gui'] })),
};

test('category override cleanup uses full ID matches, case and separator rules, including IDs absent from Markdown', () => {
  const before = structuredClone(configuration);
  assert.deepEqual(overridesForCategories(configuration, ['needs']), ['REF_01', 'ref_999', 'feature/login', 'feature/future']);
  assert.deepEqual(overridesForCategories(configuration, ['needs', 'other']), ['REF_01', 'ref_999', 'feature/login', 'feature/future', 'REQ-01']);
  assert.deepEqual(configuration, before);
});

test('category cleanup uses current draft rules and tolerates unrelated invalid draft fields', () => {
  const draft = structuredClone(configuration);
  draft.categories[0].name = '';
  draft.rules[0].prefix = 'NEW';
  draft.rules[2] = { key: 'req', category: 'other', pattern: '(' };
  draft.moduleOverrides!.push({ id: 'NEW_02', modules: ['missing'] });
  assert.deepEqual(overridesForCategories(draft, ['needs']), ['feature/login', 'feature/future', 'NEW_02']);
});

test('categories without recognition rules preserve overrides; invalid selected rules fail without mutating the draft', () => {
  assert.deepEqual(overridesForCategories({ ...configuration, rules: [] }, ['needs']), []);
  assert.deepEqual(overridesForCategories({ ...configuration, moduleOverrides: undefined }, ['needs']), []);
  const draft = structuredClone(configuration);
  draft.rules[0] = { key: 'ref', category: 'needs', pattern: '(' };
  const before = structuredClone(draft);
  assert.throws(() => overridesForCategories(draft, ['needs']));
  assert.deepEqual(draft, before);
});
