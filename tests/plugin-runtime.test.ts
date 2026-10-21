import assert from 'node:assert/strict';
import test from 'node:test';
import { appearance } from '../src/shared/appearance';
import { forPlugin, parseRequest, parseResult, validSource, INPUT_LIMIT, OUTPUT_LIMIT, type PluginManifest } from '../src/shared/plugin-runtime';
import { hostRequest, withPhysical, withProject } from './helpers/plugin-request';
const manifest: PluginManifest = { manifestVersion: 1, id: 'test.plugin', version: '0.1.0', api: '0.2.0', entry: 'index.js', capabilities: ['workspace.read', 'source.navigate'], models: ['project@1', 'physical@1'], views: [{ id: 'list', title: 'List', kind: 'list' }] };
const request = hostRequest();
const source = { projectId: 'opaque', revision: 1, file: 'file.md', start: 0, end: 7 };
const response = { apiVersion: '0.2.0', requestId: 'request', viewId: 'list', projectId: 'opaque', revision: 1, model: { kind: 'list', items: [{ id: 'a', title: 'A', sources: [source] }] } };
const parse = (value: unknown, target = manifest) => parseRequest(JSON.stringify(value), target);

test('appearance is optional, validated, and projected to the trusted palette', () => {
  assert.equal(parse(request).appearance, undefined);
  for (const mode of ['dark', 'light'] as const) {
    assert.deepEqual(parse({ ...request, appearance: appearance(mode) }).appearance, appearance(mode));
  }
  for (const bad of [null, 'light', { mode: 'system', colors: appearance('dark').colors },
    { ...appearance('light'), colors: { ...appearance('light').colors, text: 'url(https://invalid)' } },
    { ...appearance('light'), colors: { ...appearance('light').colors, extra: '#ffffff' } }, { mode: 'light', colors: {} }]) {
    assert.throws(() => parse({ ...request, appearance: bad }), /appearance/);
  }
  assert.equal(parse({ ...request, appearance: { ...appearance('light'), colors: { ...appearance('light').colors, text: '#000000' } } }).appearance?.colors.text, appearance('light').colors.text);
});
test('broker strips extra request fields and rejects oversized or out-of-scope models', () => {
  assert.deepEqual(parse({ ...request, secret: 'not exported' }), request);
  for (const bad of [{ ...request, context: { ...request.context, currentFile: 'missing.md' } }, withPhysical(request, { documents: [{ file: '../secret', text: '' }] }),
    withProject(request, { ready: false, occurrences: [{}] }), withPhysical(request, { root: 'private' }), withProject(request, { root: 'private' }), { ...request, context: { ...request.context, root: 'private' } }]) {
    assert.throws(() => parse(bad));
  }
  for (const bad of ['x'.repeat(INPUT_LIMIT + 1), '{}']) assert.throws(() => parseRequest(bad, manifest));
});
test('model envelopes are named, versioned, bound to the request revision, and carry provenance', () => {
  assert.equal(parse(request).models.project?.provenance.extractor, 'specular.project');
  assert.equal(parse(withProject(request, { provenance: { extractor: 'specular.project', extractorVersion: '1', configurationRevision: 'config-1' } })).models.project?.provenance.configurationRevision, 'config-1');
  for (const patch of [{ name: 'physical' }, { version: 2 }, { revision: 2 }, { ready: 'yes' }, { warnings: [7] }, { provenance: { extractor: '', extractorVersion: '1' } },
    { provenance: { extractor: 'x', extractorVersion: '1', secret: true } }, { provenance: { extractor: 'x', extractorVersion: '1', configurationRevision: '' } }]) {
    assert.throws(() => parse(withProject(request, patch)), /project model/, JSON.stringify(patch));
  }
  assert.throws(() => parse({ ...request, models: { project: request.models.project } }), /physical model/);
  assert.throws(() => parse({ ...request, models: { ...request.models, history: {} } }), /models/);
  assert.throws(() => parse(withPhysical(request, { ready: false })), /physical model/);
});
test('the physical model accepts project-relative folders and files only', () => {
  const parsed = parse(withPhysical(request, { folders: ['specs', 'specs/one'], files: [{ path: 'file.md', markdown: true }, { path: 'src/a.ts', markdown: false }] }));
  assert.deepEqual(parsed.models.physical?.folders, ['specs', 'specs/one']);
  assert.deepEqual(parsed.models.physical?.files.map(file => file.markdown), [true, false]);
  for (const patch of [{ folders: ['../outside'] }, { folders: ['C:/abs'] }, { folders: ['a', 'a'] }, { files: [{ path: 'a\\b.md', markdown: true }] },
    { files: [{ path: 'a.md', markdown: true }, { path: 'a.md', markdown: true }] }, { files: [{ path: 'a.md' }] }]) {
    assert.throws(() => parse(withPhysical(request, patch)), /physical model/, JSON.stringify(patch));
  }
});
test('plugins receive only the models their manifest declares', () => {
  const both = parse(request);
  assert.deepEqual(Object.keys(forPlugin(both, { ...manifest, models: ['project@1'] }).models), ['project']);
  assert.deepEqual(Object.keys(forPlugin(both, { ...manifest, models: ['physical@1'] }).models), ['physical']);
  assert.deepEqual(Object.keys(forPlugin(both, manifest).models).sort(), ['physical', 'project']);
  assert.deepEqual(forPlugin(both, { ...manifest, models: ['physical@1'] }).context, both.context);
});
test('source validation binds project, revision, path and UTF-16 bounds', () => {
  assert.equal(validSource(source, request), true);
  for (const patch of [{ projectId: 'other' }, { revision: 0 }, { start: -1 }, { end: 8 }, { start: 8 }, { file: '../secret' }, { start: 0.5 }, { extra: 'no' }]) assert.equal(validSource({ ...source, ...patch }, request), false);
});
test('output broker rejects stale correlations, duplicate IDs, undeclared capabilities and oversized data', () => {
  assert.deepEqual(parseResult(JSON.stringify(response), request, manifest), response);
  for (const patch of [{ requestId: 'old' }, { revision: 0 }, { projectId: 'other' }, { viewId: 'other' }, { apiVersion: '1.0.0' }, { extra: true }, { model: { kind: 'list', items: [response.model.items[0], response.model.items[0]] } }, { model: { kind: 'list', items: [{ ...response.model.items[0], html: '<script>' }] } }]) assert.throws(() => parseResult(JSON.stringify({ ...response, ...patch }), request, manifest));
  assert.throws(() => parseResult('x'.repeat(OUTPUT_LIMIT + 1), request, manifest));
  assert.throws(() => parseResult(JSON.stringify(response), request, { ...manifest, capabilities: ['workspace.read'] }));
});
test('graph validation rejects dangling edges and accepts complete graphs', () => {
  const graphManifest = { ...manifest, views: [{ id: 'list', title: 'Graph', kind: 'graph' as const }] };
  const graph = { ...response, model: { kind: 'graph', nodes: [{ id: 'a', label: 'A' }], edges: [{ id: 'loop', from: 'a', to: 'a' }] } };
  assert.deepEqual(parseResult(JSON.stringify(graph), request, graphManifest), graph);
  assert.throws(() => parseResult(JSON.stringify({ ...graph, model: { ...graph.model, edges: [{ id: 'bad', from: 'a', to: 'missing' }] } }), request, graphManifest));
});

