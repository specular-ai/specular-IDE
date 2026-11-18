import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { compileIdMatcher, validateIdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, mergeProposal, validateProposal, type ConventionProposal } from '../src/core/id-discovery';

/** Increment 104: Kiro tasks, numbered 1 and 1.1 in the checkbox items of each spec's tasks.md, next to requirements and bugfix criteria. */
const REQUIREMENTS = (n: number) => '# Requirements Document\n\n' + Array.from({ length: n }, (_, i) => `### Requirement ${i + 1}\n\n**User Story:** As a user, I want thing ${i + 1}.\n\n#### Acceptance Criteria\n\n1. WHEN it starts THEN it SHALL work\n2. WHEN it stops THEN it SHALL rest\n\n`).join('')
  + 'See section 1.1 of the design for details.\n';
const FILES: Record<string, string> = {
  '.kiro/specs/alpha/requirements.md': REQUIREMENTS(2),
  '.kiro/specs/alpha/tasks.md': '# Implementation Plan\n\n- [ ] 1. Set up the module\n  - [x] 1.1 Create the module\n    - _Requirements: 1.1, 2.1_\n  - [-] 1.2 Wire it in\n    - _Requirements: 1.2_\n- [ ] 2. Test it after Task 1 and Task 1.2\n',
  '.kiro/specs/beta/requirements.md': REQUIREMENTS(1),
  '.kiro/specs/beta/tasks.md': '# Implementation Plan\n\n- [x] 1. Fix the deploy\n  - [x] 1.1 Patch the stack\n- [ ] 2. Verify it\n',
  '.kiro/specs/gamma/bugfix.md': '# Bugfix Requirements Document\n\n### Current Behavior (Defect)\n\n1.1 WHEN it deploys THEN it fails\n\n### Expected Behavior (Correct)\n\n2.1 The stack SHALL deploy\n\n### Unchanged Behavior (Regression Prevention)\n\n3.1 It SHALL CONTINUE TO deploy\n',
  '.kiro/specs/gamma/tasks.md': '# Implementation Plan\n\n- [ ] 1. Reproduce the defect\n',
};
const proposal = (documents: Record<string, string>) => validateProposal(JSON.parse(JSON.stringify(candidateProposal(discoverIds(documents)))), documents);
const named = (p: ConventionProposal, name: string) => p.suggestions.filter(item => item.category.name === name);

test('the Kiro profile proposes tasks from checkbox items in tasks.md, with spec scopes, statuses, and the names of tasks', () => {
  const p = proposal(FILES), [task] = named(p, 'Task');
  assert.equal(named(p, 'Task').length, 1);
  assert.equal(task.provider, 'Kiro');
  assert.deepEqual(task.category.idScopes, [{ pattern: '.kiro/specs/*' }]);
  assert.deepEqual(task.category.definitionPaths, ['**/.kiro/specs/**/tasks.md']);
  assert.deepEqual(task.rule, { key: 'kiro-task', category: 'kiro-task', pattern: String.raw`^(?<task>\d+(?:\.\d+)?)(?=\.?\s)`, id: 'Task {task}', defines: true });
  assert.deepEqual(task.references, [{ key: 'kiro-task-names', category: 'kiro-task', pattern: String.raw`\bTask \d+(?:\.\d+)?\b` }]);
  assert.equal(task.category.statusSites?.checkboxes?.enabled, true);
  assert.deepEqual(task.category.idDefinitionSites?.lists, { enabled: true, types: ['unordered', 'ordered'], mode: 'start', checkboxOnly: true });
  assert.match(task.uncertainty, /^8 checkbox items starting with a number in 3 tasks\.md files of Kiro specs/);
});

