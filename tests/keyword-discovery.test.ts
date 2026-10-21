import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, validateIdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, mergeProposal, validateProposal, type ConventionProposal } from '../src/core/id-discovery';
import { classifyDiscoveryCategory } from '../src/core/discovery-category-classification';

// Increment 85c: Discover by patterns proposes keyword-heading conventions, parents, capability scopes, and changes.
const openspec: Record<string, string> = {
  'openspec/specs/identity/spec.md': '# identity Specification\n\n### Requirement: Users and workspaces\n\n#### Scenario: Create user\n\nSee the `users and workspaces` requirement.\n\n### Requirement: Token verification\n\n#### Scenario: Valid token\n',
  'openspec/specs/billing/spec.md': '# billing Specification\n\n### Requirement: Invoices\n\n#### Scenario: Monthly invoice\n',
  'openspec/changes/add-realms/proposal.md': '# Change: Add realms\n\n### Modified Capabilities\n\n- `identity`: realm-scoped users.\n',
  'openspec/changes/add-realms/specs/identity/spec.md': '## MODIFIED Requirements\n\n### Requirement: Users and workspaces\n\n#### Scenario: Create user in realm\n\n## ADDED Requirements\n\n### Requirement: Realm isolation\n',
  'openspec/changes/archive/2026-01-01-tokens/proposal.md': '# Change: Tokens\n',
  'docs/plans/a.md': '# Plan A\n\n## Task 1: first\n\n## Task 2: second\n',
  'docs/plans/b.md': '# Plan B\n\n## Task 1: other\n\n## Format: [ID] Description\n',
  'docs/plans/c.md': '# Plan C\n\n## Format: [ID] Description\n\n## Format: [ID] Description\n',
};
const proposal = () => validateProposal(JSON.parse(JSON.stringify(candidateProposal(discoverIds(openspec)))), openspec);
const byName = (p: ConventionProposal, name: string) => p.suggestions.find(item => item.category.name === name)!;

test('keyword headings, nesting, capability scopes, changes, deltas, and name references are proposed', () => {
  const p = proposal();
  const requirement = byName(p, 'Requirement'), scenario = byName(p, 'Scenario'), capability = byName(p, 'Capability'), change = byName(p, 'Change'), task = byName(p, 'Task');
  assert.equal(requirement.rule, undefined);
  assert.deepEqual(requirement.category.idDefinitionSites?.headings, { enabled: true, levels: [3], mode: 'keyword', keyword: 'Requirement' });
  assert.deepEqual(requirement.category.idScopes, [{ pattern: 'openspec/specs/{capability}/spec.md' }, { pattern: 'openspec/changes/**/specs/{capability}/spec.md' }]);
  assert.ok(requirement.category.deltas && requirement.category.nameReferences);
  assert.equal(scenario.category.parent, requirement.category.key);
  assert.deepEqual(capability.category.derive, { pattern: 'openspec/specs/{capability}/spec.md' });
  assert.deepEqual(change.category.derive, { pattern: 'openspec/changes/**/{change}/proposal.md' });
  assert.equal(change.category.changes?.capabilities, capability.category.key);
  // Numbered headings restart per plan file, so they get a per-file scope; evidence is the token.
  assert.equal(task.rule?.pattern, String.raw`\bTask \d+\b`);
  assert.deepEqual(task.category.idScopes, [{ pattern: 'docs/plans/*.md' }]);
  assert.equal(task.evidence[0].id, 'Task 1');
  // Document titles ("# Change: Add realms") and repeated template headings ("Format: [ID] ...") are not proposed.
  assert.ok(!p.suggestions.some(item => /^(Change|Format)$/.test(item.category.name) && item.category.idDefinitionSites?.headings.mode === 'keyword'));
  for (const item of p.suggestions) for (const e of item.evidence) assert.equal(openspec[e.file].slice(e.offset, e.end), e.id);
});

test('accepting the suggestions recognizes the project like a hand-written configuration', () => {
  const p = proposal();
  const config = mergeProposal({ version: 1, categories: [], rules: [] }, p);
  const index = buildIndex(Object.entries(openspec).map(([file, text]) => analyzeDocument(file, text, compileIdMatcher(config))));
  const names = (category: string) => index.definitions.filter(item => item.category?.name === category).map(item => item.id);
  assert.deepEqual(names('Requirement'), ['Users and workspaces', 'Token verification', 'Invoices', 'Realm isolation']);
  assert.deepEqual(names('Scenario'), ['Users and workspaces / Create user', 'Token verification / Valid token', 'Invoices / Monthly invoice']);
  assert.deepEqual(names('Change'), ['add-realms', '2026-01-01-tokens']);
  assert.ok(index.references.some(item => item.delta === 'modified' && item.id === 'Users and workspaces'));
  assert.equal(index.findings.filter(item => item.kind === 'duplicate' || item.kind === 'unresolved').length, 0);
});

