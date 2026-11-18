import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { LEGACY_ID_CONFIGURATION, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, mergeProposal, validateProposal } from '../src/core/id-discovery';

/** Increment 96d: elements numbered by their position in ordered lists, such as Kiro acceptance criteria. */
const requirements = (title: string) => `# ${title}\n\n### Requirement 1: Sign in\n\n**User Story:** As a user, I want to sign in.\n\n#### Acceptance Criteria\n\n1. WHEN a user enters valid credentials THE system SHALL sign them in\n2. WHEN the password is wrong THE system SHALL refuse\n3. THE system SHALL lock after five attempts\n\n### Requirement 2: Export\n\n#### Acceptance Criteria\n\n3. THE system SHALL export reports\n4. THE system SHALL email them\n6. THE system SHALL keep a copy\n\n## Notes\n\n1. Not a criterion.\n`;
const FILES: Record<string, string> = {
  'specs/a/requirements.md': requirements('A'),
  'specs/a/tasks.md': '# Tasks\n\n- [ ] 1. Build sign-in\n  - _Requirements: 1.1, 2.3_\n- [ ] 2. Export\n  - _Requirements: 2_\n  - _Requirements: 2.4_\n',
  'specs/a/design.md': '# Design\n\n### Property 1: Wrong passwords are refused\n\n**Validates: Requirements 1.2**\n',
  'specs/b/requirements.md': requirements('B'),
};
export const CRITERIA_CONFIGURATION: IdConfiguration = validateIdConfiguration({
  version: 1,
  categories: [
    { key: 'requirement', name: 'Requirement', role: 'requirement', idScopes: [{ pattern: 'specs/*' }] },
    { key: 'criterion', name: 'Acceptance criterion', idScopes: [{ pattern: 'specs/*' }], numberedItems: { parent: 'requirement', section: 'Acceptance Criteria', id: 'Criterion {parent}.{item}' } },
  ],
  rules: [
    { key: 'requirement', category: 'requirement', pattern: '\\bRequirement \\d+\\b' },
    { key: 'criterion-citations', category: 'criterion', list: { label: '\\bRequirements?:|\\bValidates:?\\s+Requirements?:?', item: '(?<number>\\d+)\\.(?<criterion>\\d+)', id: 'Criterion {number}.{criterion}' } },
    { key: 'requirement-citations', category: 'requirement', list: { label: '\\bRequirements?:|\\bValidates:?\\s+Requirements?:?', item: '(?<number>\\d+)(?![.\\d])', id: 'Requirement {number}' } },
  ],
});

test('ordered list items in a section of a parent element define elements numbered by position, owned by the parent', () => {
  const index = indexProject(FILES, CRITERIA_CONFIGURATION, new Map());
  const criteria = index.definitions.filter(o => o.category?.key === 'criterion' && o.file === 'specs/a/requirements.md');
  assert.deepEqual(criteria.map(o => [o.id, o.owner?.id, o.label]), [
    ['Criterion 1.1', 'Requirement 1', 'WHEN a user enters valid credentials THE system SHALL sign them in'],
    ['Criterion 1.2', 'Requirement 1', 'WHEN the password is wrong THE system SHALL refuse'],
    ['Criterion 1.3', 'Requirement 1', 'THE system SHALL lock after five attempts'],
    // Numbered by position: the list starts at 3 and skips 5.
    ['Criterion 2.1', 'Requirement 2', 'THE system SHALL export reports'],
    ['Criterion 2.2', 'Requirement 2', 'THE system SHALL email them'],
    ['Criterion 2.3', 'Requirement 2', 'THE system SHALL keep a copy'],
  ]);
  // The range is the item's first line, so the source opens at the criterion.
  const first = criteria[0], text = FILES[first.file];
  assert.equal(text.slice(first.offset, first.end), 'WHEN a user enters valid credentials THE system SHALL sign them in');
  // Specification b numbers the same criteria in its own scope; nothing is duplicated.
  assert.equal(index.definitions.filter(o => o.category?.key === 'criterion').length, 12);
  assert.equal(index.findings.filter(f => f.kind === 'duplicate').length, 0);
  // Citations resolve to criteria; a whole-requirement citation refers to the requirement; 2.4 does not exist.
  const references = index.references.filter(o => o.file !== 'specs/a/requirements.md' && o.file !== 'specs/b/requirements.md').map(o => [o.file, o.id, o.category?.key]);
  assert.deepEqual(references, [
    ['specs/a/tasks.md', 'Criterion 1.1', 'criterion'], ['specs/a/tasks.md', 'Criterion 2.3', 'criterion'],
    ['specs/a/tasks.md', 'Requirement 2', 'requirement'], ['specs/a/tasks.md', 'Criterion 2.4', 'criterion'],
    ['specs/a/design.md', 'Criterion 1.2', 'criterion']]);
  assert.deepEqual(index.findings.filter(f => f.kind === 'unresolved').map(f => f.message), ['No definition found for Criterion 2.4 · specs/a.']);
});

