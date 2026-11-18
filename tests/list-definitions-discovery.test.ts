import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { matchesIds, ruleRegex, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, existingCategoryTags, mergeProposal, validateProposal, type ConventionProposal } from '../src/core/id-discovery';
import { classifyDiscoveryCategory } from '../src/core/discovery-category-classification';

/** Increment 103: IDs defined as list items, as in Spec Kit's spec template, are defined there once a suggestion is staged. */
const SPEC = (title: string, frs: number, scs: number) => `# Feature Specification: ${title}\n\n## Requirements *(mandatory)*\n\n### Functional Requirements\n\n`
  + Array.from({ length: frs }, (_, i) => `- **FR-00${i + 1}**: System MUST do thing ${i + 1}\n`).join('')
  + `\n## Success Criteria *(mandatory)*\n\n### Measurable Outcomes\n\n` + Array.from({ length: scs }, (_, i) => `- **SC-00${i + 1}**: Outcome ${i + 1} holds\n`).join('')
  + `\nFR-001 is the core requirement; SC-001 measures it.\n`;
const TASKS = `# Tasks\n\n## Phase 1: Setup (Shared Infrastructure)\n\n- [ ] T001 Create the project (FR-001)\n- [ ] T002 [P] Configure linting\n\n## Phase 2: Foundational (Blocking Prerequisites)\n\n- [x] T003 Add the database\n\n## Phase 3: User Story 1 - Sign in (Priority: P1)\n\n- [ ] T004 [US1] Sign in\n\n## Phase 4: Polish & Cross-Cutting Concerns\n\n- [ ] T005 Update docs\n`;
const FILES: Record<string, string> = { 'specs/001-login/spec.md': SPEC('Login', 3, 2), 'specs/002-export/spec.md': SPEC('Export', 3, 2), 'specs/001-login/tasks.md': TASKS, 'specs/002-export/tasks.md': TASKS };
const proposal = (documents: Record<string, string>) => validateProposal(JSON.parse(JSON.stringify(candidateProposal(discoverIds(documents)))), documents);
const named = (p: ConventionProposal, name: string) => p.suggestions.find(item => item.category.name === name)!;
const LISTS = { enabled: true, types: ['unordered', 'ordered'], mode: 'start' };

