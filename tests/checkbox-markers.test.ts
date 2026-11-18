import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { validateIdConfiguration } from '../src/core/id-configuration';
import { DEFAULT_ID_DEFINITION_SITES } from '../src/core/definition-sites';
import { DEFAULT_CHECKBOX_MARKERS, DEFAULT_STATUS_SITES } from '../src/core/status-sites';

/** Increment 105: `~` and `/` are in progress by default, and markers that give no status are counted. */
const TASKS = '# Tasks\n\n- [~] T001 Wait for CI\n- [/] T002 Half done\n- [>] T003 Forwarded\n- [x] T004 Done\n- [P] tasks = different files\n\nT001 and T003 are cited here.\n';
const configuration = (markers: Record<string, string> | undefined, enabled = true) => validateIdConfiguration({ version: 1,
  idDefinitionSites: { ...structuredClone(DEFAULT_ID_DEFINITION_SITES), lists: { enabled: true, types: ['unordered', 'ordered'], mode: 'start' } },
  statusSites: { ...structuredClone(DEFAULT_STATUS_SITES), checkboxes: { enabled, markers: markers ?? { ...DEFAULT_CHECKBOX_MARKERS } } },
  categories: [{ key: 'task', name: 'Task' }], rules: [{ key: 'task', category: 'task', pattern: String.raw`\bT\d{3}\b` }] });
const statuses = (index: ReturnType<typeof indexProject>) => Object.fromEntries(index.definitions.map(d => [d.id, d.authoredStatus?.evidence[0].display ?? '-']));

test('with the default markers, [~] and [/] are in progress and [>] is counted as a marker without a status', () => {
  assert.deepEqual({ ...DEFAULT_CHECKBOX_MARKERS }, { x: 'Done', X: 'Done', ' ': 'Open', '-': 'In progress', '~': 'In progress', '/': 'In progress' });
  const index = indexProject({ 'tasks.md': TASKS }, configuration(undefined), new Map());
  assert.deepEqual(statuses(index), { T001: 'In progress', T002: 'In progress', T003: '-', T004: 'Done' });
  // [P] starts no ID, so it is not counted.
  assert.deepEqual(index.unmappedMarkers, { '>': 1 });
});

test('saved markers without ~ keep their meaning, and the markers that gave no status are reported across files', () => {
  const saved = configuration({ x: 'Done', X: 'Done', ' ': 'Open', '-': 'In progress' });
  const index = indexProject({ 'a/tasks.md': TASKS, 'b/tasks.md': '- [~] T101 Queued\n- [ ] T102 Open\n' }, saved, new Map());
  assert.equal(statuses(index).T001, '-');
  assert.equal(statuses(index).T102, 'Open');
  assert.deepEqual(index.unmappedMarkers, { '~': 2, '/': 1, '>': 1 });
});

test('nothing is counted where checkbox statuses are off or every marker is mapped', () => {
  assert.equal(indexProject({ 'tasks.md': TASKS }, configuration(undefined, false), new Map()).unmappedMarkers, undefined);
  const all = configuration({ ...DEFAULT_CHECKBOX_MARKERS, '>': 'Deferred' });
  const index = indexProject({ 'tasks.md': TASKS }, all, new Map());
  assert.equal(index.unmappedMarkers, undefined);
  assert.equal(statuses(index).T003, 'Deferred');
});

test('a category whose own status sites map the marker counts it as mapped', () => {
  const base = configuration({ x: 'Done', ' ': 'Open' });
  const withCategory = validateIdConfiguration({ ...base, categories: [{ key: 'task', name: 'Task', statusSites: { ...structuredClone(DEFAULT_STATUS_SITES), checkboxes: { enabled: true, markers: { ...DEFAULT_CHECKBOX_MARKERS } } } }] });
  const index = indexProject({ 'tasks.md': TASKS }, withCategory, new Map());
  assert.deepEqual(index.unmappedMarkers, { '>': 1 });
  assert.equal(statuses(index).T001, 'In progress');
});