test('merging follows renamed keys and drops references to suggestions that were not added', () => {
  const p = proposal();
  const requirement = byName(p, 'Requirement'), scenario = byName(p, 'Scenario');
  // A draft that already uses the scenario's key and the requirement's key forces renames.
  const base = validateIdConfiguration({ version: 1, categories: [{ key: requirement.category.key, name: 'Old' }, { key: scenario.category.key, name: 'Older' }], rules: [] });
  const merged = mergeProposal(base, { version: 1, suggestions: [requirement, scenario] });
  const added = merged.categories.find(item => item.name === 'Scenario')!;
  assert.equal(merged.categories.find(item => item.key === added.parent)?.name, 'Requirement');
  const alone = mergeProposal({ version: 1, categories: [], rules: [] }, { version: 1, suggestions: [scenario] });
  assert.equal(alone.categories[0].parent, undefined);
  const change = mergeProposal({ version: 1, categories: [], rules: [] }, { version: 1, suggestions: [byName(p, 'Change')] });
  assert.deepEqual(change.categories[0].changes, {});
});

test('proposals without rules need a keyword site or derived elements, and their references must name suggestions', () => {
  const p = proposal();
  const broken = structuredClone(p); byName(broken, 'Scenario').category.parent = 'nowhere';
  assert.throws(() => validateProposal(broken, openspec), /must name other suggestions/);
  const bare = structuredClone(p); delete byName(bare, 'Requirement').category.idDefinitionSites;
  assert.throws(() => validateProposal(bare, openspec), /keyword heading site or derived elements/);
});

test('an existing category with the same keyword or derive pattern is recognized as the existing convention', () => {
  const p = proposal();
  const draft = mergeProposal({ version: 1, categories: [], rules: [] }, { version: 1, suggestions: [byName(p, 'Requirement'), byName(p, 'Capability')] });
  for (const name of ['Requirement', 'Capability']) {
    const decision = classifyDiscoveryCategory(draft, byName(p, name), { owners: byName(p, name).evidence.map(() => []) }, p.suggestions);
    assert.equal(decision.kind, 'existing', name);
  }
  assert.equal(classifyDiscoveryCategory(draft, byName(p, 'Change'), { owners: byName(p, 'Change').evidence.map(() => []) }, p.suggestions).kind, 'new');
});

// Increment 85d: archived changes repeat the requirement and scenario names they modify, beyond the 50% variety threshold.
test('keyword headings whose names repeat only in change deltas are still proposed', () => {
  const modified = '## MODIFIED Requirements\n\n### Requirement: Package layout\n\n#### Scenario: Import\n\n#### Scenario: Stub\n';
  const history: Record<string, string> = {
    'openspec/specs/core/spec.md': '# core Specification\n\n### Requirement: Package layout\n\n#### Scenario: Import\n\n#### Scenario: Stub\n\n### Requirement: Constants\n\n#### Scenario: Defaults\n',
    'docs/a.md': '# A\n\n## Format: [ID] Description\n\n## Format: [ID] Description\n',
    'docs/b.md': '# B\n\n## Format: [ID] Description\n',
  };
  for (let i = 1; i <= 6; i++) {
    history[`openspec/changes/archive/2026-01-0${i}-step/proposal.md`] = '# Change: Step\n';
    history[`openspec/changes/archive/2026-01-0${i}-step/specs/core/spec.md`] = modified;
  }
  const inventory = discoverIds(history);
  // All names: 2 distinct requirements in 8 headings and 3 distinct scenarios in 15, both under the old threshold.
  assert.deepEqual(inventory.keywords!.map(item => [item.keyword, item.count, item.inDeltas]).sort(), [['Requirement', 8, 6], ['Scenario', 15, 12]]);
  const p = validateProposal(JSON.parse(JSON.stringify(candidateProposal(inventory))), history);
  const requirement = byName(p, 'Requirement'), scenario = byName(p, 'Scenario');
  assert.deepEqual(requirement.category.idDefinitionSites?.headings, { enabled: true, levels: [3], mode: 'keyword', keyword: 'Requirement' });
  assert.deepEqual(requirement.category.idScopes, [{ pattern: 'openspec/specs/{capability}/spec.md' }, { pattern: 'openspec/changes/**/specs/{capability}/spec.md' }]);
  assert.ok(requirement.category.deltas);
  assert.equal(scenario.category.parent, requirement.category.key);
  // A template heading outside delta sections is still excluded.
  assert.ok(!p.suggestions.some(item => item.category.name === 'Format'));
});

test('token discovery is unchanged beside keyword discovery', () => {
  const inventory = discoverIds({ 'a.md': '# REQ-1 Login\n\nSee REQ-2 and REQ-1.\n' });
  assert.deepEqual(inventory.candidates.map(item => [item.prefix, item.distinctIds]), [['REQ', 2]]);
  assert.deepEqual(inventory.keywords, []);
  assert.deepEqual(candidateProposal(inventory).suggestions.map(item => item.rule?.pattern), [String.raw`\bREQ-\d+\b`]);
});