test('lists outside the section or outside an element of the parent define nothing; the configuration is validated', () => {
  const index = indexProject({ 'x.md': '# X\n\n1. Loose list\n\n### Requirement 9\n\n1. Before any section\n\n#### Other\n\n1. Other section\n' }, CRITERIA_CONFIGURATION, new Map());
  assert.equal(index.definitions.filter(o => o.category?.key === 'criterion').length, 0);
  // Without a section, every ordered list inside the parent element counts.
  const anywhere = validateIdConfiguration({ ...CRITERIA_CONFIGURATION, categories: CRITERIA_CONFIGURATION.categories.map(c => c.numberedItems ? { ...c, numberedItems: { parent: 'requirement', id: '{parent}.{item}' } } : c) });
  assert.deepEqual(indexProject({ 'x.md': '### Requirement 9\n\n1. First\n\n#### Other\n\n1. Second\n' }, anywhere, new Map()).definitions.filter(o => o.category?.key === 'criterion').map(o => o.id), ['9.1', '9.1']);
  const base = { version: 1, rules: [] };
  assert.throws(() => validateIdConfiguration({ ...base, categories: [{ key: 'c', name: 'C', numberedItems: { parent: 'missing' } }] }), /numbered list items need another category/);
  assert.throws(() => validateIdConfiguration({ ...base, categories: [{ key: 'r', name: 'R' }, { key: 'c', name: 'C', numberedItems: { parent: 'r', id: '{parent}' } }] }), /needs \{item\}/);
  assert.throws(() => validateIdConfiguration({ ...base, categories: [{ key: 'r', name: 'R' }, { key: 'c', name: 'C', numberedItems: { parent: 'r', id: '{x}.{item}' } }] }), /may use \{parent\}/);
  assert.deepEqual(validateIdConfiguration({ ...base, categories: [{ key: 'r', name: 'R' }, { key: 'c', name: 'C', numberedItems: { parent: 'r' } }] }).categories[1].numberedItems, { parent: 'r', id: '{parent}.{item}' });
});

test('discovery proposes Kiro acceptance criteria with their citations, and staging links them to their requirement', () => {
  const proposal = validateProposal(candidateProposal(discoverIds(FILES)), FILES);
  const requirement = proposal.suggestions.find(s => s.category.name === 'Requirement')!, criteria = proposal.suggestions.find(s => s.category.numberedItems)!;
  assert.deepEqual([criteria.category.name, criteria.category.numberedItems, criteria.category.idScopes], ['Acceptance criterion', { parent: requirement.category.key, section: 'Acceptance Criteria', id: 'Criterion {parent}.{item}' }, requirement.category.idScopes]);
  assert.ok(requirement.rule!.pattern!.endsWith(String.raw`(?!\.\d)`), requirement.rule!.pattern);
  assert.deepEqual(criteria.references!.map(r => [r.category, r.list!.id]), [[criteria.category.key, 'Criterion {number}.{criterion}'], [requirement.category.key, 'Requirement {number}']]);
  assert.match(criteria.uncertainty, /12 items of ordered lists under "Acceptance Criteria" headings inside Requirement headings, in 2 files/);
  const draft = mergeProposal(LEGACY_ID_CONFIGURATION, { version: 1, suggestions: [requirement, criteria] }), index = indexProject(FILES, draft, new Map());
  const key = draft.categories.find(c => c.numberedItems)!.key;
  assert.equal(index.definitions.filter(o => o.category?.key === key).length, 12);
  assert.deepEqual(index.findings.filter(f => f.kind === 'unresolved').map(f => f.message), ['No definition found for Criterion 2.4 · specs/a.']);
  // A parent that is not proposed keeps its key, for a requirement category the draft already has.
  const alone = mergeProposal({ ...LEGACY_ID_CONFIGURATION, categories: [...LEGACY_ID_CONFIGURATION.categories, { key: requirement.category.key, name: 'Requirement' }] }, { version: 1, suggestions: [criteria] });
  assert.equal(alone.categories.find(c => c.numberedItems)!.numberedItems!.parent, requirement.category.key);
  // Citation rules may only cite the suggestion's category or its parent.
  assert.throws(() => validateProposal({ version: 1, suggestions: [{ ...criteria, references: [{ ...criteria.references![0], category: 'other' }] }] }, FILES), /Citation rules/);
});