test('custom API state is bounded, declared, and has no source-navigation authority', () => {
  const custom = { ...manifest, customApi: 1 as const, views: [{ id: 'list', title: 'Custom', kind: 'custom' as const }] };
  const state = JSON.stringify({ arbitrary: 'plugin-owned state', source: { ...source, revision: 0 } });
  assert.equal(parse({ ...request, customState: state }, custom).customState, state);
  for (const customState of [false, {}, 'x'.repeat(65537)]) assert.throws(() => parse({ ...request, customState }, custom));
  assert.throws(() => parse({ ...request, customState: state }));
  assert.equal(validSource(JSON.parse(state).source, request), false);
});
test('timeline validation requires real day-level dates and source-backed events', () => {
  const timelineManifest: PluginManifest = { ...manifest, views: [{ id: 'timeline', title: 'Timeline', kind: 'timeline' }] };
  const timelineRequest = { ...request, viewId: 'timeline' };
  const result = (date: string, sources = [source]) => JSON.stringify({ apiVersion: '0.2.0', requestId: timelineRequest.requestId, viewId: 'timeline', projectId: 'opaque', revision: 1, model: { kind: 'timeline', items: [{ id: 'event', date, text: 'Recorded entry', sources }] } });
  assert.equal(parseResult(result('2026-02-28'), timelineRequest, timelineManifest).model.kind, 'timeline');
  for (const bad of ['2026-02-30', '2026-2-28', '2026-02-28T00:00:00Z']) assert.throws(() => parseResult(result(bad), timelineRequest, timelineManifest));
  assert.throws(() => parseResult(result('2026-02-28', []), timelineRequest, timelineManifest));
});
test('custom views accept requests but never host-rendered results', () => {
  const customManifest = { ...manifest, views: [{ id: 'list', title: 'Custom', kind: 'custom' as const }] };
  assert.deepEqual(parse(request, customManifest), request);
  assert.throws(() => parseResult(JSON.stringify(response), request, customManifest), /Custom views/);
});

