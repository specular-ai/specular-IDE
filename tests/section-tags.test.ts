import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { LEGACY_ID_CONFIGURATION, validateIdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, mergeProposal, validateProposal } from '../src/core/id-discovery';
import { groupDefinitions } from '../src/renderer/lens-groups';
import { modelsFor } from '../src/renderer/plugin-models';
import type { WorkspaceViewSnapshot } from '../src/renderer/abstraction-views';
import { parseRequest, type PluginManifest } from '../src/shared/plugin-runtime';
import { API_VERSION } from '../packages/plugin-api/src/index';

/** Increment 96f: tags from the section headings enclosing a category's definitions. */
const PARAGRAPHS_ONLY = { headings: { enabled: false, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: false, types: ['unordered', 'ordered'], mode: 'start' }, paragraphs: { enabled: true, mode: 'start' } };
// The criteria configuration of 96d-96e: Kiro feature criteria by list position, bugfix criteria by paragraph number.
const BUGFIX_CONFIGURATION = validateIdConfiguration({
  version: 1,
  categories: [
    { key: 'requirement', name: 'Requirement', role: 'requirement', idScopes: [{ pattern: 'specs/*' }] },
    { key: 'criterion', name: 'Acceptance criterion', idScopes: [{ pattern: 'specs/*' }], numberedItems: { parent: 'requirement', section: 'Acceptance Criteria', id: 'Criterion {parent}.{item}' }, idDefinitionSites: PARAGRAPHS_ONLY },
  ],
  rules: [
    { key: 'requirement', category: 'requirement', pattern: '\\bRequirement \\d+\\b' },
    { key: 'bugfix-criteria', category: 'criterion', pattern: String.raw`^(?<group>\d+)\.(?<item>\d+)(?=\s)`, id: 'Criterion {group}.{item}', defines: true },
  ],
});
const FEATURE = '# A\n\n### Requirement 1: Sign in\n\n#### Acceptance Criteria\n\n1. THE system SHALL sign in\n2. THE system SHALL refuse\n';
const BUGFIX = '# Bugfix Requirements Document\n\n## Bug Analysis\n\n### Current Behavior (Defect)\n\n1.1 WHEN the stack deploys THEN the functions fail\n\n1.2 WHEN users retry THEN it fails again\n\n### **Expected Behavior (Correct):**\n\n#### Ordering\n\n2.1 The stack SHALL deploy in order\n\n### Unchanged Behavior (Regression Prevention)\n\n3.1 WHEN images exist THEN the system SHALL CONTINUE TO deploy\n';
const FILES = { 'specs/a/requirements.md': FEATURE, 'specs/fix/bugfix.md': BUGFIX };
const TAGS = [{ heading: 'Current Behavior (Defect)', tag: 'bugfix:defect' }, { heading: 'expected behavior (correct)', tag: 'bugfix:expected' }, { heading: 'Unchanged Behavior (Regression Prevention)', tag: 'bugfix:unchanged' }];
const TAGGED = validateIdConfiguration({ ...BUGFIX_CONFIGURATION, categories: BUGFIX_CONFIGURATION.categories.map(c => c.key === 'criterion' ? { ...c, sectionTags: TAGS } : c) });

test('definitions take the tags of enclosing section headings at any level; other definitions have none', () => {
  const index = indexProject(FILES, TAGGED, new Map());
  const criteria = index.definitions.filter(o => o.category?.key === 'criterion');
  // Case, emphasis, and a trailing colon are ignored, and the tag holds under a nested heading (#### Ordering).
  assert.deepEqual(criteria.map(o => [o.file, o.id, o.tags]), [
    ['specs/a/requirements.md', 'Criterion 1.1', undefined], ['specs/a/requirements.md', 'Criterion 1.2', undefined],
    ['specs/fix/bugfix.md', 'Criterion 1.1', ['bugfix:defect']], ['specs/fix/bugfix.md', 'Criterion 1.2', ['bugfix:defect']],
    ['specs/fix/bugfix.md', 'Criterion 2.1', ['bugfix:expected']], ['specs/fix/bugfix.md', 'Criterion 3.1', ['bugfix:unchanged']]]);
  // Requirements have no section tags configured.
  assert.ok(index.definitions.filter(o => o.category?.key === 'requirement').every(o => o.tags === undefined));
});

