import { LEGACY_ID_CONFIGURATION } from '../src/core/id-configuration';
import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, validateIdConfiguration } from '../src/core/id-configuration';
import { mapStatuses } from '../src/core/statuses';
import { DEFAULT_STATUS_SITES } from '../src/core/status-sites';
import { annotateDates } from '../src/core/dates';
import { assignModules } from '../src/core/modules';
import { assignFeatures } from '../src/core/features';
import { modelsFor } from '../src/renderer/plugin-models';
import type { WorkspaceViewSnapshot } from '../src/renderer/abstraction-views';
import { API_VERSION } from '../packages/plugin-api/src/index';
import { forPlugin, parseRequest, type PluginManifest } from '../src/shared/plugin-runtime';

const documents = { 'spec.md': '# REQ-001 First\nSee DD-001.\n', 'specs/design.md': '# DD-001 Design\nImplements REQ-001.\n' };
function snapshot(ready = true, revision = 3): WorkspaceViewSnapshot {
  return { projectId: 'internal', revision, ready, currentFile: 'spec.md', configuration: LEGACY_ID_CONFIGURATION, notice: '', documents,
    folders: ['specs'], files: [{ path: 'spec.md', markdown: true }, { path: 'specs/design.md', markdown: true }, { path: 'src/a.ts', markdown: false }],
    index: buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text))), warnings: ['specs/big.md: too large'] };
}
const manifest: PluginManifest = { manifestVersion: 1, id: 'test.models', version: '1.0.0', api: API_VERSION, entry: 'index.js', capabilities: ['workspace.read', 'source.navigate'], models: ['project@1', 'physical@1'], views: [{ id: 'list', title: 'List', kind: 'list' }] };

test('each published snapshot is turned into models once and shared', () => {
  const published = snapshot();
  assert.equal(modelsFor(published), modelsFor(published));
  assert.notEqual(modelsFor(snapshot()), modelsFor(published));
});
test('the physical model describes folders, files, current Markdown text, and summarized warnings', () => {
  const { physical } = modelsFor(snapshot());
  assert.deepEqual([physical.name, physical.version, physical.revision, physical.ready, physical.provenance.extractor], ['physical', 1, 3, true, 'specular.physical']);
  assert.deepEqual(physical.folders, ['specs']);
  assert.deepEqual(physical.files.map(file => [file.path, file.markdown]), [['spec.md', true], ['specs/design.md', true], ['src/a.ts', false]]);
  assert.deepEqual(physical.documents.map(document => document.file), ['spec.md', 'specs/design.md']);
  assert.deepEqual(physical.warnings, ['The project has 1 file-reading warning(s).']);
});
test('the project model carries ID occurrences only when the index is ready', () => {
  const ready = modelsFor(snapshot()).project;
  assert.deepEqual([ready.name, ready.version, ready.revision, ready.ready, ready.provenance.extractor], ['project', 1, 3, true, 'specular.project']);
  assert.deepEqual(ready.occurrences.filter(o => o.kind === 'definition').map(o => o.id).sort(), ['DD-001', 'REQ-001']);
  const pending = modelsFor(snapshot(false)).project;
  assert.equal(pending.ready, false); assert.deepEqual(pending.occurrences, []);
});
test('host-built models pass the broker and are narrowed to the declared models', () => {
  const request = { apiVersion: API_VERSION, requestId: 'r', viewId: 'list', context: { projectId: 'opaque', revision: 3, currentFile: 'spec.md' }, models: modelsFor(snapshot()) };
  const parsed = parseRequest(JSON.stringify(request), manifest);
  assert.equal(parsed.models.project?.occurrences.length, request.models.project.occurrences.length);
  assert.deepEqual(Object.keys(forPlugin(parsed, { ...manifest, models: ['physical@1'] }).models), ['physical']);
});

// Increment 77: statuses, features, and configured lists come from the same indexing pipeline as Project Lens.
const configured = validateIdConfiguration({ version: 1,
  categories: [{ key: 'REQ', name: 'Requirements', role: 'requirement', colors: { light: '#123456', dark: '#abcdef' } }, { key: 'DD', name: 'Decisions', role: 'design' }, { key: 'NEVER', name: 'Never used' }],
  rules: [{ key: 'REQ', category: 'REQ', prefix: 'REQ' }, { key: 'DD', category: 'DD', prefix: 'DD' }, { key: 'NEVER', category: 'NEVER', prefix: 'NEVER' }],
  statuses: [{ name: 'Implemented', rules: [{ mode: 'startsWith', value: 'Implemented' }], colors: { light: '#116633', dark: '#88dd99' } }, { name: 'Proposed' }, { name: 'Unused' }],
  modules: [{ key: 'gui', name: 'GUI' }, { key: 'backend', name: 'Backend' }], moduleOverrides: [{ id: 'REQ-001', modules: ['gui'] }],
  features: [{ key: 'timeline', name: 'Timeline' }, { key: 'idle', name: 'Idle' }], featureOverrides: [{ id: 'REQ-001', features: ['timeline'] }] });
