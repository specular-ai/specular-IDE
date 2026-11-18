import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { candidateProposal, discoverIds, mergeProposal, validateProposal, type ConventionProposal } from '../src/core/id-discovery';

/** Increment 106: Trae and Kiro specs kept below the project root, one `.trae/specs` or `.kiro/specs` per sub-project. */
const proposal = (documents: Record<string, string>) => validateProposal(JSON.parse(JSON.stringify(candidateProposal(discoverIds(documents)))), documents);
const named = (p: ConventionProposal, name: string, provider: string) => p.suggestions.find(item => item.category.name === name && item.provider === provider)!;
const stage = (documents: Record<string, string>, suggestions: ConventionProposal['suggestions']) => indexProject(documents, mergeProposal({ version: 1, categories: [], rules: [] }, { version: 1, suggestions }), new Map());

// Shaped like don2vito/spider_project: two sub-projects, one with two specs and one with a single spec.
const TRAE_TASKS = '# Tasks\n\n- [x] Task 1: Fetch the pages\n  - [x] SubTask 1.1: Parse the index\n  - [ ] SubTask 1.2: Parse the details\n- [ ] Task 2: Store the results\n  - [ ] SubTask 2.1: Write the CSV\n\nTask 2 depends on Task 1.\n';
const TRAE: Record<string, string> = {
  'reports/html/.trae/specs/generate-report/tasks.md': TRAE_TASKS,
  'reports/html/.trae/specs/generate-report/spec.md': '# Generate report\n\nThe report.\n',
  'reports/html/.trae/specs/generate-report-v2/tasks.md': '# Tasks\n\n- [ ] Task 1: Redo the layout\n- [ ] Task 2: Add charts\n',
  'crawler/zhizhuan/.trae/specs/crawl-reports/tasks.md': TRAE_TASKS,
  'crawler/zhizhuan/.trae/specs/crawl-reports/spec.md': '# Crawl reports\n\nThe crawler.\n',
};

test('Trae tasks and subtasks in nested .trae/specs folders are defined, each spec folder its own scope', () => {
  const p = proposal(TRAE), task = named(p, 'Task', 'Trae'), subtask = named(p, 'Subtask', 'Trae');
  assert.deepEqual([task.category.idScopes, task.category.definitionPaths], [[{ pattern: '**/.trae/specs/*' }], ['**/.trae/specs/*/tasks.md']]);
  assert.deepEqual([subtask.category.idScopes, subtask.category.definitionPaths], [[{ pattern: '**/.trae/specs/*' }], ['**/.trae/specs/*/tasks.md']]);
  const index = stage(TRAE, [task, subtask]);
  const defined = (name: string) => index.definitions.filter(d => d.category?.name === name).map(d => `${d.file.split('/').slice(0, -1).join('/')} ${d.id}`);
  assert.deepEqual(defined('Task'), [
    'reports/html/.trae/specs/generate-report Task 1', 'reports/html/.trae/specs/generate-report Task 2',
    'reports/html/.trae/specs/generate-report-v2 Task 1', 'reports/html/.trae/specs/generate-report-v2 Task 2',
    'crawler/zhizhuan/.trae/specs/crawl-reports Task 1', 'crawler/zhizhuan/.trae/specs/crawl-reports Task 2']);
  assert.equal(defined('Subtask').length, 6);
  assert.equal(index.findings.filter(f => f.kind === 'duplicate' || f.kind === 'unresolved').length, 0);
  assert.equal(index.references.filter(r => r.category?.name === 'Task').length, 4);
});

const REQUIREMENTS = '# Requirements\n\n### Requirement 1\n\n#### Acceptance Criteria\n\n1. WHEN it runs THEN it SHALL work\n2. WHEN it stops THEN it SHALL rest\n';
const TASKS = '# Implementation Plan\n\n- [x] 1. Set up\n  - [ ] 1.1 Create the module\n- [ ] 2. Test it\n';
// As in the GitHub sample's dataagentx-components and dx repos: a root .kiro/specs and others in sub-packages.
const KIRO: Record<string, string> = {
  '.kiro/specs/platform/requirements.md': REQUIREMENTS, '.kiro/specs/platform/tasks.md': TASKS,
  '.kiro/specs/release/requirements.md': REQUIREMENTS, '.kiro/specs/release/tasks.md': TASKS,
  'backend/.kiro/specs/api/requirements.md': REQUIREMENTS, 'backend/.kiro/specs/api/tasks.md': TASKS,
  'backend/.kiro/specs/auth/requirements.md': REQUIREMENTS, 'backend/.kiro/specs/auth/tasks.md': TASKS,
  'frontend/.kiro/specs/ui/requirements.md': REQUIREMENTS, 'frontend/.kiro/specs/ui/tasks.md': TASKS,
};

test('Kiro tasks in root and nested .kiro/specs are defined, with a scope per specification root and the fallback for a single nested spec', () => {
  const p = proposal(KIRO), task = named(p, 'Task', 'Kiro');
  assert.deepEqual(task.category.definitionPaths, ['**/.kiro/specs/**/tasks.md']);
  // frontend holds a single spec, which is no specification root, so the fallback scope covers it.
  assert.deepEqual(task.category.idScopes, [{ pattern: '.kiro/specs/*' }, { pattern: 'backend/.kiro/specs/*' }, { pattern: '**/.kiro/specs/*' }]);
  const index = stage(KIRO, [task]);
  const tasks = index.definitions.filter(d => d.category?.name === 'Task');
  assert.equal(tasks.length, 5 * 3);
  assert.deepEqual([...new Set(tasks.map(d => d.file.replace(/\/tasks\.md$/u, '')))], ['.kiro/specs/platform', '.kiro/specs/release', 'backend/.kiro/specs/api', 'backend/.kiro/specs/auth', 'frontend/.kiro/specs/ui']);
  assert.equal(index.findings.filter(f => f.kind === 'duplicate').length, 0);
});