test('a definition\'s own heading is not its section, and a later sibling heading ends a section', () => {
  const configuration = validateIdConfiguration({ version: 1, categories: [{ key: 'req', name: 'Requirement', sectionTags: [{ heading: 'Functional', tag: 'type:functional' }, { heading: 'REQ-2', tag: 'own' }] }], rules: [{ key: 'req', category: 'req', prefix: 'REQ' }] });
  const index = indexProject({ 'r.md': '# Spec\n\n## Functional\n\n### REQ-1\n\nText.\n\n### REQ-2\n\nText.\n\n## Non-functional\n\n### REQ-3\n\nText.\n' }, configuration, new Map());
  assert.deepEqual(index.definitions.map(o => [o.id, o.tags]), [['REQ-1', ['type:functional']], ['REQ-2', ['type:functional']], ['REQ-3', undefined]]);
});

test('section tags are validated', () => {
  const base = { version: 1, rules: [] };
  const category = (sectionTags: unknown) => ({ ...base, categories: [{ key: 'c', name: 'C', sectionTags }] });
  assert.deepEqual(validateIdConfiguration(category([{ heading: ' Defect ', tag: 'bugfix:defect' }])).categories[0].sectionTags, [{ heading: 'Defect', tag: 'bugfix:defect' }]);
  assert.throws(() => validateIdConfiguration(category([{ heading: 'Defect', tag: 'Bugfix Defect' }])), /lowercase letters/);
  assert.throws(() => validateIdConfiguration(category([{ heading: '', tag: 'x' }])), /heading text of 1-128/);
  assert.throws(() => validateIdConfiguration(category([{ heading: 'A', tag: 'x' }, { heading: '**a:**', tag: 'y' }])), /appear once/);
  assert.throws(() => validateIdConfiguration(category(Array.from({ length: 17 }, (_, i) => ({ heading: `H${i}`, tag: 'x' })))), /at most 16/);
  assert.throws(() => validateIdConfiguration(category([{ heading: 'A', tag: 'x', extra: 1 }])), /extra/);
});

test('Project Lens groups by tag with an untagged group, and the project model exposes tags on IDs', () => {
  const index = indexProject(FILES, TAGGED, new Map());
  const groups = groupDefinitions(index.definitions.filter(o => o.category?.key === 'criterion'), 'tag');
  assert.deepEqual(groups.map(g => [g.label, g.count]), [['bugfix:defect', 2], ['bugfix:expected', 1], ['bugfix:unchanged', 1], ['Untagged', 2]]);
  const snapshot = { ready: true, revision: 'r', index, configuration: TAGGED, folders: [], files: [], documents: FILES, warnings: [] } as unknown as WorkspaceViewSnapshot;
  const ids = modelsFor(snapshot).project.ids;
  assert.deepEqual(ids.filter(id => id.tags).map(id => [id.scope, id.id, id.tags]), [
    ['specs/fix', 'Criterion 1.1', ['bugfix:defect']], ['specs/fix', 'Criterion 1.2', ['bugfix:defect']], ['specs/fix', 'Criterion 2.1', ['bugfix:expected']], ['specs/fix', 'Criterion 3.1', ['bugfix:unchanged']]]);
  assert.ok(!('tags' in ids.find(id => id.id === 'Requirement 1')!));
  // The broker accepts the tagged model unchanged (the Project map failed with "Invalid project ID element"), and rejects malformed tags.
  const manifest = { manifestVersion: 1, id: 'test.tags', version: '1.0.0', api: API_VERSION, entry: 'index.js', capabilities: ['workspace.read'], models: ['project@1', 'physical@1'], views: [{ id: 'list', title: 'List', kind: 'list' }] } as PluginManifest;
  const models = modelsFor({ ...snapshot, revision: 1, files: Object.keys(FILES).map(path => ({ path, markdown: true })), folders: [...new Set(Object.keys(FILES).flatMap(file => file.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))))] } as unknown as WorkspaceViewSnapshot);
  const request = (project: unknown) => JSON.stringify({ apiVersion: API_VERSION, requestId: 'r', viewId: 'list', context: { projectId: 'o', revision: 1 }, models: { ...models, project } });
  assert.deepEqual(parseRequest(request(models.project), manifest).models.project!.ids, ids);
  const tagged = ids.findIndex(id => id.tags);
  for (const bad of [[], ['Upper'], ['a b'], ['x', 'x'], [1], 'bugfix:defect', ['x'.repeat(65)]]) {
    const changed = { ...models.project, ids: ids.map((id, i) => i === tagged ? { ...id, tags: bad } : id) };
    assert.throws(() => parseRequest(request(changed), manifest), /Invalid project ID element/, JSON.stringify(bad));
  }
});