test('optional category metadata survives projection and rejects invalid values', () => {
  const category = { key: 'needs', name: 'Business needs', role: 'requirement' as const };
  const occurrence = { id: 'REF-001', kind: 'definition' as const, label: 'First', source: { file: 'file.md', start: 0, end: 7 }, category };
  const input = hostRequest({ occurrences: [occurrence], configurationRevision: 'config-1' });
  assert.deepEqual(parse(input), input);
  for (const bad of [null, {}, { ...category, key: '../bad' }, { ...category, name: '' }, { ...category, role: 'custom' }, { ...category, pattern: 'secret' }]) {
    assert.throws(() => parse(withProject(input, { occurrences: [{ ...occurrence, category: bad }] })), /occurrence/);
  }
});

test('optional module membership projects source/configuration evidence and rejects invalid metadata', () => {
  const module = { key: 'gui', name: 'GUI' }, range = { file: 'file.md', start: 0, end: 7 };
  const assignment = { state: 'assigned', modules: [module], evidence: [{ kind: 'file-rule', rule: 'gui-files', path: 'file.md', scope: 'file', source: range, modules: [module] }] };
  const occurrence = { id: 'REQ-001', kind: 'definition', label: 'First', source: range, moduleAssignment: assignment };
  const input = (value: unknown) => withProject(request, { occurrences: [{ ...occurrence, moduleAssignment: value }] });
  assert.deepEqual(parse(input(assignment)), input(assignment));
  const unassigned = { state: 'unassigned', modules: [], evidence: [{ kind: 'id-override', id: 'REQ-001', modules: [] }] };
  assert.deepEqual(parse(input(unassigned)), input(unassigned));
  for (const bad of [null, { ...assignment, state: 'guessed' }, { ...assignment, modules: [] }, { ...assignment, evidence: [] },
    { ...assignment, modules: [{ key: '../bad', name: 'Bad' }] }, { ...assignment, evidence: [{ ...assignment.evidence[0], path: '../outside' }] },
    { ...assignment, evidence: [{ ...assignment.evidence[0], source: { ...range, file: 'outside.md' } }] }, { ...assignment, secret: true }]) assert.throws(() => parse(input(bad)), /occurrence/);
  assert.equal(parse(request).models.project?.occurrences.length, 0);
});