/** Increment 96e: Kiro bugfix criteria, defined by a templated rule at paragraph starts. */
const BUGFIX: Record<string, string> = {
  'specs/fix/bugfix.md': '# Bugfix Requirements Document\n\n## Introduction\n\nIntro.\n\n## Bug Analysis\n\n### Current Behavior (Defect)\n\n1.1 WHEN the stack deploys THEN the functions fail\n\n1.2 WHEN users retry THEN it fails again\n\n### Expected Behavior (Correct)\n\n2.1 The stack SHALL deploy in order\n\n### Unchanged Behavior (Regression Prevention)\n\n3.1 WHEN images exist THEN the system SHALL CONTINUE TO deploy\n',
  'specs/fix/tasks.md': '# Tasks\n\n- [x] 1.1 Fix the order\n  - _Requirements: 2.1, 3.1_\n- [ ] 1.2 Check retries\n  - _Requirements: 1.2_\n',
  'specs/fix/design.md': '# Design\n\n## 2.1 Overview\n\n**Validates: Requirements 1.1, 2.1**\n',
};
const PARAGRAPHS_ONLY = { headings: { enabled: false, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: false, types: ['unordered', 'ordered'], mode: 'start' }, paragraphs: { enabled: true, mode: 'start' } };
export const BUGFIX_CONFIGURATION = validateIdConfiguration({ ...CRITERIA_CONFIGURATION,
  categories: CRITERIA_CONFIGURATION.categories.map(c => c.key === 'criterion' ? { ...c, idDefinitionSites: PARAGRAPHS_ONLY } : c),
  rules: [...CRITERIA_CONFIGURATION.rules, { key: 'bugfix-criteria', category: 'criterion', pattern: String.raw`^(?<group>\d+)\.(?<item>\d+)(?=\s)`, id: 'Criterion {group}.{item}', defines: true }] });

test('a defining templated rule defines bugfix criteria at paragraph starts and nowhere else; citations resolve', () => {
  const index = indexProject({ ...FILES, ...BUGFIX }, BUGFIX_CONFIGURATION, new Map());
  const bugfix = index.definitions.filter(o => o.file === 'specs/fix/bugfix.md');
  assert.deepEqual(bugfix.map(o => [o.id, o.label, BUGFIX[o.file].slice(o.offset, o.end)]), [
    ['Criterion 1.1', '1.1 WHEN the stack deploys THEN the functions fail', '1.1'], ['Criterion 1.2', '1.2 WHEN users retry THEN it fails again', '1.2'],
    ['Criterion 2.1', '2.1 The stack SHALL deploy in order', '2.1'], ['Criterion 3.1', '3.1 WHEN images exist THEN the system SHALL CONTINUE TO deploy', '3.1']]);
  // Task numbers (list items) and a numbered heading define nothing and refer to nothing.
  assert.equal(index.definitions.filter(o => o.file !== 'specs/fix/bugfix.md' && o.file.startsWith('specs/fix/')).length, 0);
  const citations = index.references.filter(o => o.file.startsWith('specs/fix/')).map(o => o.id);
  assert.deepEqual(citations, ['Criterion 2.1', 'Criterion 3.1', 'Criterion 1.2', 'Criterion 1.1', 'Criterion 2.1']);
  assert.equal(index.findings.filter(f => f.kind === 'unresolved' && f.file.startsWith('specs/fix/')).length, 0);
  // A templated rule without defines still only refers (increment 89).
  assert.throws(() => validateIdConfiguration({ version: 1, categories: [{ key: 'c', name: 'C' }], rules: [{ key: 'r', category: 'c', pattern: String.raw`x(?<n>\d)`, defines: true }] }), /defines applies only/);
});

