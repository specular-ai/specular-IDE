import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { analyzedDocuments, exclusionFor, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, mergeProposal, validateProposal } from '../src/core/id-discovery';
import { toolFolders, TOOL_FOLDERS } from '../src/core/excluded-paths';
import { stageAgentProposal } from '../src/core/agent-proposal';
import { modelsFor } from '../src/renderer/plugin-models';
import type { WorkspaceViewSnapshot } from '../src/renderer/abstraction-views';

// A Spec Kit project: one real spec and tasks, the tool's templates, an agent command copy, and the constitution.
const FILES: Record<string, string> = {
  'specs/001-login/spec.md': '# Login\n\n- **FR-001**: Users MUST sign in.\n- **FR-002**: Users MUST sign out.\n\nTODO: confirm session length.\n',
  'specs/001-login/tasks.md': '# Tasks\n\n- [ ] T001 Build the form (FR-001)\n- [x] T002 Add sign-out (FR-002)\n',
  '.specify/templates/tasks-template.md': '# Tasks: [FEATURE]\n\n- [ ] T001 Create project structure\n- [ ] T002 Initialize project\n- [ ] T003 [P] Configure linting\n',
  '.specify/templates/spec-template.md': '# Spec\n\n- **FR-001**: System MUST [capability]\n- **FR-006**: System MUST authenticate users via [NEEDS CLARIFICATION: auth method]\n',
  '.claude/commands/speckit.tasks.md': '# Tasks command\n\n- [ ] T001 Example task\n',
  '.specify/memory/constitution.md': '# Constitution\n\nTODO: ratify.\n',
};
const CONFIGURATION: IdConfiguration = validateIdConfiguration({ version: 1,
  categories: [{ key: 'fr', name: 'Functional requirement', role: 'requirement' }, { key: 'task', name: 'Task', role: 'task' }],
  rules: [{ key: 'fr', category: 'fr', pattern: '\\bFR-\\d{3}\\b' }, { key: 'task', category: 'task', pattern: '\\bT\\d{3}\\b' }],
  idDefinitionSites: { headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered'], mode: 'start' } } });
const excluding = (paths: string[]) => validateIdConfiguration({ ...CONFIGURATION, excludedPaths: paths });
const pending = (index: ReturnType<typeof indexProject>) => index.findings.filter(item => item.kind === 'pending');

test('excludedPaths are validated like definition paths and kept by the configuration', () => {
  assert.deepEqual(excluding(['.specify/templates', 'docs/*/drafts']).excludedPaths, ['.specify/templates', 'docs/*/drafts']);
  assert.equal(validateIdConfiguration(CONFIGURATION).excludedPaths, undefined);
  for (const bad of [[], 'x', [1], ['a', 'A'], ['/abs'], ['../up'], Array.from({ length: 65 }, (_, i) => `f${i}`)]) {
    assert.throws(() => validateIdConfiguration({ ...CONFIGURATION, excludedPaths: bad }), /excludedPaths|Excluded paths|pattern|path/i, JSON.stringify(bad));
  }
});

test('excluded files are not analyzed: no definitions, references, or pending items from them', () => {
  const all = indexProject(FILES, CONFIGURATION), excluded = indexProject(FILES, excluding(['.specify/templates', '.claude/commands']));
  const files = (index: ReturnType<typeof indexProject>) => [...new Set([...index.definitions, ...index.references, ...index.findings].map(item => item.file))].sort();
  assert.ok(files(all).includes('.specify/templates/tasks-template.md'));
  assert.deepEqual(files(excluded), ['.specify/memory/constitution.md', 'specs/001-login/spec.md', 'specs/001-login/tasks.md']);
  assert.deepEqual(excluded.definitions.map(item => item.id).sort(), ['FR-001', 'FR-002', 'T001', 'T002']);
  // The duplicate T001-T002 and FR-001 definitions came from the templates.
  assert.ok(all.findings.some(item => item.kind === 'duplicate'));
  assert.ok(!excluded.findings.some(item => item.kind === 'duplicate'));
  // The templates add 4 pending items and the spec template's clarification marker (99b).
  assert.equal(pending(all).length, pending(excluded).length + 5);
  assert.deepEqual(pending(excluded).map(item => item.file).sort(), ['.specify/memory/constitution.md', 'specs/001-login/spec.md', 'specs/001-login/tasks.md']);
  assert.equal(exclusionFor('.specify/templates/spec-template.md', excluding(['.specify/templates'])), '.specify/templates');
  assert.equal(exclusionFor('.specify/memory/constitution.md', excluding(['.specify/templates'])), undefined);
  assert.equal(analyzedDocuments(FILES, CONFIGURATION), FILES);
});

test('discovery proposes the tool folders present, never tool memory, and staging adds them to the draft once', () => {
  assert.ok(!TOOL_FOLDERS.some(path => path.startsWith('.specify/memory')));
  const index = indexProject(FILES, CONFIGURATION);
  const folders = toolFolders(Object.keys(FILES), index);
  assert.deepEqual(folders, [
    { path: '.specify/templates', files: 2, definitions: 5, pending: 4 },
    { path: '.claude/commands', files: 1, definitions: 1, pending: 1 }]);
  const inventory = { ...discoverIds(FILES), toolFolders: folders };
  const proposal = validateProposal(candidateProposal(inventory), FILES);
  assert.deepEqual(proposal.exclusions?.map(x => [x.paths, x.files, x.definitions, x.pending]), [[['.specify/templates', '.claude/commands'], [2, 1], [5, 1], [4, 1]]]);
  assert.match(proposal.exclusions![0].uncertainty, /3 Markdown files.*6 definitions and 5 pending items/);
  const staged = mergeProposal({ ...CONFIGURATION, excludedPaths: ['.claude/commands'] }, { version: 1, suggestions: [], exclusions: proposal.exclusions });
  assert.deepEqual(staged.excludedPaths, ['.claude/commands', '.specify/templates']);
  // Once excluded, the folders are no longer analyzed, so nothing is proposed again.
  const after = analyzedDocuments(FILES, staged);
  assert.deepEqual(toolFolders(Object.keys(after)), []);
  for (const bad of [{ paths: [] }, { paths: ['x'], files: [1, 2] }, { files: [-1] }]) {
    assert.throws(() => validateProposal({ ...proposal, exclusions: [{ ...proposal.exclusions![0], ...bad }] }, FILES), /exclu|path|count/i, JSON.stringify(bad));
  }
  assert.throws(() => validateProposal({ ...proposal, exclusions: [proposal.exclusions![0], { ...proposal.exclusions![0], key: 'other' }] }, FILES), /at most one/);
  assert.equal(candidateProposal(discoverIds(FILES)).exclusions, undefined);
});

test('staging an agent proposal keeps the draft\'s excluded paths', () => {
  const draft = excluding(['.specify/templates']);
  const proposed = validateIdConfiguration({ ...CONFIGURATION, categories: [...CONFIGURATION.categories, { key: 'sc', name: 'Success criterion' }], rules: [...CONFIGURATION.rules, { key: 'sc', category: 'sc', pattern: '\\bSC-\\d{3}\\b' }] });
  assert.deepEqual(stageAgentProposal(draft, proposed, ['sc'], false).excludedPaths, ['.specify/templates']);
});

test('plugins list excluded files but read only analyzed text, and an excluded current file is not sent', () => {
  const configuration = excluding(['.specify/templates', '.claude/commands']);
  const files = Object.keys(FILES).map(path => ({ path, markdown: true }));
  const folders = [...new Set(Object.keys(FILES).flatMap(file => file.split('/').slice(0, -1).map((_, i, parts) => parts.slice(0, i + 1).join('/'))))];
  const snapshot = { projectId: 'p', revision: 1, ready: true, currentFile: '.specify/templates/spec-template.md', configuration, notice: '', documents: FILES, folders, files, index: indexProject(FILES, configuration), warnings: [] } as unknown as WorkspaceViewSnapshot;
  const { physical, project } = modelsFor(snapshot);
  assert.equal(physical.files.length, 6);
  assert.deepEqual(physical.documents.map(d => d.file).sort(), ['.specify/memory/constitution.md', 'specs/001-login/spec.md', 'specs/001-login/tasks.md']);
  assert.ok(!project.occurrences.some(o => o.source.file.startsWith('.specify/templates') || o.source.file.startsWith('.claude/')));
});