test('ID elements and configured lists are validated and projected without extra fields', () => {
  const element = { key: 'REQ-001', id: 'REQ-001', category: { key: 'REQ', name: 'Requirements', role: 'requirement' as const }, definitions: [{ file: 'file.md', start: 0, end: 7 }],
    features: { state: 'assigned' as const, features: [{ key: 'timeline', name: 'Timeline' }], evidence: [{ kind: 'id-override' as const, id: 'REQ-001', features: [{ key: 'timeline', name: 'Timeline' }] }] },
    status: { state: 'authored' as const, occurrences: [{ value: 'Implemented on 2026-10-13', name: 'Implemented', site: 'paragraphs' as const, source: { file: 'file.md', start: 0, end: 7 } }] } };
  const configuration = { categories: [{ key: 'REQ', name: 'Requirements', role: 'requirement' as const, colors: { light: '#123456' } }], statuses: [{ name: 'Implemented', colors: { dark: '#88dd99' } }, { name: 'Unused' }],
    modules: [{ key: 'gui', name: 'GUI' }], features: [{ key: 'timeline', name: 'Timeline' }] };
  const input = hostRequest({ ids: [element], configuration });
  assert.deepEqual(parse(input), input);
  const scoped = { ...element, key: '@["specs/a",\"REQ-001\"]', scope: 'specs/a', definitions: [] };
  assert.deepEqual(parse(hostRequest({ ids: [scoped] })).models.project?.ids[0].scope, 'specs/a');
  for (const bad of [{ ...element, key: 'REQ-002' }, { ...element, extra: true }, { ...element, definitions: [{ file: 'missing.md', start: 0, end: 1 }] },
    { ...element, status: { state: 'guessed', occurrences: element.status.occurrences } }, { ...element, status: { state: 'authored', occurrences: [] } },
    { ...element, status: { state: 'authored', occurrences: [{ ...element.status.occurrences[0], site: 'prose' }] } },
    { ...element, status: { state: 'authored', occurrences: [{ ...element.status.occurrences[0], source: { file: 'file.md', start: 0, end: 99 } }] } },
    { ...element, features: { ...element.features, modules: [] } }, { ...element, features: { ...element.features, explicit: true } },
    { ...element, key: '@["specs/a","REQ-001"]', scope: 'specs/a' }]) {
    assert.throws(() => parse(hostRequest({ ids: [bad as never] })), /ID element/, JSON.stringify(bad));
  }
  assert.throws(() => parse(hostRequest({ ids: [element, element] })), /ID element/);
  assert.throws(() => parse(withProject(hostRequest({ ids: [element] }), { ready: false, occurrences: [] })), /project model/);
  for (const bad of [{ ...configuration, rules: [] }, { ...configuration, statuses: [{ name: 'Implemented', rules: [{ mode: 'regex', value: '.*' }] }] },
    { ...configuration, statuses: [{ name: 'X', colors: { light: 'red' } }] }, { ...configuration, categories: [{ key: '../bad', name: 'Bad' }] },
    { ...configuration, categories: [configuration.categories[0], configuration.categories[0]] }, { ...configuration, modules: [{ key: 'gui', name: '' }] }, { categories: [], statuses: [], modules: [] }]) {
    assert.throws(() => parse(hostRequest({ configuration: bad as never })), /project configuration/, JSON.stringify(bad));
  }
});

test('relationships join known ID elements with real evidence, once per pair', () => {
  const ids = [{ key: 'REQ-001', id: 'REQ-001', definitions: [{ file: 'file.md', start: 0, end: 7 }] }, { key: 'DD-001', id: 'DD-001', definitions: [] }];
  const link = { from: 'REQ-001', to: 'DD-001', evidence: [{ file: 'file.md', start: 0, end: 7 }] };
  const input = hostRequest({ ids, relationships: [link], unownedMentions: 3 });
  assert.deepEqual(parse(input), input);
  for (const bad of [{ ...link, to: 'DD-999' }, { ...link, from: 'X-1' }, { ...link, evidence: [] }, { ...link, evidence: [{ file: 'file.md', start: 0, end: 99 }] },
    { ...link, evidence: [{ file: 'other.md', start: 0, end: 1 }] }, { ...link, kind: 'implements' }]) {
    assert.throws(() => parse(hostRequest({ ids, relationships: [bad as never] })), /relationship/, JSON.stringify(bad));
  }
  assert.throws(() => parse(hostRequest({ ids, relationships: [link, link] })), /relationship/);
  for (const unownedMentions of [-1, 1.5, '3']) assert.throws(() => parse(hostRequest({ ids, unownedMentions: unownedMentions as never })), /project model/);
  assert.throws(() => parse(withProject(input, { ready: false, occurrences: [], ids: [], relationships: [link] })), /project model/);
  assert.throws(() => parse(withProject(hostRequest(), { ready: false, unownedMentions: 2 })), /project model/);
});