test('requirements, criteria, bugfix criteria, and tasks index together; tasks restart per spec and a bare 1.1 elsewhere is not a task', () => {
  const index = indexProject(FILES, mergeProposal({ version: 1, categories: [], rules: [] }, proposal(FILES)), new Map());
  const of = (name: string) => index.definitions.filter(d => d.category?.name === name);
  const tasks = of('Task').map(d => `${d.file.split('/')[2]} ${d.id}`);
  assert.deepEqual(tasks, ['alpha Task 1', 'alpha Task 1.1', 'alpha Task 1.2', 'alpha Task 2', 'beta Task 1', 'beta Task 1.1', 'beta Task 2', 'gamma Task 1']);
  assert.deepEqual(of('Task').map(d => d.authoredStatus?.evidence[0].display), ['Open', 'Done', 'In progress', 'Open', 'Done', 'Done', 'Open', 'Open']);
  assert.deepEqual(of('Acceptance criterion').filter(d => d.file.includes('gamma')).map(d => d.id), ['Criterion 1.1', 'Criterion 2.1', 'Criterion 3.1']);
  assert.equal(of('Acceptance criterion').length, 6 + 3);
  // "Task 1" and "Task 1.2" in alpha's text cite alpha's tasks; "1.1" in prose and in requirements.md is nothing; citations stay criteria.
  const cites = index.references.filter(r => r.category?.name === 'Task').map(r => `${r.file.split('/')[2]} ${r.id}`);
  assert.deepEqual(cites, ['alpha Task 1', 'alpha Task 1.2']);
  assert.ok(!index.references.some(r => r.file.endsWith('requirements.md') && r.category?.name === 'Task'));
  assert.deepEqual(index.references.filter(r => r.file === '.kiro/specs/alpha/tasks.md' && r.category?.name === 'Acceptance criterion').map(r => r.id), ['Criterion 1.1', 'Criterion 2.1', 'Criterion 1.2']);
  assert.equal(index.findings.filter(f => f.kind === 'duplicate' || f.kind === 'unresolved').length, 0);
});

test('anchored defining rules run only at their categories\' enabled sites and inside their definition paths', () => {
  const sites = (lists: boolean, paragraphs: boolean) => ({ headings: { enabled: false, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' },
    lists: { enabled: lists, types: ['unordered', 'ordered'], mode: 'start', ...(lists ? { checkboxOnly: true } : {}) }, paragraphs: { enabled: paragraphs, mode: 'start' } });
  const configuration = validateIdConfiguration({ version: 1,
    categories: [{ key: 'criterion', name: 'Criterion', idDefinitionSites: sites(false, true) }, { key: 'task', name: 'Task', definitionPaths: ['specs/*/tasks.md'], idDefinitionSites: sites(true, false) }],
    rules: [{ key: 'bugfix', category: 'criterion', pattern: String.raw`^(?<group>\d+)\.(?<item>\d+)(?=\s)`, id: 'Criterion {group}.{item}', defines: true },
      { key: 'task', category: 'task', pattern: String.raw`^(?<task>\d+(?:\.\d+)?)(?=\.?\s)`, id: 'Task {task}', defines: true }] });
  const matcher = compileIdMatcher(configuration), ids = (file: string, site?: Parameters<typeof matcher>[1]) => (matcher.forFile?.(file) ?? matcher)('1.1 Patch the stack', site).map(m => m.id);
  assert.deepEqual(ids('specs/a/tasks.md'), []);
  assert.deepEqual(ids('specs/a/tasks.md', 'lists'), ['Task 1.1']);
  assert.deepEqual(ids('specs/a/tasks.md', 'paragraphs'), ['Criterion 1.1']);
  assert.deepEqual(ids('specs/a/bugfix.md', 'lists'), []);
  assert.deepEqual(ids('specs/a/bugfix.md', 'paragraphs'), ['Criterion 1.1']);
  // Before 104 both rules matched every region and recognition stopped with "Rules 1 and 2 overlap".
  const documents = { 'specs/a/tasks.md': '- [x] 1.1 Patch the stack\n', 'specs/a/bugfix.md': '1.1 WHEN it deploys THEN it fails\n' };
  assert.deepEqual(indexProject(documents, configuration, new Map()).definitions.map(d => `${d.file} ${d.id}`), ['specs/a/tasks.md Task 1.1', 'specs/a/bugfix.md Criterion 1.1']);
});

test('the task suggestion replaces Specular\'s "Task N" heading suggestion, whose headings in tasks.md then define tasks', () => {
  const headed = { ...FILES, '.kiro/specs/delta/tasks.md': '# Tasks\n\n## Task 1: Create the fetcher\n\n## Task 2: Integrate it\n\n## Task 3: Test it\n\n## Task 4: Ship it\n\n## Task 5: Monitor it\n' };
  const p = proposal(headed), tasks = named(p, 'Task');
  assert.deepEqual(tasks.map(s => s.provider), ['Kiro']);
  assert.match(tasks[0].uncertainty, /This replaces the "Task N" heading suggestion \(5 headings in 1 files\); elsewhere those headings refer to these tasks\./);
  const index = indexProject(headed, mergeProposal({ version: 1, categories: [], rules: [] }, p), new Map());
  assert.deepEqual(index.definitions.filter(d => d.file.includes('delta')).map(d => d.id), ['Task 1', 'Task 2', 'Task 3', 'Task 4', 'Task 5']);
});
