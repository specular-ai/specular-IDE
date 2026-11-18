import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, validateIdConfiguration } from '../src/core/id-configuration';
import { mapStatuses } from '../src/core/statuses';
import { annotateDates } from '../src/core/dates';
import { assignModules } from '../src/core/modules';
import { assignFeatures } from '../src/core/features';
import { modelsFor } from '../src/renderer/plugin-models';
import type { WorkspaceViewSnapshot } from '../src/renderer/abstraction-views';
import { buildDossier, changesText, citationParts, excerpt, featureChoices, MAX_EXCERPT_LINES } from '../bundled-plugins/feature-dossier/src/dossier';

// Increment 93: two features, roles and a role-free category, a duplicate with feature and status conflicts, dates, and links.
// Features are assigned to definitions, so a referenced-only ID (REQ-404) is no member: it appears as an undefined link target.
const configuration = validateIdConfiguration({ version: 1,
  categories: [{ key: 'TASK', name: 'Tasks', role: 'task' }, { key: 'NOTE', name: 'Notes' }, { key: 'REQ', name: 'Requirements', role: 'requirement' }, { key: 'DD', name: 'Decisions', role: 'design' }],
  rules: [{ key: 'REQ', category: 'REQ', prefix: 'REQ' }, { key: 'DD', category: 'DD', prefix: 'DD' }, { key: 'TASK', category: 'TASK', prefix: 'TASK' }, { key: 'NOTE', category: 'NOTE', prefix: 'NOTE' }],
  statuses: [{ name: 'Proposed', rules: [{ mode: 'startsWith', value: 'Proposed' }] }, { name: 'Implemented', rules: [{ mode: 'startsWith', value: 'Implemented' }], colors: { light: '#116633', dark: '#88dd99' } }],
  features: [{ key: 'billing', name: 'Billing' }, { key: 'auth', name: 'Authentication' }, { key: 'idle', name: 'Idle' }],
  featureRules: [{ key: 'auth', scope: 'folder', path: 'auth', features: ['auth'] }, { key: 'billing', scope: 'folder', path: 'billing', features: ['billing'] }],
});
const long = Array.from({ length: MAX_EXCERPT_LINES + 2 }, (_, i) => `Step line ${i + 1}.`).join('\n');
const documents: Record<string, string> = {
  'auth/requirements.md': '# REQ-10 Login\n\nStatus: Implemented on 2026-10-13.\n\nUsers log in through DD-1.\nSee REQ-2 and REQ-404.\n\n# REQ-2 Second rule\n\nStatus: Proposed\n',
  'auth/design.md': '# DD-1 Session design\n\nUses REQ-10 and REQ-50.\n\n# DD-2 Shared token\n\nStatus: Implemented\n',
  'auth/tasks.md': `# TASK-1 Build login\n\n${long}\n\n- 2026-10-01: Started TASK-1 for REQ-10\n- 2026-10-20: Reviewed TASK-1\n`,
  'auth/notes.md': '# NOTE-1 Remark\n\nMentions DD-1.\n',
  'billing/spec.md': '# REQ-50 Charge\n\nStatus: Implemented on 2026-09-01.\n\nDepends on REQ-10.\n',
  'billing/design.md': '# DD-2 Shared token\n\nStatus: Proposed\n',
};
function models() {
  const match = compileIdMatcher(configuration);
  const built = buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, match)));
  const index = annotateDates(mapStatuses(assignFeatures(assignModules(built, configuration), configuration), configuration.statuses ?? []), documents);
  const snapshot: WorkspaceViewSnapshot = { projectId: 'internal', revision: 4, ready: true, notice: '', documents, configuration, folders: ['auth', 'billing'],
    files: Object.keys(documents).map(path => ({ path, markdown: true })), index, warnings: [] };
  return modelsFor(snapshot);
}

test('features are offered in configuration order with their ID counts, conflicts counting in each feature', () => {
  const project = models().project;
  assert.deepEqual(featureChoices(project).map(f => [f.name, f.count]), [['Billing', 2], ['Authentication', 6], ['Idle', 0]]);
  assert.equal(buildDossier(models(), 'missing'), undefined);
  assert.deepEqual(buildDossier(models(), 'idle')!.sections, []);
});