test('FR and SC suggestions turn on list definitions and define every list item, one scope per specification', () => {
  const p = proposal(FILES), fr = named(p, 'FR'), sc = named(p, 'SC');
  for (const suggestion of [fr, sc]) {
    assert.deepEqual(suggestion.category.idDefinitionSites?.lists, LISTS);
    assert.deepEqual(suggestion.category.idDefinitionSites?.headings, { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' });
    assert.deepEqual(suggestion.category.idScopes, [{ pattern: 'specs/*' }]);
  }
  assert.match(fr.uncertainty, /6 of them start list items in 2 files, so list items that start with these IDs define them\./);
  const index = indexProject(FILES, mergeProposal({ version: 1, categories: [], rules: [] }, { ...p, suggestions: [fr, sc] }), new Map());
  const defined = (prefix: string) => index.definitions.filter(o => o.id.startsWith(prefix)).map(o => `${o.file.split('/')[1]} ${o.id}`);
  assert.deepEqual(defined('FR'), ['001-login FR-001', '001-login FR-002', '001-login FR-003', '002-export FR-001', '002-export FR-002', '002-export FR-003']);
  assert.equal(defined('SC').length, 4);
  assert.equal(index.findings.filter(f => /duplicate/i.test(f.message)).length, 0);
  assert.equal(index.references.filter(r => r.id.startsWith('FR') || r.id.startsWith('SC')).every(r => index.definitions.some(d => d.id === r.id)), true);
});

test('checkbox task suggestions keep the profile\'s checkbox-only sites', () => {
  const t = named(proposal(FILES), 'T');
  assert.deepEqual(t.category.idDefinitionSites?.lists, { ...LISTS, checkboxOnly: true });
  assert.doesNotMatch(t.uncertainty, /start list items|stay off/);
  assert.equal(t.listReason, undefined);
});

test('IDs that list items would define again in their scope keep list definitions off, and say so', () => {
  // As in pyArchimate and mssql-extension: plans list the user stories again.
  const plan = '# Plan\n\n- **US-1**: Sign in, first\n- **US-2**: Export, second\n';
  const documents = { ...FILES, 'specs/001-login/spec.md': FILES['specs/001-login/spec.md'] + '\n' + plan, 'specs/001-login/plan.md': plan,
    'specs/002-export/spec.md': FILES['specs/002-export/spec.md'] + '\n' + plan, 'specs/002-export/plan.md': plan };
  const p = proposal(documents), us = named(p, 'US');
  assert.equal(us.category.idDefinitionSites, undefined);
  assert.match(us.uncertainty, /8 of them start list items, but 4 of 4 IDs would be defined more than once in a specification, so list definitions stay off/);
  assert.deepEqual(named(p, 'FR').category.idDefinitionSites?.lists, LISTS);
});

test('a prefix seen only in prose, headings, or tables gets no list sites', () => {
  const documents = {
    'a.md': '# A\n\n## REQ-1 Login\n\n## REQ-2 Logout\n\n- See REQ-1 and REQ-2\n- REQ-1: recap\n',
    'b.md': '# B\n\n| ID | Text |\n| --- | --- |\n| REQ-3 | Reset |\n\nDEC-1 and DEC-2 are decided.\n',
  };
  const p = proposal(documents);
  assert.equal(named(p, 'REQ').category.idDefinitionSites, undefined);
  assert.equal(named(p, 'DEC').category.idDefinitionSites, undefined);
});

/** The review's classification, with evidence owners from the draft's rules as the analysis worker computes them. */
function classify(draft: IdConfiguration, p: ConventionProposal) {
  const rules = draft.rules.filter(matchesIds).map(rule => ({ rule, regex: ruleRegex(rule) }));
  return p.suggestions.map(suggestion => classifyDiscoveryCategory(draft, suggestion, { owners: suggestion.evidence.map(evidence => rules.filter(item => {
    item.regex.lastIndex = 0; const match = item.regex.exec(evidence.id); return match?.index === 0 && match[0].length === evidence.id.length;
  }).map(item => item.rule.category)) }, p.suggestions));
}
const owners = (decisions: ReturnType<typeof classify>) => decisions.map(decision => decision.kind === 'existing' || decision.reason === 'different-rule-for-existing-evidence' ? decision.category : undefined);

test('an existing category with list definitions off is offered to turn them on, without changing anything silently', () => {
  const documents = { 'specs/001-login/spec.md': SPEC('Login', 3, 0), 'specs/002-export/spec.md': SPEC('Export', 3, 0) };
  const draft = validateIdConfiguration({ version: 1, categories: [{ key: 'fr', name: 'Functional requirement', idScopes: [{ pattern: 'specs/*' }] }], rules: [{ key: 'fr', category: 'fr', pattern: String.raw`\bFR-\d+\b` }] });
  const p = proposal(documents), decisions = classify(draft, p);
  assert.equal(decisions[p.suggestions.findIndex(s => s.category.name === 'FR')].kind, 'existing');
  const [lists, ...others] = existingCategoryTags(draft, p.suggestions, owners(decisions));
  assert.equal(others.length, 0);
  assert.deepEqual([lists.category, lists.lists, lists.sectionTags], ['fr', true, []]);
  assert.match(lists.uncertainty, /^6 of 6 definition-like matches of these IDs start list items in 2 files\. Functional requirement already recognizes these IDs, but its list definitions are off/);
  // Before staging nothing changes; staged, the category's own sites turn lists on and keep the rest.
  assert.equal(indexProject(documents, draft, new Map()).definitions.length, 0);
  const staged = mergeProposal(draft, validateProposal({ version: 1, suggestions: [], tags: [lists] }, documents));
  assert.deepEqual(staged.categories[0].idDefinitionSites?.lists, LISTS);
  assert.deepEqual(staged.categories[0].idDefinitionSites?.tables, { enabled: true, column: 'ID', mode: 'exact' });
  assert.deepEqual(staged.rules, draft.rules);
  assert.equal(indexProject(documents, staged, new Map()).definitions.length, 6);
  // A category whose lists are on gets no suggestion.
  assert.deepEqual(existingCategoryTags(staged, p.suggestions, owners(classify(staged, p))), []);
  assert.throws(() => validateProposal({ version: 1, suggestions: [], tags: [{ ...lists, lists: undefined }] }, documents), /at least one entry/);
});