const statusDocuments = {
  'spec.md': '# REQ-001 First requirement\n\nStatus: Implemented on 2026-10-13.\n\nSee DD-001 and REQ-404.\n',
  'design.md': '# DD-001 Design\n\nStatus: Proposed\n',
  'other.md': '# DD-001 Duplicate design\n\nStatus: Implemented\n',
};
function configuredSnapshot(): WorkspaceViewSnapshot {
  const match = compileIdMatcher(configured);
  const built = buildIndex(Object.entries(statusDocuments).map(([file, text]) => analyzeDocument(file, text, match)));
  const index = { ...annotateDates(mapStatuses(assignFeatures(assignModules(built, configured), configured), configured.statuses ?? []), statusDocuments), configurationRevision: 'config-77' };
  return { projectId: 'internal', revision: 5, ready: true, notice: '', documents: statusDocuments, configuration: configured, folders: [], files: [], index, warnings: [] };
}
test('the project model lists each distinct ID with its status occurrences, modules, and features', () => {
  const project = modelsFor(configuredSnapshot()).project;
  assert.equal(project.provenance.extractorVersion, '6');
  assert.deepEqual(project.ids.map(item => item.key), ['REQ-001', 'DD-001', 'REQ-404']);
  const requirement = project.ids.find(item => item.key === 'REQ-001')!;
  assert.deepEqual(requirement.category, { key: 'REQ', name: 'Requirements', role: 'requirement' });
  assert.equal(requirement.definitions.length, 1);
  assert.equal(requirement.status?.state, 'authored');
  const [status] = requirement.status!.occurrences;
  assert.deepEqual([status.value, status.name, status.site], ['Implemented on 2026-10-13.', 'Implemented', 'paragraphs']);
  assert.match(statusDocuments['spec.md'].slice(status.source.start, status.source.end), /Implemented on 2026-10-13\./);
  // Increment 79: the status-date rule records the written date with its exact range.
  assert.deepEqual([status.date?.value, status.date?.text, status.date?.rule], ['2026-10-13', 'on 2026-10-13', 'status-date']);
  assert.equal(statusDocuments['spec.md'].slice(status.date!.source.start, status.date!.source.end), 'on 2026-10-13');
  assert.deepEqual(requirement.modules?.modules, [{ key: 'gui', name: 'GUI' }]);
  assert.deepEqual([requirement.features?.state, requirement.features?.features], ['assigned', [{ key: 'timeline', name: 'Timeline' }]]);
  assert.equal(requirement.features?.evidence[0].kind, 'id-override');
  assert.equal('explicit' in requirement.features!, false);
  // Two definitions with different authored statuses: a duplicate with a status conflict, kept as separate evidence.
  const decision = project.ids.find(item => item.key === 'DD-001')!;
  assert.equal(decision.definitions.length, 2);
  assert.equal(decision.status?.state, 'conflict');
  assert.deepEqual(decision.status!.occurrences.map(item => item.name).sort(), ['Implemented', 'Proposed']);
  // Only referenced: an element without definitions or status.
  const missing = project.ids.find(item => item.key === 'REQ-404')!;
  assert.deepEqual([missing.definitions.length, missing.status], [0, undefined]);
});
test('configured lists include unused entries, names and colours only, never matching rules', () => {
  const { configuration } = modelsFor(configuredSnapshot()).project;
  assert.deepEqual(configuration.categories.map(item => item.key), ['REQ', 'DD', 'NEVER']);
  assert.deepEqual(configuration.categories[0].colors, { light: '#123456', dark: '#abcdef' });
  assert.deepEqual(configuration.statuses, [{ name: 'Implemented', colors: { light: '#116633', dark: '#88dd99' } }, { name: 'Proposed' }, { name: 'Unused' }]);
  assert.deepEqual(configuration.modules.map(item => item.key), ['gui', 'backend']);
  assert.deepEqual(configuration.features.map(item => item.key), ['timeline', 'idle']);
  assert.doesNotMatch(JSON.stringify(configuration), /rules|startsWith|prefix|statusSites/);
});
test('the extended project model passes the broker unchanged and stays empty while indexing', () => {
  const models = modelsFor(configuredSnapshot());
  const request = { apiVersion: API_VERSION, requestId: 'r', viewId: 'list', context: { projectId: 'opaque', revision: 5 }, models };
  assert.deepEqual(parseRequest(JSON.stringify(request), manifest).models.project, models.project);
  const pending = modelsFor({ ...configuredSnapshot(), ready: false }).project;
  assert.deepEqual([pending.ids, pending.occurrences], [[], []]);
  assert.equal(pending.configuration.statuses.length, 3);
});

test('checkbox task statuses reach plugins with the checkboxes site (increment 88)', () => {
  const text = '# Tasks\n\n- [x] 1. Write tests\n- [-] 2. Phase one\n';
  const configuration = validateIdConfiguration({ version: 1, categories: [{ key: 'task', name: 'Tasks', role: 'task' }], rules: [{ key: 't', category: 'task', pattern: '^\\d+' }],
    idDefinitionSites: { headings: { enabled: false, levels: [1], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered'], mode: 'start' } },
    statusSites: { ...DEFAULT_STATUS_SITES, checkboxes: { enabled: true, markers: { x: 'Done', '-': 'In progress' } } } });
  const index = mapStatuses(buildIndex([analyzeDocument('tasks.md', text, compileIdMatcher(configuration))]), []);
  const tasks: WorkspaceViewSnapshot = { ...snapshot(), configuration, documents: { 'tasks.md': text }, files: [{ path: 'tasks.md', markdown: true }], folders: [], index };
  const request = { apiVersion: API_VERSION, requestId: 'r', viewId: 'list', context: { projectId: 'opaque', revision: 3, currentFile: 'tasks.md' }, models: modelsFor(tasks) };
  const parsed = parseRequest(JSON.stringify(request), manifest);
  const statuses = parsed.models.project!.ids.map(element => [element.id, element.status?.occurrences.map(o => [o.name, o.site])]);
  assert.deepEqual(statuses, [['1', [['Done', 'checkboxes']]], ['2', [['In progress', 'checkboxes']]]]);
});