test('discovery proposes the Kiro bugfix tags with the bugfix criteria', () => {
  const files = { ...FILES, 'specs/a/tasks.md': '# Tasks\n\n- [ ] 1. Build\n  - _Requirements: 1.1, 1.2_\n', 'specs/b/requirements.md': FEATURE };
  const proposal = validateProposal(candidateProposal(discoverIds(files)), files);
  const criteria = proposal.suggestions.find(s => s.category.name === 'Acceptance criterion')!;
  assert.deepEqual(criteria.category.sectionTags, [{ heading: 'Current Behavior (Defect)', tag: 'bugfix:defect' }, { heading: 'Expected Behavior (Correct)', tag: 'bugfix:expected' }, { heading: 'Unchanged Behavior (Regression Prevention)', tag: 'bugfix:unchanged' }]);
  assert.match(criteria.uncertainty, /tagged bugfix:defect, bugfix:expected, or bugfix:unchanged/);
  const staged = mergeProposal(LEGACY_ID_CONFIGURATION, { version: 1, suggestions: proposal.suggestions.filter(s => s.category.name === 'Requirement' || s === criteria) });
  const tags = indexProject(files, staged, new Map()).definitions.flatMap(o => o.tags ?? []);
  assert.deepEqual([...new Set(tags)].map(tag => [tag, tags.filter(t => t === tag).length]), [['bugfix:defect', 2], ['bugfix:expected', 1], ['bugfix:unchanged', 1]]);
});

/** Increment 96g: section tags matched by pattern, with tags built from named captures. */
const SPEC_KIT_TASKS = (title: string) => `# Tasks: ${title}\n\n## Phase 1: Setup (Shared Infrastructure)\n\n- [ ] T001 Create the project\n- [ ] T002 [P] Configure linting\n\n## Phase 2: Foundational (Blocking Prerequisites)\n\n- [ ] T003 Add the database\n\n## Phase 3: User Story 1 - Sign in (Priority: P1) 🎯 MVP\n\n### Tests for User Story 1\n\n- [ ] T004 [US1] Test sign-in\n\n## Phase 4: User Story 2 - Export (Priority: P2)\n\n- [x] T005 [US2] Export reports\n\n## Phase 5: Polish & Cross-Cutting Concerns\n\n- [ ] T006 Update docs\n\n## Parallel Example\n\n- T001, T002 can run in parallel\n`;
const TASK_FILES = { 'specs/001-a/tasks.md': SPEC_KIT_TASKS('A'), 'specs/002-b/tasks.md': SPEC_KIT_TASKS('B') };
const CHECKBOXES = { ...PARAGRAPHS_ONLY, headings: { ...PARAGRAPHS_ONLY.headings, enabled: true }, lists: { enabled: true, types: ['unordered', 'ordered'], mode: 'start', checkboxOnly: true }, paragraphs: { enabled: false, mode: 'start' } };
const PATTERNS = validateIdConfiguration({ version: 1,
  categories: [{ key: 'task', name: 'Task', role: 'task', idScopes: [{ pattern: 'specs/*' }], idDefinitionSites: CHECKBOXES, sectionTags: [
    { pattern: String.raw`^Phase \d+: (?<phase>Setup|Foundational|Polish)\b`, tag: 'phase:{phase}' },
    { pattern: String.raw`\(Priority: (?<priority>P\d)\)`, tag: 'priority:{priority}' },
    { pattern: String.raw`^Tests for (?<story>User Story \d+)`, tag: 'tests:{story}' }] }],
  rules: [{ key: 'task', category: 'task', prefix: 'T', separator: '' }] });

test('pattern entries match headings ignoring case and build tags from captures; tags of enclosing headings accumulate', () => {
  const index = indexProject(TASK_FILES, PATTERNS, new Map());
  const a = index.definitions.filter(o => o.file === 'specs/001-a/tasks.md');
  // Captures are lowercased and spaces become hyphens; the parallel example's list item is not a checkbox, so it only refers.
  assert.deepEqual(a.map(o => [o.id, o.tags]), [['T001', ['phase:setup']], ['T002', ['phase:setup']], ['T003', ['phase:foundational']],
    ['T004', ['priority:p1', 'tests:user-story-1']], ['T005', ['priority:p2']], ['T006', ['phase:polish']]]);
  assert.equal(index.findings.filter(f => f.kind === 'duplicate').length, 0);
});