test('a dossier orders sections by role then configuration, IDs naturally, and summarizes statuses and markers', () => {
  const dossier = buildDossier(models(), 'auth')!;
  assert.deepEqual(dossier.sections.map(s => [s.name, s.role ?? null, s.ids.map(i => i.label)]), [
    ['Requirements', 'requirement', ['REQ-2', 'REQ-10']],
    ['Decisions', 'design', ['DD-1', 'DD-2']],
    ['Tasks', 'task', ['TASK-1']],
    ['Notes', null, ['NOTE-1']],
  ]);
  const ids = new Map(dossier.sections.flatMap(s => s.ids).map(i => [i.label, i]));
  assert.deepEqual([ids.get('REQ-10')!.title, ids.get('DD-2')!.title], ['Login', 'Shared token']);
  assert.deepEqual(ids.get('REQ-10')!.status, { name: 'Implemented', conflict: false });
  assert.deepEqual(ids.get('DD-2')!.status, { name: 'Status conflict', conflict: true });
  assert.deepEqual([ids.get('DD-2')!.duplicate, ids.get('DD-2')!.featureConflict, ids.get('DD-2')!.excerpts.length], [true, true, 2]);
  assert.deepEqual(dossier.summary.statuses.map(s => [s.name, s.count, s.colors?.dark ?? null]), [['Proposed', 1], ['Implemented', 1, '#88dd99']].map(([n, c, d]) => [n, c, d ?? null]));
  assert.deepEqual([dossier.summary.noStatus, dossier.summary.statusConflicts, dossier.summary.featureConflicts, dossier.summary.referencedOnly, dossier.summary.duplicated], [3, 1, 1, 0, 1]);
  const billing = buildDossier(models(), 'billing')!;
  assert.deepEqual(billing.sections.map(s => s.ids.map(i => i.label)), [['REQ-50'], ['DD-2']]);
});

test('excerpts take the defining line and the block below it, limited and marked when truncated', () => {
  const dossier = buildDossier(models(), 'auth')!;
  const ids = new Map(dossier.sections.flatMap(s => s.ids).map(i => [i.label, i]));
  const [requirement] = ids.get('REQ-10')!.excerpts;
  assert.deepEqual([requirement.text, requirement.line, requirement.truncated, requirement.source.file], ['# REQ-10 Login\nStatus: Implemented on 2026-10-13.', 1, false, 'auth/requirements.md']);
  const [task] = ids.get('TASK-1')!.excerpts;
  assert.equal(task.text.split('\n').length, MAX_EXCERPT_LINES); assert.equal(task.truncated, true);
  assert.deepEqual(ids.get('DD-2')!.excerpts.map(e => e.source.file), ['auth/design.md', 'billing/design.md']);
  assert.deepEqual(excerpt('intro\n| REQ-1 | Row |\n| REQ-2 | Next |\n\nAfter', { file: 'f.md', start: 8, end: 13 }), { source: { file: 'f.md', start: 8, end: 13 }, line: 2, text: '| REQ-1 | Row |\n| REQ-2 | Next |', truncated: false });
});

test('links split into this feature and others with direction and evidence; dates and files come from member IDs', () => {
  const dossier = buildDossier(models(), 'auth')!;
  const ids = new Map(dossier.sections.flatMap(s => s.ids).map(i => [i.label, i]));
  const req = ids.get('REQ-10')!, design = ids.get('DD-1')!;
  assert.deepEqual(req.inside.map(l => [l.label, l.direction, l.evidence]), [['DD-1', 'both', 2], ['REQ-2', 'out', 1], ['TASK-1', 'in', 1]]);
  assert.deepEqual(req.outside.map(l => [l.label, l.direction, l.evidence, l.defined, l.target?.file]), [['REQ-50', 'in', 1, true, 'billing/spec.md'], ['REQ-404', 'out', 1, false, 'auth/requirements.md']]);
  assert.deepEqual(design.outside.map(l => [l.label, l.direction]), [['REQ-50', 'out']]);
  assert.deepEqual(design.inside.map(l => l.label), ['NOTE-1', 'REQ-10']);
  assert.deepEqual(dossier.dates.map(d => [d.value, d.label, d.kind]), [['2026-10-20', 'TASK-1', 'event'], ['2026-10-13', 'REQ-10', 'status'], ['2026-10-01', 'TASK-1', 'event']]);
  assert.deepEqual(dossier.files.map(f => [f.file, f.count]), [['auth/design.md', 2], ['auth/notes.md', 1], ['auth/requirements.md', 2], ['auth/tasks.md', 1], ['billing/design.md', 1]]);
});

test('summary citations of project IDs become parts with keys; other brackets stay text (94b)', () => {
  const project = models().project;
  assert.deepEqual(citationParts('Login [REQ-10] uses [DD-1, REQ-404] and [note] [REQ-99].', project), [
    { text: 'Login [' }, { text: 'REQ-10', key: 'REQ-10' }, { text: '] uses [' }, { text: 'DD-1', key: 'DD-1' }, { text: ', ' }, { text: 'REQ-404', key: 'REQ-404' }, { text: '] and [note] [REQ-99].' },
  ]);
  assert.deepEqual(citationParts('No citations.', project), [{ text: 'No citations.' }]);
});

test('changes since generation are described briefly, or not at all when current (94b)', () => {
  assert.equal(changesText({ added: [], removed: [], changed: [], instruction: false }), undefined);
  assert.equal(changesText({ added: ['A', 'B'], removed: ['C'], changed: [{ key: 'D', fields: ['title', 'excerpt'] }, { key: 'E', fields: ['status'] }], instruction: true }),
    '2 IDs added, 1 ID removed, 1 title changed, 1 status changed, 1 definition edited, the summary instruction was updated');
});
