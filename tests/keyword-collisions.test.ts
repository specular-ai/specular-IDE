import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { validateIdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, validateProposal } from '../src/core/id-discovery';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, type IdConfiguration } from '../src/core/id-configuration';

const SITES = { headings: { enabled: true, levels: [3], mode: 'start' as const }, tables: { enabled: false, column: 'ID', mode: 'exact' as const } };
const CONFIGURATION = validateIdConfiguration({ version: 1, categories: [
  { key: 'story', name: 'User Story', idDefinitionSites: SITES },
  { key: 'example', name: 'Parallel Example', idDefinitionSites: { headings: { enabled: true, levels: [2], mode: 'keyword', keyword: 'Parallel Example' }, tables: { enabled: false, column: 'ID', mode: 'exact' } } },
], rules: [{ key: 'story', category: 'story', pattern: String.raw`\bUser\s+Story \d+\b` }] });
const SPEC = '# Spec\n\n### User Story 1 - Sign in\n\n### User Story 3 - Export\n';
const TASKS = '# Tasks\n\n## Parallel Example: User Story 1\n\nRun T001 and T002 together.\n\n## Parallel Example: User Story 3\n\n## Parallel Example: Setup Phase\n';

test('a keyword heading naming another category\'s ID is about that ID: it defines nothing, and the ID stays a reference', () => {
  const index = indexProject({ 'spec.md': SPEC, 'tasks.md': TASKS }, CONFIGURATION);
  assert.deepEqual(index.definitions.map(item => [item.category?.name, item.id]).sort(), [['Parallel Example', 'Setup Phase'], ['User Story', 'User Story 1'], ['User Story', 'User Story 3']]);
  assert.deepEqual(index.references.filter(item => item.file === 'tasks.md').map(item => [item.id, item.line]), [['User Story 1', 3], ['User Story 3', 7]]);
  assert.ok(!index.findings.some(item => item.kind === 'duplicate'));
});

test('an ID in two categories names both in the error', () => {
  const twice: IdConfiguration = { version: 1, categories: [{ key: 'a', name: 'Alpha needs' }, { key: 'b', name: 'Beta notes' }],
    rules: [{ key: 'first', category: 'a', pattern: '(?<=A )REF-1' }, { key: 'second', category: 'b', pattern: '(?<=B )REF-1' }] };
  assert.throws(() => buildIndex([analyzeDocument('x.md', 'A REF-1\nB REF-1', compileIdMatcher(twice))]),
    /REF-1 has conflicting categories at x\.md:2: it is recognized both as Alpha needs and as Beta notes\. Keep one/);
});

test('discovery does not offer a keyword category whose headings all name another suggestion\'s IDs, and drops such examples otherwise', () => {
  const stories = Array.from({ length: 4 }, (_, i) => `### User Story ${i + 1} - Story ${i + 1}\n`).join('\n');
  const examples = (names: string[]) => names.map(name => `## Parallel Example: ${name}\n\nRun the tasks together.\n`).join('\n');
  const only = { 'specs/a/spec.md': stories, 'specs/b/spec.md': stories, 'specs/a/tasks.md': examples(['User Story 1', 'User Story 2', 'User Story 3']) };
  const proposal = validateProposal(candidateProposal(discoverIds(only)), only);
  assert.ok(proposal.suggestions.some(s => s.category.name === 'User Story'), JSON.stringify(proposal.suggestions.map(s => s.category.name)));
  assert.ok(!proposal.suggestions.some(s => s.category.name === 'Parallel Example'));
  const mixed = { ...only, 'specs/a/tasks.md': examples(['User Story 1', 'Setup Phase', 'Polish Phase']), 'specs/b/tasks.md': examples(['User Story 2', 'Setup Phase', 'Polish Phase']) };
  const kept = validateProposal(candidateProposal(discoverIds(mixed)), mixed).suggestions.find(s => s.category.name === 'Parallel Example');
  assert.ok(kept, 'Parallel Example is offered for its other headings');
  assert.ok(kept.evidence.length && kept.evidence.every(e => !/User Story/.test(e.id)), JSON.stringify(kept.evidence.map(e => e.id)));
  assert.match(kept.uncertainty, /Headings naming User Story IDs, such as "Parallel Example: User Story \d", are about those IDs and define nothing/);
});
