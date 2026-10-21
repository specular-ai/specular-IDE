import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDiscoveryCategory } from '../src/core/discovery-category-classification';
import type { ConventionSuggestion } from '../src/core/id-discovery';
import type { IdConfiguration, IdRule } from '../src/core/id-configuration';

const category = (key: string, name = key) => ({ key, name });
const rule = (key: string, owner: string, value: Partial<IdRule>): IdRule => ({ key, category: owner, ...value });
const draft = (rules: IdRule[], categories = [category('req', 'Renamed requirements'), category('task', 'Tasks')]): IdConfiguration => ({ version: 1, categories, rules });
const suggestion = (key: string, name: string, value: Partial<IdRule>, ids = ['REQ-1']): ConventionSuggestion => ({
  key, category: category(key, name), rule: rule(key, key, value), uncertainty: 'Fixture evidence.',
  evidence: ids.map((id, i) => ({ id, file: 'a.md', offset: i * 10, end: i * 10 + id.length, context: 'heading' })),
});
const decide = (configuration: IdConfiguration, candidate: ConventionSuggestion, owners: string[][], proposal?: ConventionSuggestion[]) =>
  classifyDiscoveryCategory(configuration, candidate, { owners }, proposal);

test('existing-category decision table uses rule identity rather than mutable labels', () => {
  const configured = draft([rule('req-rule', 'req', { prefix: 'REQ' })]);
  assert.deepEqual(decide(configured, suggestion('found', 'Requirements', { prefix: 'REQ' }), [['req']]), { kind: 'existing', category: 'req', reason: 'equivalent-rule' });
  assert.deepEqual(decide(configured, suggestion('found', 'Anything', { pattern: '\\bREQ-\\d+\\b' }), [['req']]), { kind: 'existing', category: 'req', reason: 'equivalent-rule' });
  assert.deepEqual(decide(configured, suggestion('found', 'Bad edit', { pattern: '\\bREQ-\\d+\\b' }, ['REF-1']), [[]]), { kind: 'ambiguous', reason: 'equivalent-rule-evidence-mismatch' });
  const underscored = draft([rule('decision-rule', 'req', { prefix: 'DEC', separator: '_' })]);
  assert.equal(decide(underscored, suggestion('found', 'Decisions', { pattern: '\\bDEC_\\d+\\b' }, ['DEC_1']), [['req']]).kind, 'existing');
  assert.deepEqual(decide(configured, suggestion('found', 'Renamed requirements', { prefix: 'REQ', separator: '_' }), [[]]), { kind: 'ambiguous', reason: 'display-name-collision' });
});

test('finite evidence reports partial, wider and conflicting recognition as ambiguous', () => {
  const configured = draft([rule('req-rule', 'req', { prefix: 'REQ' }), rule('task-rule', 'task', { prefix: 'TASK' })]);
  const wider = suggestion('found', 'Records', { pattern: '\\b(?:REQ|TASK)-\\d+\\b' }, ['REQ-1', 'TASK-1']);
  assert.deepEqual(decide(configured, wider, [['req'], ['task']]), { kind: 'ambiguous', reason: 'multiple-existing-categories' });
  assert.deepEqual(decide(configured, suggestion('found', 'Records', { pattern: '\\bREC-\\d+\\b' }, ['REQ-1', 'REC-1']), [['req'], []]), { kind: 'ambiguous', reason: 'partial-evidence-coverage' });
  assert.deepEqual(decide(configured, suggestion('found', 'Requirements plus', { pattern: '\\bREQ-(?:\\d+|X)\\b' }), [['req']]), { kind: 'ambiguous', reason: 'different-rule-for-existing-evidence' });
});

test('new categories remain new while name and proposal identity collisions stay explicit', () => {
  const configured = draft([rule('req-rule', 'req', { prefix: 'REQ' })]);
  const fresh = suggestion('adr', 'Architecture records', { prefix: 'ADR' }, ['ADR-1']);
  assert.deepEqual(decide(configured, fresh, [[]]), { kind: 'new', reason: 'unrecognized-convention' });
  const sibling = suggestion('adr', 'Architecture records', { prefix: 'DEC' }, ['DEC-1']);
  assert.deepEqual(decide(configured, fresh, [[]], [fresh, sibling]), { kind: 'new', reason: 'shared-proposal-category' });
  const collidingPair = [suggestion('shared', 'Tasks', { prefix: 'WORK' }, ['WORK-1']), suggestion('shared', 'Tasks', { prefix: 'JOB' }, ['JOB-1'])];
  assert.deepEqual(decide(configured, collidingPair[0], [[]], collidingPair), { kind: 'ambiguous', reason: 'display-name-collision' });
  const conflicting = suggestion('adr', 'Different label', { prefix: 'DEC' }, ['DEC-1']);
  assert.deepEqual(decide(configured, fresh, [[]], [fresh, conflicting]), { kind: 'ambiguous', reason: 'proposal-category-collision' });
  const conflictingColor = structuredClone(sibling); conflictingColor.category.colors = { dark: '#112233' };
  assert.deepEqual(decide(configured, fresh, [[]], [fresh, conflictingColor]), { kind: 'ambiguous', reason: 'proposal-category-collision' });
  const sameName = suggestion('other', 'Architecture records', { prefix: 'ARC' }, ['ARC-1']);
  assert.deepEqual(decide(configured, fresh, [[]], [fresh, sameName]), { kind: 'ambiguous', reason: 'display-name-collision' });
});

test('staging changes the next decision without requiring a saved configuration', () => {
  const candidate = suggestion('adr', 'Architecture records', { prefix: 'ADR' }, ['ADR-1']);
  const before = draft([rule('req-rule', 'req', { prefix: 'REQ' })]);
  assert.equal(decide(before, candidate, [[]]).kind, 'new');
  const staged: IdConfiguration = { ...before, categories: [...before.categories, category('staged', 'Architecture records')], rules: [...before.rules, rule('staged-rule', 'staged', { prefix: 'ADR' })] };
  assert.deepEqual(decide(staged, candidate, [['staged']]), { kind: 'existing', category: 'staged', reason: 'equivalent-rule' });
});
