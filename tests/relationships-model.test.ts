import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, LEGACY_ID_CONFIGURATION, type IdConfiguration } from '../src/core/id-configuration';
import { assignModules } from '../src/core/modules';
import { buildDependencyGraph as coreGraph } from '../src/core/dependencies';
import { relationshipsFor as coreRelationships } from '../src/core/relationships';
import { modelsFor } from '../src/renderer/plugin-models';
import { API_VERSION } from '../packages/plugin-api/src/index';
import { parseRequest, type PluginManifest } from '../src/shared/plugin-runtime';
import { projectIndex } from '../bundled-plugins/relationships/src/model';
import { buildDependencyGraph as pluginGraph } from '../bundled-plugins/relationships/src/dependencies';
import { relationshipsFor as pluginRelationships } from '../bundled-plugins/relationships/src/relationships';

const manifest: PluginManifest = { manifestVersion: 1, id: 'specular.relationships', version: '2.0.0', api: API_VERSION, entry: 'dist/index.js', capabilities: ['workspace.read', 'source.navigate'], models: ['project@1', 'physical@1'], views: [{ id: 'overview', title: 'Overview', kind: 'custom' }] };
const position = (o: { file: string; offset: number; end: number }) => `${o.file}:${o.offset}:${o.end}`;

/** Specular's own graph and the plugin's graph built from the broker-validated project model must agree exactly. */
function assertSameRelationships(documents: Record<string, string>, configuration: IdConfiguration) {
  const index = assignModules(buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, compileIdMatcher(configuration)))), configuration);
  const models = modelsFor({ projectId: 'internal', revision: 1, ready: true, notice: '', documents, configuration, folders: [], files: [], index, warnings: [] });
  const parsed = parseRequest(JSON.stringify({ apiVersion: API_VERSION, requestId: 'r', viewId: 'overview', context: { projectId: 'opaque', revision: 1 }, models }), manifest);
  const local = projectIndex(parsed.models);
  const core = coreGraph(index), plugin = pluginGraph(local);
  const edges = (graph: { edges: Map<string, { key: string; from: string; to: string; evidence: { file: string; offset: number; end: number }[] }> }) =>
    [...graph.edges.values()].map(edge => [edge.key, edge.from, edge.to, edge.evidence.map(position)]);
  assert.ok(core.edges.size > 0);
  assert.deepEqual(edges(plugin), edges(core));
  assert.equal(plugin.unownedMentions, core.unownedMentions);
  assert.deepEqual([...plugin.nodes.values()].map(node => [node.id, node.definitions.length]).sort(), [...core.nodes.values()].map(node => [node.id, node.definitions.length]).sort());
  // Focus pairs requirement/design/task roles over the same links, keeping authored order and direction.
  const groups = (result: ReturnType<typeof coreRelationships>) => [result.definitionCount, result.groups.map(group => [group.id, group.definitionCount, group.evidence.map(item => [item.from, item.to, position(item.reference)])])];
  for (const id of core.nodes.keys()) assert.deepEqual(groups(pluginRelationships(local, id) as never), groups(coreRelationships(index, id)), id);
  return { core, models };
}

test('Relationships consumes model links identically to Specular\'s graph, including unowned mentions', () => {
  const { core, models } = assertSameRelationships({
    'spec.md': 'Intro mentions TASK-001 before any section.\n\n# REQ-001 First\nSee DD-001 and DD-001 again.\n',
    'design.md': '# DD-001 Design\nImplements REQ-001.\n\n# TASK-001 Build\nFollows DD-001 and REQ-001 and REQ-404.\n',
  }, LEGACY_ID_CONFIGURATION);
  assert.equal(core.unownedMentions, 1);
  assert.equal(models.project.unownedMentions, 1);
  const repeated = models.project.relationships.find(link => link.from === 'REQ-001' && link.to === 'DD-001')!;
  assert.equal(repeated.evidence.length, 2);
  assert.ok(models.project.relationships.some(link => link.to === 'REQ-404'), 'a link to an undefined ID is still recorded');
});

test('folder-scoped IDs keep links inside their scope', () => {
  const first = 'specs/002-swift-version-compat', second = 'specs/003-test-architecture', scopes = [{ pattern: 'specs/*' }];
  const configuration: IdConfiguration = { version: 1,
    categories: [{ key: 'FR', name: 'Requirements', role: 'requirement', idScopes: structuredClone(scopes) }, { key: 'DD', name: 'Design', role: 'design', idScopes: structuredClone(scopes) }],
    rules: [{ key: 'FR', category: 'FR', prefix: 'FR' }, { key: 'DD', category: 'DD', prefix: 'DD' }] };
  const { models } = assertSameRelationships({
    [`${first}/spec.md`]: '# FR-001 Swift\n\nDD-001\n',
    [`${first}/contracts/nested/api.md`]: '# DD-001 Swift design\nFR-001\n',
    [`${second}/spec.md`]: '# FR-001 Tests\n\nDD-001\n',
    [`${second}/research.md`]: '# DD-001 Test design\nFR-001\n',
    'readme.md': 'FR-001\n',
  }, configuration);
  for (const link of models.project.relationships) {
    const from = models.project.ids.find(item => item.key === link.from)!, to = models.project.ids.find(item => item.key === link.to)!;
    assert.equal(from.scope, to.scope, `${link.from} -> ${link.to}`);
  }
  assert.equal(models.project.relationships.length, 4);
});