test('dates are real days inside physical text, and events only reference known IDs', () => {
  const documents = [{ file: 'file.md', text: '- 2026-10-14: Follow-up REQ-001\n' }];
  const ids = [{ key: 'REQ-001', id: 'REQ-001', definitions: [] }];
  const date = { value: '2026-10-14', text: '2026-10-14', source: { file: 'file.md', start: 2, end: 12 }, rule: 'event' as const };
  const event = { date, text: 'Follow-up REQ-001', source: { file: 'file.md', start: 0, end: 31 }, mentionedIds: ['REQ-001'], owner: 'REQ-001' };
  const input = hostRequest({ documents, ids, events: [event] });
  assert.deepEqual(parse(input), input);
  for (const bad of [{ ...event, date: { ...date, value: '2026-02-30' } }, { ...event, date: { ...date, value: '2026-10-14T00:00' } }, { ...event, date: { ...date, rule: 'status-date' } },
    { ...event, date: { ...date, source: { file: 'file.md', start: 2, end: 99 } } }, { ...event, source: { file: 'file.md', start: 5, end: 31 } },
    { ...event, mentionedIds: ['REQ-404'] }, { ...event, mentionedIds: ['REQ-001', 'REQ-001'] }, { ...event, owner: 'DD-404' }, { ...event, text: 7 }, { ...event, kind: 'delivery' }]) {
    assert.throws(() => parse(hostRequest({ documents, ids, events: [bad as never] })), /project event/, JSON.stringify(bad));
  }
  assert.throws(() => parse(withProject(input, { ready: false, occurrences: [], ids: [], events: [event] })), /project model/);
  const status = { value: 'Implemented on 2026-10-14', name: 'Implemented', source: { file: 'file.md', start: 0, end: 31 }, date: { ...date, rule: 'status-date' as const } };
  const dated = { key: 'REQ-001', id: 'REQ-001', definitions: [], status: { state: 'authored' as const, occurrences: [status] } };
  assert.deepEqual(parse(hostRequest({ documents, ids: [dated] })).models.project?.ids[0].status?.occurrences[0].date?.value, '2026-10-14');
  for (const bad of [{ ...status.date, rule: 'event' }, { ...status.date, value: '14/10/2026' }, { ...status.date, text: '' }]) {
    assert.throws(() => parse(hostRequest({ documents, ids: [{ ...dated, status: { state: 'authored', occurrences: [{ ...status, date: bad }] } } as never] })), /ID element/, JSON.stringify(bad));
  }
});

test('events may carry a site, kind, and label from typed date rules', () => {
  const documents = [{ file: 'file.md', text: '**Created**: 2026-10-14\n' }];
  const date = { value: '2026-10-14', text: '2026-10-14', source: { file: 'file.md', start: 13, end: 23 }, rule: 'event' as const };
  const event = { date, text: 'file.md', source: { file: 'file.md', start: 0, end: 23 }, mentionedIds: [], site: 'field' as const, kind: 'milestone' as const, label: 'Created' };
  const input = hostRequest({ documents, events: [event] });
  assert.deepEqual(parse(input), input);
  for (const bad of [{ ...event, site: 'prose' }, { ...event, kind: 'release' }, { ...event, label: '' }, { ...event, label: 'two\nlines' }, { ...event, label: 'x'.repeat(513) }]) {
    assert.throws(() => parse(hostRequest({ documents, events: [bad as never] })), /project event/, JSON.stringify(bad).slice(0, 80));
  }
});
