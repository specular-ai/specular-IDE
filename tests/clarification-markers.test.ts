import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { validateIdConfiguration } from '../src/core/id-configuration';

const CONFIGURATION = validateIdConfiguration({ version: 1,
  categories: [{ key: 'fr', name: 'Functional requirement', role: 'requirement' }, { key: 'task', name: 'Task', role: 'task' }],
  rules: [{ key: 'fr', category: 'fr', pattern: '\\bFR-\\d{3}\\b' }, { key: 'task', category: 'task', pattern: '\\bT\\d{3}\\b' }],
  idDefinitionSites: { headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered'], mode: 'start' } } });

const SPEC = [
  '# Feature',
  '',
  'Scope is [NEEDS CLARIFICATION: which platforms?] for now.',
  '',
  '## FR-001 Authentication',
  '',
  'Users MUST sign in via [NEEDS CLARIFICATION: auth method not specified - email/password, SSO, **OAuth**?].',
  '',
  'Sessions last [NEEDS CLARIFICATION: session length].',
  '',
  '- [x] No [NEEDS CLARIFICATION: leftover] markers remain',
  '',
  'Use `[NEEDS CLARIFICATION: inline example]` in specs.',
  '',
  '```',
  '[NEEDS CLARIFICATION: fenced example]',
  '```',
  '',
  '1. **Mark all ambiguities**: Use [NEEDS CLARIFICATION: specific question] for any assumption.',
  '',
  'All NEEDS CLARIFICATION items resolved.',
  '',
].join('\n');

const clarifications = (files: Record<string, string>) => indexProject(files, CONFIGURATION).findings.filter(item => item.kind === 'pending' && item.clarification);

test('open clarification markers are pending items with their question and owning ID', () => {
  const found = clarifications({ 'specs/001/spec.md': SPEC });
  assert.deepEqual(found.map(item => [item.line, item.message, item.owner?.id]), [
    [3, 'which platforms?', undefined],
    [7, 'auth method not specified - email/password, SSO, **OAuth**?', 'FR-001'],
    [9, 'session length', 'FR-001']]);
  assert.equal(found[1].column, 'Users MUST sign in via '.length + 1);
});

test('a marker in an open task replaces the task\'s generic pending item; other pending work keeps its owner', () => {
  const tasks = '# Tasks\n\n- [ ] T001 Pick the store [NEEDS CLARIFICATION: SQL or document?]\n- [ ] T002 Build the form\n\n## FR-002 Export\n\nTODO: formats.\n';
  const index = indexProject({ 'specs/001/tasks.md': tasks }, CONFIGURATION);
  const pending = index.findings.filter(item => item.kind === 'pending');
  assert.deepEqual(pending.map(item => [item.line, item.message, !!item.clarification, item.owner?.id]), [
    [3, 'SQL or document?', true, 'T001'],
    [4, 'T002 Build the form', false, 'T002'],
    [8, 'TODO: formats.', false, 'FR-002']]);
});

test('excluded templates add no clarification markers', () => {
  const template = '# Spec\n\n- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method not specified]\n';
  const files = { '.specify/templates/spec-template.md': template, 'specs/001/spec.md': '# Spec\n\nDone.\n' };
  assert.equal(clarifications(files).length, 1);
  assert.equal(indexProject(files, validateIdConfiguration({ ...CONFIGURATION, excludedPaths: ['.specify/templates'] })).findings.filter(item => item.clarification).length, 0);
});