test('bugfix criteria written on consecutive lines of one paragraph are each defined', () => {
  const files = { 'specs/fix/bugfix.md': '# Bugfix Requirements Document\n\n### Expected Behavior (Correct)\n\n#### File naming\n\n2.1 The files SHALL be named in kebab case\n2.2 The files SHALL use one locale\nas a continued sentence\n2.3 All entries SHALL keep their slug\n' };
  const index = indexProject(files, BUGFIX_CONFIGURATION, new Map());
  assert.deepEqual(index.definitions.map(o => [o.id, o.label, files[o.file as keyof typeof files].slice(o.offset, o.end)]), [
    ['Criterion 2.1', '2.1 The files SHALL be named in kebab case', '2.1'], ['Criterion 2.2', '2.2 The files SHALL use one locale', '2.2'], ['Criterion 2.3', '2.3 All entries SHALL keep their slug', '2.3']]);
});

test('discovery adds the bugfix rule to the acceptance criteria, or proposes them alone for bugfix-only projects', () => {
  const both = validateProposal(candidateProposal(discoverIds({ ...FILES, ...BUGFIX })), { ...FILES, ...BUGFIX });
  const criteria = both.suggestions.find(s => s.category.name === 'Acceptance criterion')!;
  assert.deepEqual([criteria.rule!.id, criteria.rule!.defines, criteria.category.idDefinitionSites!.paragraphs, criteria.category.idDefinitionSites!.lists!.enabled, criteria.category.idDefinitionSites!.headings.enabled], ['Criterion {group}.{item}', true, { enabled: true, mode: 'start' }, false, false]);
  assert.match(criteria.uncertainty, /4 criteria of Kiro bugfix specifications in 1 files \(2 current, 1 expected, 1 unchanged behaviour\)/);
  const staged = mergeProposal(LEGACY_ID_CONFIGURATION, { version: 1, suggestions: [both.suggestions.find(s => s.category.name === 'Requirement')!, criteria] });
  const index = indexProject({ ...FILES, ...BUGFIX }, staged, new Map());
  assert.equal(index.definitions.filter(o => o.file === 'specs/fix/bugfix.md').length, 4);
  assert.equal(index.findings.filter(f => f.kind === 'unresolved' && f.file.startsWith('specs/fix/')).length, 0);
  // A project with bugfix specifications only gets the criteria with their scope and citation rule, without numbered items.
  const only = { ...BUGFIX, 'specs/fix2/bugfix.md': BUGFIX['specs/fix/bugfix.md'], 'specs/fix2/tasks.md': BUGFIX['specs/fix/tasks.md'] };
  const alone = validateProposal(candidateProposal(discoverIds(only)), only).suggestions.find(s => s.category.name === 'Acceptance criterion')!;
  assert.deepEqual([alone.category.numberedItems, alone.category.idScopes, alone.references!.map(r => r.list!.id)], [undefined, [{ pattern: 'specs/*' }], ['Criterion {number}.{criterion}']]);
  const aloneIndex = indexProject(only, mergeProposal(LEGACY_ID_CONFIGURATION, { version: 1, suggestions: [alone] }), new Map());
  assert.deepEqual([aloneIndex.definitions.length, aloneIndex.findings.filter(f => f.kind === 'unresolved').length, aloneIndex.findings.filter(f => f.kind === 'duplicate').length], [8, 0, 0]);
});
