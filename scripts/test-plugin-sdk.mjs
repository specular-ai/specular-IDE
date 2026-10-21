import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const relationshipsProject = await mkdtemp(path.join(tmpdir(), 'specular-relationships-sdk-'));
await cp(path.join(root, 'bundled-plugins/relationships'), relationshipsProject, { recursive: true });
const relationshipsMetadata = JSON.parse(await readFile(path.join(relationshipsProject, 'package.json'), 'utf8'));
relationshipsMetadata.devDependencies = {};
await writeFile(path.join(relationshipsProject, 'package.json'), JSON.stringify(relationshipsMetadata));
execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', path.join(root, '.cache/plugin-sdk/specular-plugin-api-0.2.0.tgz')], { cwd: relationshipsProject, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit'], { cwd: relationshipsProject, stdio: 'inherit' });
const { build } = await import('esbuild');
await build({ absWorkingDir: relationshipsProject, entryPoints: ['src/index.ts'], outfile: 'dist/index.js', bundle: true, platform: 'browser', format: 'esm', target: 'es2022' });
execFileSync(process.execPath, [path.join(relationshipsProject, 'node_modules/@specular/plugin-api/bin/validate.mjs'), relationshipsProject], { cwd: relationshipsProject, stdio: 'inherit' });
assert.doesNotMatch(await readFile(path.join(relationshipsProject, 'dist/index.js'), 'utf8'), /(?:from\s+|import\s*\()['"]/);
console.log(`Independent bundled Relationships build passed: ${relationshipsProject}`);
// Exercise the public scope contract with opaque keys unrelated to the host's encoding.
await build({ absWorkingDir: relationshipsProject, stdin: { contents: "export { projectIndex } from './src/model.ts'; export { buildDependencyGraph } from './src/dependencies.ts'; export { keyLabel } from './src/id-identity.ts';", resolveDir: relationshipsProject }, outfile: 'scope-check.mjs', bundle: true, platform: 'node', format: 'esm' });
const scoped = await import(pathToFileURL(path.join(relationshipsProject, 'scope-check.mjs')).href);
const scopedDocuments = ['specs/one/spec.md', 'specs/two/spec.md'].map(file => ({ file, text: 'FR-001' }));
// API 0.2 requests carry named models; build the two the bundled plugin declares.
const modelsOf = ({ revision = 1, ready = true, documents = [], occurrences = [], configurationRevision, relationships = [], unownedMentions = 0 } = {}) => ({
  project: { name: 'project', version: 1, revision, ready, warnings: [], provenance: { extractor: 'test.project', extractorVersion: '1', ...(configurationRevision ? { configurationRevision } : {}) }, occurrences,
    ids: [], relationships, unownedMentions, events: [], configuration: { categories: [], statuses: [], modules: [], features: [] } },
  physical: { name: 'physical', version: 1, revision, ready: true, warnings: [], provenance: { extractor: 'test.physical', extractorVersion: '1' }, folders: [], files: documents.map(d => ({ path: d.file, markdown: true })), documents },
});
const scopedModels = modelsOf({ documents: scopedDocuments, occurrences: scopedDocuments.map((d, i) => ({ id: 'FR-001', key: `opaque-${i}`, scope: d.file.slice(0, -8), kind: 'definition', label: 'Requirement', source: { file: d.file, start: 0, end: 6 } })) });
assert.equal(scoped.projectIndex({ ...scopedModels, project: { ...scopedModels.project, provenance: { ...scopedModels.project.provenance, configurationRevision: 'config-7' } } }).configurationRevision, 'config-7');
const scopedGraph = scoped.buildDependencyGraph(scoped.projectIndex(scopedModels));
assert.equal(scopedGraph.nodes.size, 2);
assert.equal(scopedGraph.edges.size, 0);
assert.equal(scopedGraph.nodes.get('opaque-0').definitions.length, 1);
assert.equal(scoped.keyLabel('opaque-0'), 'FR-001 · specs/one');
assert.equal(scoped.keyLabel('opaque-1'), 'FR-001 · specs/two');
// Links come from the project model: the plugin resolves each evidence range to its reference occurrence.
const linkedText = '# DD-001\nImplements REQ-001.\n';
const linkedModels = modelsOf({ documents: [{ file: 'design.md', text: linkedText }], unownedMentions: 2,
  occurrences: [{ id: 'DD-001', kind: 'definition', label: 'DD-001', source: { file: 'design.md', start: 2, end: 8 } }, { id: 'REQ-001', kind: 'reference', label: 'reference', source: { file: 'design.md', start: 20, end: 27 } }],
  relationships: [{ from: 'DD-001', to: 'REQ-001', evidence: [{ file: 'design.md', start: 20, end: 27 }] }] });
const linkedGraph = scoped.buildDependencyGraph(scoped.projectIndex(linkedModels));
assert.deepEqual([...linkedGraph.edges.values()].map(edge => [edge.from, edge.to, edge.evidence.map(item => `${item.file}:${item.line}`)]), [['DD-001', 'REQ-001', ['design.md:2']]]);
assert.equal(linkedGraph.unownedMentions, 2);
assert.equal(scoped.buildDependencyGraph(scoped.projectIndex(modelsOf({ ...linkedModels, ready: false, documents: [{ file: 'design.md', text: linkedText }] }))).edges.size, 0);
const project = await mkdtemp(path.join(tmpdir(), 'specular-sdk-'));
await cp(path.join(root, 'examples/plugins/specification-index'), project, { recursive: true });
const metadata = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
metadata.devDependencies = {};
await writeFile(path.join(project, 'package.json'), JSON.stringify(metadata));
execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', path.join(root, '.cache/plugin-sdk/specular-plugin-api-0.2.0.tgz')], { cwd: project, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: project, stdio: 'inherit' });
const sdkRoot = path.join(project, 'node_modules/@specular/plugin-api');
const { validatePackage } = await import(pathToFileURL(path.join(sdkRoot, 'bin/validate.mjs')).href);
const cli = path.join(sdkRoot, 'bin/validate.mjs');
execFileSync(process.execPath, [cli, project], { cwd: project, stdio: 'inherit' });
const manifest = await validatePackage(project);
assert.equal(manifest.id, 'example.specification-index');
const entryText = await readFile(path.join(project, manifest.entry), 'utf8');
assert.doesNotMatch(entryText, /(?:from\s+|import\s*\()['"]/);
const { render } = await import(pathToFileURL(path.join(project, manifest.entry)).href);
const occurrences = [
  { id: 'REQ-001', kind: 'definition', label: 'First', source: { file: 'requirements.md', start: 0, end: 7 } },
  { id: 'REQ-001', kind: 'reference', label: 'reference', source: { file: 'design.md', start: 8, end: 15 } },
  { id: 'REQ-001', kind: 'definition', label: 'Duplicate', source: { file: 'other.md', start: 0, end: 7 } },
];
// The specification index declares only project@1, so its requests carry no physical model.
const projectOnly = (options = {}) => ({ project: modelsOf({ revision: 4, occurrences, ...options }).project });
const request = { apiVersion: '0.2.0', requestId: 'r1', viewId: 'definitions', context: { projectId: 'project-a', revision: 4, currentFile: 'requirements.md' }, models: projectOnly() };
assert.deepEqual(manifest.models, ['project@1']);
const original = JSON.stringify(request);
const result = await render(request);
assert.equal(result.model.items.length, 2);
// Plugins that ignore additive category/module metadata still render the same source-backed output.
const enriched = occurrences.map(o => ({ ...o,
  category: { key: 'requirements', name: 'Requirements', role: 'requirement' },
  moduleAssignment: { state: 'assigned', modules: [{ key: 'gui', name: 'GUI' }], evidence: [{ kind: 'id-override', id: o.id, modules: [{ key: 'gui', name: 'GUI' }] }] },
}));
assert.deepEqual(await render({ ...request, models: projectOnly({ configurationRevision: 'config-1', occurrences: enriched }) }), result);
assert.equal(new Set(result.model.items.map(item => item.id)).size, 2);
assert.deepEqual(result.model.items[0].sources, [{ file: 'requirements.md', start: 0, end: 7, projectId: 'project-a', revision: 4 }]);
assert.equal(result.requestId, 'r1');
assert.deepEqual(JSON.parse(JSON.stringify(result)), result);
assert.equal(JSON.stringify(request), original);
assert.deepEqual((await render({ ...request, models: projectOnly({ ready: false, occurrences: [] }) })).model.items, []);
const refreshed = await render({ ...request, requestId: 'r2', context: { projectId: 'project-b', revision: 5 }, models: projectOnly({ revision: 5 }) });
assert.equal(refreshed.model.items[0].sources[0].projectId, 'project-b');
assert.equal(refreshed.model.items[0].sources[0].revision, 5);
assert.throws(() => render({ ...request, viewId: 'missing' }), /Unknown view/);
// A validator must never execute the entry, even if it is hostile or invalid JavaScript.
await writeFile(path.join(project, manifest.entry), 'throw new Error("ENTRY MUST NOT RUN");');
await validatePackage(project);
const manifestPath = path.join(project, 'specular-plugin.json');
for (const patch of [{ api: '>=9.0.0 <10.0.0' }, { entry: '../outside.js' }, { capabilities: ['workspace.read', 'process.execute'] }, { entry: 'dist/missing.js' }]) {
  await writeFile(manifestPath, JSON.stringify({ ...manifest, ...patch }));
  await assert.rejects(validatePackage(project));
}
await writeFile(manifestPath, '{bad json');
await assert.rejects(validatePackage(project));
await writeFile(manifestPath, ' '.repeat(65537));
await assert.rejects(validatePackage(project), /64 KiB/);
await writeFile(manifestPath, JSON.stringify({ ...manifest, entry: 'linked/index.js' }));
const outside = await mkdtemp(path.join(tmpdir(), 'specular-sdk-link-'));
await writeFile(path.join(outside, 'index.js'), '');
await symlink(outside, path.join(project, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
await assert.rejects(validatePackage(project), /ordinary package file/);
await writeFile(manifestPath, JSON.stringify(manifest));
await writeFile(path.join(project, 'package.json'), JSON.stringify({ type: 'commonjs' }));
await assert.rejects(validatePackage(project), /type: module/);
await writeFile(path.join(project, 'package.json'), JSON.stringify({ ...metadata, type: 'module' }));
// Leave a valid, separately built artifact for inspection.
await writeFile(path.join(project, manifest.entry), entryText);
await validatePackage(project);
console.log(`SDK independent build, evidence output, and static package rejection checks passed: ${project}`);

await writeFile(path.join(root, '.cache/plugin-sdk/example-path.txt'), project);

const customProject = await mkdtemp(path.join(tmpdir(), 'specular-custom-sdk-'));
await cp(path.join(root, 'examples/plugins/custom-definition-browser'), customProject, { recursive: true });
const customMetadata = JSON.parse(await readFile(path.join(customProject, 'package.json'), 'utf8'));
customMetadata.devDependencies = {};
await writeFile(path.join(customProject, 'package.json'), JSON.stringify(customMetadata));
execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', path.join(root, '.cache/plugin-sdk/specular-plugin-api-0.2.0.tgz')], { cwd: customProject, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: customProject, stdio: 'inherit' });
const customManifest = await validatePackage(customProject);
assert.equal(customManifest.id, 'example.custom-definition-browser');
assert.equal(customManifest.views[0].kind, 'custom');
assert.doesNotMatch(await readFile(path.join(customProject, customManifest.entry), 'utf8'), /(?:from\s+|import\s*\()['"]@specular/);
console.log(`SDK independent custom-interface build passed: ${customProject}`);
await writeFile(path.join(root, '.cache/plugin-sdk/custom-example-path.txt'), customProject);

const timelineProject = await mkdtemp(path.join(tmpdir(), 'specular-timeline-sdk-'));
await cp(path.join(root, 'examples/plugins/document-timeline'), timelineProject, { recursive: true });
const timelineMetadata = JSON.parse(await readFile(path.join(timelineProject, 'package.json'), 'utf8'));
timelineMetadata.devDependencies = {};
await writeFile(path.join(timelineProject, 'package.json'), JSON.stringify(timelineMetadata));
execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', path.join(root, '.cache/plugin-sdk/specular-plugin-api-0.2.0.tgz')], { cwd: timelineProject, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: timelineProject, stdio: 'inherit' });
const timelineManifest = await validatePackage(timelineProject);
assert.equal(timelineManifest.id, 'example.document-timeline'); assert.equal(timelineManifest.views[0].kind, 'custom');
assert.equal(timelineManifest.views[0].id, 'timeline'); assert.equal(timelineManifest.views[0].title, 'Project timeline'); assert.equal(timelineManifest.customApi, 1);
const timelineModule = await import(pathToFileURL(path.join(timelineProject, timelineManifest.entry)).href);
const { activate: activateTimeline, collectEvents, filtered, counts, days, sourceFiles, mentionedIds, statusNames, keyLabel, invalidRange, readState, EVENT_LIMIT } = timelineModule;
// Increment 25: the plugin no longer parses Markdown; events come from the project model.
assert.equal(timelineModule.documentEvents, undefined);
assert.equal(typeof activateTimeline, 'function');
assert.equal(EVENT_LIMIT, 20000);
const timelineText = ['# REQ-001 - Timeline fixture', 'Last updated: 2020-01-01', '- 2026-09-15: Later REQ-001', '- 2025-02-28: Earlier', '  Continued DD-001', '- 2025-02-30: Invalid date', '> - 2024-01-01: Quoted', '```md', '- 2024-01-01: Fenced', '```', '- Undated entry'].join('\n');
// A nested file with the same basename contributes same-day, duplicate, and conflicting accounts.
const nestedText = ['- 2025-02-28: Earlier', '- 2024-02-29: Leap day TASK-007', '- 2026-09-15: Later REQ-001', '- 2027-01-01: Later REQ-001', ''].join('\n');
// The timeline reads events and dated statuses from project@1 and line numbers from physical@1.
assert.deepEqual(timelineManifest.models, ['project@1', 'physical@1']);
// Build the model the host would send, using Specular's own event rule bundled from source (the host indexes Markdown only).
await build({ absWorkingDir: root, stdin: { contents: "export { documentEvents as coreEvents } from './src/core/dates.ts';", resolveDir: root }, outfile: path.join(timelineProject, 'core-dates.mjs'), bundle: true, platform: 'node', format: 'esm' });
const { coreEvents } = await import(pathToFileURL(path.join(timelineProject, 'core-dates.mjs')).href);
const timelineModels = (documents, extra = {}) => {
  const markdown = documents.filter(document => /\.md$/.test(document.file));
  const events = markdown.flatMap(document => coreEvents(document.file, document.text).map(event => ({ date: { value: event.date.value, text: event.date.text, source: { file: document.file, start: event.date.offset, end: event.date.end }, rule: 'event' },
    text: event.text, source: { file: document.file, start: event.offset, end: event.end }, mentionedIds: [...new Set(event.text.match(/\b(?:REQ|DD|TASK)-\d+\b/g) ?? [])] })));
  const models = modelsOf({ revision: 7, documents: markdown });
  return { project: { ...models.project, events, ...extra }, physical: models.physical };
};
const timelineInput = timelineModels([{ file: 'specs/notes.md', text: nestedText }, { file: 'notes.md', text: timelineText }, { file: 'notes.txt', text: '- 2021-01-01: Not Markdown' }]);
const collected = collectEvents(timelineInput);
assert.equal(collected.capped, false);
// Project-wide scope without a current document: ascending days, then project-relative path, then source position.
assert.deepEqual(collected.events.map(event => [event.date, event.file]), [
  ['2024-02-29', 'specs/notes.md'], ['2025-02-28', 'notes.md'], ['2025-02-28', 'specs/notes.md'],
  ['2026-09-15', 'notes.md'], ['2026-09-15', 'specs/notes.md'], ['2027-01-01', 'specs/notes.md']]);
assert.equal(collected.events[1].text, 'Earlier\nContinued DD-001');
assert.deepEqual(collected.events[1].ids, ['DD-001']);
assert.equal(collected.events[1].line, 4);
assert.equal(collected.events[1].start, timelineText.indexOf('- 2025-02-28'));
assert.equal(timelineText.slice(collected.events[1].start, collected.events[1].end), '- 2025-02-28: Earlier\n  Continued DD-001');
assert.equal(nestedText.slice(collected.events[5].start, collected.events[5].end), '- 2027-01-01: Later REQ-001');
// Duplicate text and conflicting dates stay separate source accounts rather than being merged.
assert.equal(new Set(collected.events.map(event => event.id)).size, 6);
assert.equal(collected.events.filter(event => event.text === 'Later REQ-001').length, 3);
assert.deepEqual(sourceFiles(collected.events), ['notes.md', 'specs/notes.md']);
assert.deepEqual(mentionedIds(collected.events), ['DD-001', 'REQ-001', 'TASK-007']);
assert.deepEqual(days(collected.events).map(group => [group.date, group.events.length]), [['2024-02-29', 1], ['2025-02-28', 2], ['2026-09-15', 2], ['2027-01-01', 1]]);
assert.deepEqual(collectEvents(timelineModels([])), { events: [], capped: false });
assert.equal(collectEvents(timelineModels([{ file: 'notes.md', text: `${timelineText}\n- 2024-02-28: Unsaved event` }])).events[0].text, 'Unsaved event');
assert.ok(collected.events.every(event => event.kind === 'entry'));
// Filters combine; a visible limit reports a capped collection instead of trimming it silently.
const everything = { file: '', id: '', from: '', to: '', kind: '', status: '' };
assert.equal(filtered(collected.events, everything).length, 6);
assert.equal(filtered(collected.events, { ...everything, file: 'specs/notes.md' }).length, 4);
assert.equal(filtered(collected.events, { ...everything, id: 'REQ-001' }).length, 3);
assert.equal(filtered(collected.events, { ...everything, from: '2025-02-28', to: '2025-02-28' }).length, 2);
assert.equal(filtered(collected.events, { ...everything, from: '2025-02-28' }).length, 5);
assert.equal(filtered(collected.events, { ...everything, to: '2025-02-28' }).length, 3);
assert.equal(filtered(collected.events, { ...everything, file: 'notes.md', id: 'REQ-001' }).length, 1);
assert.equal(filtered(collected.events, { ...everything, id: 'DD-999' }).length, 0);
assert.equal(invalidRange({ ...everything, from: '2026-01-01', to: '2025-01-01' }), true);
assert.equal(filtered(collected.events, { ...everything, from: '2026-01-01', to: '2025-01-01' }).length, 0);
assert.deepEqual(counts(collected.events, filtered(collected.events, { ...everything, id: 'REQ-001' })), { matching: 3, total: 6, files: 2, totalFiles: 2 });
const capped = collectEvents(timelineInput, 2);
assert.equal(capped.capped, true); assert.equal(capped.events.length, 2);
assert.deepEqual(capped.events.map(event => event.file), ['notes.md', 'notes.md']);
assert.deepEqual(readState(undefined), { filters: everything, page: 0 });
assert.deepEqual(readState('{bad json'), { filters: everything, page: 0 });
assert.deepEqual(readState(JSON.stringify({ file: 'notes.md', id: 'REQ-001', from: '2025-02-28', to: '2026-09-15', page: 2 })),
  { filters: { file: 'notes.md', id: 'REQ-001', from: '2025-02-28', to: '2026-09-15', kind: '', status: '' }, page: 2 });
assert.deepEqual(readState(JSON.stringify({ kind: 'status', status: 'Implemented' })).filters, { ...everything, kind: 'status', status: 'Implemented' });
assert.equal(readState(JSON.stringify({ kind: 'delivery' })).filters.kind, '');
// Dated statuses become status events: owning ID and label, configured name, and the matched date as evidence.
const statusText = '# REQ-001 Timeline fixture\n\nStatus: Implemented on 2026-10-13.\n';
const statusDate = { value: '2026-10-13', text: 'on 2026-10-13', source: { file: 'status.md', start: statusText.indexOf('on 2026'), end: statusText.indexOf('on 2026') + 13 }, rule: 'status-date' };
const statusInput = timelineModels([{ file: 'status.md', text: statusText }], {
  occurrences: [{ id: 'REQ-001', kind: 'definition', label: 'Timeline fixture', source: { file: 'status.md', start: 2, end: 9 } }],
  ids: [{ key: 'REQ-001', id: 'REQ-001', definitions: [{ file: 'status.md', start: 2, end: 9 }], status: { state: 'authored', occurrences: [
    { value: 'Implemented on 2026-10-13.', name: 'Implemented', source: { file: 'status.md', start: 28, end: 61 }, date: statusDate }, { value: 'Confirmed', name: 'Confirmed', source: { file: 'status.md', start: 0, end: 1 } }] } }] });
const statusEvents = collectEvents(statusInput).events;
assert.deepEqual(statusEvents.map(event => [event.kind, event.date, event.text, event.ids, event.status?.name, event.line]), [['status', '2026-10-13', 'REQ-001 · Timeline fixture', ['REQ-001'], 'Implemented', 3]]);
assert.equal(statusText.slice(statusEvents[0].start, statusEvents[0].end), 'on 2026-10-13');
const mixed = [...collected.events, ...statusEvents];
assert.equal(filtered(mixed, { ...everything, kind: 'status' }).length, 1);
assert.equal(filtered(mixed, { ...everything, kind: 'entry' }).length, 6);
assert.equal(filtered(mixed, { ...everything, status: 'Implemented' }).length, 1);
assert.equal(filtered(mixed, { ...everything, status: 'Unused' }).length, 0);
assert.deepEqual(statusNames(mixed, [{ name: 'Unused' }, { name: 'Implemented' }]), ['Unused', 'Implemented']);
assert.deepEqual(statusNames(mixed, []), ['Implemented']);
assert.equal(keyLabel('@["specs/a","FR-001"]'), 'FR-001 · specs/a');
assert.equal(keyLabel('REQ-001'), 'REQ-001');
// Increment 80: events from typed date rules keep their kind, label, and site.
const fieldText = '# Feature Specification: Example\n\n**Created**: 2025-12-12\n**Last Updated**: 2026-06-05\n\n## [1.0.0] - 2026-01-02\n';
const at = (needle) => fieldText.indexOf(needle);
const ruleEvent = (needle, date, extra) => ({ date: { value: date, text: date, source: { file: 'spec.md', start: at(date), end: at(date) + 10 }, rule: 'event' },
  source: { file: 'spec.md', start: at(needle), end: at(needle) + needle.length }, mentionedIds: [], ...extra });
const typed = collectEvents({ project: { ...timelineModels([{ file: 'spec.md', text: fieldText }]).project, events: [
  ruleEvent('**Created**: 2025-12-12', '2025-12-12', { text: 'Feature Specification: Example', site: 'field', kind: 'milestone', label: 'Created' }),
  ruleEvent('**Last Updated**: 2026-06-05', '2026-06-05', { text: 'Feature Specification: Example', site: 'field', kind: 'snapshot', label: 'Last Updated' }),
  ruleEvent('## [1.0.0] - 2026-01-02', '2026-01-02', { text: '[1.0.0] - 2026-01-02', site: 'heading', kind: 'milestone', label: '[1.0.0]' })] }, physical: timelineModels([{ file: 'spec.md', text: fieldText }]).physical }).events;
assert.deepEqual(typed.map(event => [event.date, event.kind, event.site, event.label, event.line]), [
  ['2025-12-12', 'milestone', 'field', 'Created', 3], ['2026-01-02', 'milestone', 'heading', '[1.0.0]', 6], ['2026-06-05', 'snapshot', 'field', 'Last Updated', 4]]);
assert.equal(filtered(typed, { ...everything, kind: 'milestone' }).length, 2);
assert.equal(filtered(typed, { ...everything, kind: 'snapshot' }).length, 1);
assert.deepEqual(timelineModule.KIND_LABELS, { entry: 'Recorded entries', status: 'Statuses', milestone: 'Milestones', snapshot: 'Last updated' });
assert.equal(readState(JSON.stringify({ kind: 'milestone' })).filters.kind, 'milestone');
assert.ok(collected.events.every(event => event.kind === 'entry' && event.label === undefined));
assert.deepEqual(readState(JSON.stringify({ file: 7, from: '2025-02-30', to: 'later', page: -1 })), { filters: everything, page: 0 });
// Increment 75 histogram: bucket thresholds and bounds, then whole-range stacking by file.
const { histogram, bucketUnit, bucketStart, bucketEnd, addDays, todayBucket, localToday, SERIES } = timelineModule;
assert.equal(SERIES, 5);
assert.equal(bucketUnit('2026-01-01', '2026-04-02'), 'day');
assert.equal(bucketUnit('2026-01-01', '2026-04-03'), 'week');
assert.equal(bucketUnit('2024-01-01', addDays('2024-01-01', 103 * 7 + 6)), 'week');
assert.equal(bucketUnit('2024-01-01', addDays('2024-01-01', 104 * 7)), 'month');
assert.equal(bucketStart('2026-01-01', 'week'), '2025-12-29');
assert.equal(bucketStart('2026-01-04', 'week'), '2025-12-29');
assert.equal(bucketStart('2026-01-05', 'week'), '2026-01-05');
assert.equal(bucketEnd('2025-12-29', 'week'), '2026-01-04');
assert.equal(bucketEnd('2024-02-01', 'month'), '2024-02-29');
assert.equal(bucketEnd('2026-12-01', 'month'), '2026-12-31');
assert.equal(bucketStart('2024-02-29', 'month'), '2024-02-01');
const chart = histogram(collected.events, filtered(collected.events, { ...everything, id: 'REQ-001' }));
assert.equal(chart.unit, 'month');
assert.equal(chart.buckets.length, 36);
assert.equal(chart.buckets[0].start, '2024-02-01'); assert.equal(chart.buckets.at(-1).end, '2027-01-31');
assert.deepEqual(chart.series, [{ file: 'specs/notes.md', count: 4 }, { file: 'notes.md', count: 2 }]);
assert.deepEqual(chart.other, { files: 0, count: 0 });
assert.equal(chart.buckets.reduce((sum, bucket) => sum + bucket.total, 0), 6);
assert.equal(chart.buckets.filter(bucket => bucket.total).length, 4);
for (const bucket of chart.buckets) {
  assert.equal(bucket.segments.reduce((sum, segment) => sum + segment.total, 0), bucket.total);
  assert.equal(bucket.segments.reduce((sum, segment) => sum + segment.matching, 0), bucket.matching);
}
const february = chart.buckets.find(bucket => bucket.start === '2025-02-01');
assert.equal(february.end, '2025-02-28'); assert.deepEqual(february.segments, [{ total: 1, matching: 0 }, { total: 1, matching: 0 }]);
assert.equal(chart.buckets.find(bucket => bucket.start === '2026-09-01').matching, 2);
assert.equal(chart.buckets.reduce((sum, bucket) => sum + bucket.matching, 0), 3);
const limited = histogram(collected.events, collected.events, 1);
assert.deepEqual(limited.series, [{ file: 'specs/notes.md', count: 4 }]);
assert.deepEqual(limited.other, { files: 1, count: 2 });
assert.ok(limited.buckets.every(bucket => bucket.segments.length === 2));
const tied = collectEvents(timelineModels([{ file: 'b.md', text: '- 2026-01-02: B\n' }, { file: 'a.md', text: '- 2026-01-01: A\n' }])).events;
assert.deepEqual(histogram(tied, tied).series.map(item => item.file), ['a.md', 'b.md']);
assert.deepEqual(histogram([], []).buckets, []);
const single = histogram(collectEvents(timelineModels([{ file: 'one.md', text: '- 2024-02-29: Leap\n' }])).events, []);
assert.equal(single.unit, 'day'); assert.equal(single.buckets.length, 1); assert.equal(single.buckets[0].matching, 0);
assert.equal(chart.buckets[todayBucket(chart, '2026-10-13')].start, '2026-10-01');
assert.equal(todayBucket(chart, '2030-01-01'), -1);
assert.equal(localToday(new Date(2026, 9, 3)), '2026-10-03');
assert.doesNotMatch(await readFile(path.join(timelineProject, timelineManifest.entry), 'utf8'), /(?:from\s+|import\s*\()['"]@specular/);
console.log(`SDK independent project-timeline build passed: ${timelineProject}`);
await writeFile(path.join(root, '.cache/plugin-sdk/timeline-example-path.txt'), timelineProject);

const headingsProject = await mkdtemp(path.join(tmpdir(), 'specular-headings-sdk-'));
await cp(path.join(root, 'examples/plugins/document-headings'), headingsProject, { recursive: true });
const headingsMetadata = JSON.parse(await readFile(path.join(headingsProject, 'package.json'), 'utf8'));
headingsMetadata.devDependencies = {};
await writeFile(path.join(headingsProject, 'package.json'), JSON.stringify(headingsMetadata));
execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', path.join(root, '.cache/plugin-sdk/specular-plugin-api-0.2.0.tgz')], { cwd: headingsProject, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: headingsProject, stdio: 'inherit' });
const headingsManifest = await validatePackage(headingsProject);
assert.equal(headingsManifest.id, 'example.document-headings');
const { render: renderHeadings } = await import(pathToFileURL(path.join(headingsProject, headingsManifest.entry)).href);
assert.deepEqual(headingsManifest.models, ['physical@1']);
const headings = renderHeadings({ apiVersion: '0.2.0', requestId: 'headings', viewId: 'headings', context: { projectId: 'headings-project', revision: 2, currentFile: 'notes.md' }, models: { physical: modelsOf({ revision: 2, documents: [{ file: 'notes.md', text: '# First\n## Second\n' }] }).physical } });
assert.deepEqual(headings.model.items.map(item => item.title), ['First', 'Second']);
assert.doesNotMatch(await readFile(path.join(headingsProject, headingsManifest.entry), 'utf8'), /(?:from\s+|import\s*\()['"]@specular/);
console.log(`SDK independent document-headings build passed: ${headingsProject}`);
await writeFile(path.join(root, '.cache/plugin-sdk/headings-example-path.txt'), headingsProject);

const templateProject = await mkdtemp(path.join(tmpdir(), 'specular-template-sdk-'));
await cp(path.join(root, 'examples/plugins/plugin-template'), templateProject, { recursive: true });
const templateMetadata = JSON.parse(await readFile(path.join(templateProject, 'package.json'), 'utf8'));
templateMetadata.devDependencies = {};
await writeFile(path.join(templateProject, 'package.json'), JSON.stringify(templateMetadata));
execFileSync(process.execPath, [process.env.npm_execpath, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--save-dev', path.join(root, '.cache/plugin-sdk/specular-plugin-api-0.2.0.tgz')], { cwd: templateProject, stdio: 'inherit' });
execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], { cwd: templateProject, stdio: 'inherit' });
const templateManifest = await validatePackage(templateProject);
assert.equal(templateManifest.id, 'example.rename-this-plugin');
assert.doesNotMatch(await readFile(path.join(templateProject, templateManifest.entry), 'utf8'), /(?:from\s+|import\s*\()['"]@specular/);
console.log(`SDK independent plugin template build passed: ${templateProject}`);
await writeFile(path.join(root, '.cache/plugin-sdk/template-example-path.txt'), templateProject);
