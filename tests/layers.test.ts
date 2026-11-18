import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveLayers, layersWithout, validateLayers } from '../src/core/layers';
import { validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { indexProject } from '../src/core/project-index';
import { layerNames, relationshipsFor, relatedThroughNeighbours, supportsRelationships } from '../src/core/relationships';
import { modelsFor } from '../src/renderer/plugin-models';
import { parseRequest, type PluginManifest } from '../src/shared/plugin-runtime';
import { API_VERSION } from '../packages/plugin-api/src/index';
import type { WorkspaceViewSnapshot } from '../src/renderer/abstraction-views';

const BASE: IdConfiguration = validateIdConfiguration({ version: 1, categories: [
  { key: 'story', name: 'User story', role: 'requirement' }, { key: 'sc', name: 'Success criterion' },
  { key: 'task', name: 'Task', role: 'task' }, { key: 'test', name: 'Test' },
], rules: [{ key: 'story', category: 'story', prefix: 'US' }, { key: 'sc', category: 'sc', prefix: 'SC' }, { key: 'task', category: 'task', prefix: 'T' }, { key: 'test', category: 'test', prefix: 'ZS' }] });
const LAYERS = [{ name: 'Needs', categories: ['story', 'sc'] }, { name: 'Work', categories: ['task'] }, { name: 'Tests', categories: ['test'] }];
const FILES = { 'specs.md': '# US-1 Sign in\nMeasured by SC-1.\n\n# SC-1 Sign-in time\n\n# T-1 Build the form\nFor US-1, tested by ZS-1.\n\n# ZS-1 Form test\n' };

test('layers are validated against the categories and default to the roles', () => {
  assert.deepEqual(effectiveLayers(BASE), [{ name: 'Requirements', categories: ['story'] }, { name: 'Implementation tasks', categories: ['task'] }]);
  const configured = validateIdConfiguration({ ...BASE, layers: LAYERS });
  assert.deepEqual(configured.layers, LAYERS);
  assert.deepEqual(effectiveLayers(configured), LAYERS);
  const keys = BASE.categories.map(category => category.key);
  for (const [bad, message] of [
    [[], /1-8/], [Array.from({ length: 9 }, (_, i) => ({ name: `L${i}`, categories: [keys[i % 4]] })), /1-8/],
    [[{ name: '', categories: ['story'] }], /name/], [[{ name: 'A', categories: [] }], /at least one/],
    [[{ name: 'A', categories: ['missing'] }], /not configured/], [[{ name: 'A', categories: ['story'] }, { name: 'a', categories: ['task'] }], /unique/],
    [[{ name: 'A', categories: ['story'] }, { name: 'B', categories: ['story'] }], /only one layer/], [[{ name: 'A', categories: ['story', 'story'] }], /twice/],
    [[{ name: 'A', categories: ['story'], colour: 'red' }], /only a name/],
  ] as const) assert.throws(() => validateLayers(bad, keys), message, JSON.stringify(bad));
  assert.deepEqual(layersWithout(LAYERS, ['test']), LAYERS.slice(0, 2));
  assert.deepEqual(layersWithout(LAYERS, ['story']), [{ name: 'Needs', categories: ['sc'] }, ...LAYERS.slice(1)]);
  assert.equal(layersWithout([{ name: 'Only', categories: ['story'] }], ['story']), undefined);
});

test('configured layers bring categories without a role into the connections, in layer order with their names', () => {
  const byRoles = indexProject(FILES, BASE), configured = indexProject(FILES, validateIdConfiguration({ ...BASE, layers: LAYERS }));
  assert.equal(supportsRelationships('ZS-1', byRoles), false);
  assert.deepEqual(relationshipsFor(byRoles, 'T-1').groups.map(group => group.id), ['US-1']);
  assert.deepEqual(layerNames(configured), ['Needs', 'Work', 'Tests']);
  assert.equal(supportsRelationships('ZS-1', configured), true);
  assert.deepEqual(relationshipsFor(configured, 'T-1').groups.map(group => group.id), ['US-1', 'ZS-1']);
  assert.deepEqual(relationshipsFor(configured, 'US-1').groups.map(group => group.id), ['SC-1', 'T-1']);
  // From ZS-1 (Tests) through T-1 (Work) to US-1 (Needs), the layer beyond it in the same direction.
  assert.deepEqual(relatedThroughNeighbours(configured, 'ZS-1', relationshipsFor(configured, 'ZS-1').groups).map(group => [group.anchor, group.id]), [['T-1', 'US-1']]);
  // A category left out of the configured layers takes no part, even with a role.
  const withoutTasks = indexProject(FILES, validateIdConfiguration({ ...BASE, layers: [LAYERS[0], LAYERS[2]] }));
  assert.equal(supportsRelationships('T-1', withoutTasks), false);
});

test('the project model carries the effective layers, and the broker checks them', () => {
  const manifest = { manifestVersion: 1, id: 'test.layers', version: '1.0.0', api: API_VERSION, entry: 'index.js', capabilities: ['workspace.read'], models: ['project@1', 'physical@1'], views: [{ id: 'list', title: 'List', kind: 'list' }] } as PluginManifest;
  const snapshot = (configuration: IdConfiguration) => ({ projectId: 'p', revision: 1, ready: true, configuration, notice: '', documents: FILES, folders: [], files: [{ path: 'specs.md', markdown: true }],
    index: indexProject(FILES, configuration), warnings: [] }) as unknown as WorkspaceViewSnapshot;
  const request = (project: unknown, models: ReturnType<typeof modelsFor>) => JSON.stringify({ apiVersion: API_VERSION, requestId: 'r', viewId: 'list', context: { projectId: 'o', revision: 1 }, models: { ...models, project } });
  const byRoles = modelsFor(snapshot(BASE));
  assert.deepEqual(byRoles.project.configuration.layers, effectiveLayers(BASE));
  const models = modelsFor(snapshot(validateIdConfiguration({ ...BASE, layers: LAYERS })));
  assert.deepEqual(parseRequest(request(models.project, models), manifest).models.project!.configuration.layers, LAYERS);
  const withLayers = (layers: unknown) => ({ ...models.project, configuration: { ...models.project.configuration, layers } });
  for (const bad of [[{ name: 'X', categories: ['missing'] }], [{ name: 'X', categories: ['story'] }, { name: 'Y', categories: ['story'] }], [{ name: '', categories: ['story'] }], 'Needs'])
    assert.throws(() => parseRequest(request(withLayers(bad), models), manifest), /Invalid project configuration/, JSON.stringify(bad));
  // An older host omits the field; the model is still valid.
  const { layers: _omitted, ...older } = models.project.configuration;
  assert.equal(parseRequest(request({ ...models.project, configuration: older }, models), manifest).models.project!.configuration.layers, undefined);
});