test('pattern entries are validated, and a heading whose captures give an invalid tag is reported', () => {
  const base = { version: 1, rules: [] };
  const category = (sectionTags: unknown) => ({ ...base, categories: [{ key: 'c', name: 'C', sectionTags }] });
  assert.throws(() => validateIdConfiguration(category([{ heading: 'A', pattern: 'a', tag: 'x' }])), /either a heading text or a pattern/);
  assert.throws(() => validateIdConfiguration(category([{ tag: 'x' }])), /either a heading text or a pattern/);
  assert.throws(() => validateIdConfiguration(category([{ pattern: '(', tag: 'x' }])), /not a valid Unicode regular expression/);
  assert.throws(() => validateIdConfiguration(category([{ pattern: 'P(?<p>\d)', tag: 'priority:{q}' }])), /uses \{q\}, which section tag pattern 1 does not capture/);
  assert.throws(() => validateIdConfiguration(category([{ pattern: 'P(?<p>\d)', tag: 'Priority {p}' }])), /lowercase letters, digits, colons, underscores, hyphens, and \{captures\}/);
  assert.throws(() => validateIdConfiguration(category([{ pattern: 'a', tag: 'x' }, { pattern: 'a', tag: 'y' }])), /appear once/);
  const long = validateIdConfiguration({ version: 1, categories: [{ key: 'req', name: 'R', sectionTags: [{ pattern: '^Area: (?<area>.+)', tag: 'area:{area}' }] }], rules: [{ key: 'req', category: 'req', prefix: 'REQ' }] });
  const index = indexProject({ 'r.md': `## Area: ${'x'.repeat(80)}\n\n### REQ-1\n\n## Area: Billing\n\n### REQ-2\n` }, long, new Map());
  assert.deepEqual(index.definitions.map(o => [o.id, o.tags]), [['REQ-1', undefined], ['REQ-2', ['area:billing']]]);
  assert.deepEqual(index.findings.filter(f => f.kind === 'consistency').map(f => [f.line, f.message.slice(0, 22)]), [[1, 'Heading "Area: xxxxxxx']]);
});

test('discovery proposes Spec Kit phase and priority tags for tasks, defined by their checkbox items', () => {
  const files = { ...TASK_FILES, 'specs/003-c/tasks.md': SPEC_KIT_TASKS('C') };
  const proposal = validateProposal(candidateProposal(discoverIds(files)), files);
  const tasks = proposal.suggestions.find(s => s.category.sectionTags)!;
  assert.equal(tasks.rule!.pattern, String.raw`\bT\d+\b`);
  assert.deepEqual(tasks.category.sectionTags!.map(t => t.tag), ['phase:{phase}', 'priority:{priority}']);
  assert.deepEqual(tasks.category.idDefinitionSites!.lists, { enabled: true, types: ['unordered', 'ordered'], mode: 'start', checkboxOnly: true });
  assert.match(tasks.uncertainty, /In 3 task lists, 9 Setup, Foundational, or Polish phase headings \(phase:setup, …\) and 6 user-story headings with a priority \(priority:p1, …\) divide these tasks/);
  const index = indexProject(files, mergeProposal(LEGACY_ID_CONFIGURATION, { version: 1, suggestions: [tasks] }), new Map());
  const tags = index.definitions.flatMap(o => o.tags ?? []);
  assert.deepEqual(Object.fromEntries([...new Set(tags)].map(tag => [tag, tags.filter(t => t === tag).length])), { 'phase:setup': 6, 'phase:foundational': 3, 'priority:p1': 3, 'priority:p2': 3, 'phase:polish': 3 });
  // Without phase or priority headings, nothing is tagged.
  const plain = { 'specs/001-a/tasks.md': '# Tasks\n\n- [ ] T001 One\n- [ ] T002 Two\n', 'specs/002-b/tasks.md': '# Tasks\n\n- [ ] T001 One\n- [ ] T002 Two\n' };
  assert.ok(candidateProposal(discoverIds(plain)).suggestions.every(s => !s.category.sectionTags));
});
