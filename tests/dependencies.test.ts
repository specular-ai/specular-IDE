import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { buildDependencyGraph, dependencyKey, dependencyPaths, filterDependencies } from '../src/core/dependencies';

const indexOf = (files: Record<string, string>) => buildIndex(Object.entries(files).map(([file, text]) => analyzeDocument(file, text)));
const files = {
  'requirements.md': '# REQ-001\nREQ-002 and DD-001, DD-001.\n# REQ-002 - Isolated\nIsolated from outgoing references.\n',
  'design.md': '# DD-001\r\nREQ-001 and DD-001, PH-001 and Q-404.\r\n# DD-002 - Isolated\r\nIsolated.\r\n',
  'plan.md': '# PH-001\nIP-001.\n# IP-001\nPH-001.\n',
  'notes.md': 'Unowned REQ-999.\n> # DD-888\n> REQ-001\n\n```md\n# DD-777\nREQ-001\n```\n',
};

test('the complete graph retains every owned reference, all definition nodes, self and same-kind links, and missing endpoints', () => {
  const index = indexOf(files), graph = buildDependencyGraph(index);
  assert.deepEqual([...graph.nodes.keys()].sort(), ['DD-001', 'DD-002', 'IP-001', 'PH-001', 'Q-404', 'REQ-001', 'REQ-002']);
  assert.deepEqual([...graph.edges.keys()].sort(), ['DD-001>DD-001', 'DD-001>PH-001', 'DD-001>Q-404', 'DD-001>REQ-001', 'IP-001>PH-001', 'PH-001>IP-001', 'REQ-001>DD-001', 'REQ-001>REQ-002']);
  assert.equal(graph.edges.get('REQ-001>DD-001')!.evidence.length, 2);
  assert.equal(graph.nodes.get('Q-404')!.definitions.length, 0);
  assert.equal(graph.incoming.get('DD-002'), undefined); assert.equal(graph.outgoing.get('DD-002'), undefined);
  assert.equal(graph.unownedMentions, 1);
  const owned = index.references.filter(item => item.owner);
  assert.equal([...graph.edges.values()].reduce((sum, edge) => sum + edge.evidence.length, 0), owned.length);
  for (const edge of graph.edges.values()) for (const reference of edge.evidence) {
    assert.equal(reference.owner!.id, edge.from); assert.equal(reference.id, edge.to);
    assert.equal(files[reference.file as keyof typeof files].slice(reference.offset, reference.end), edge.to);
  }
});

test('every recognized ID kind including TASK joins the model', () => {
  const ids = ['REQ-001', 'DD-001', 'Q-001', 'IP-001', 'PH-001', 'AT-001', 'US-001', 'STORY-001', 'SM-001', 'STATE-001', 'TASK-001'];
  const index = indexOf({ 'all.md': ids.map((id, i) => `# ${id}\n${ids[(i + 1) % ids.length]}\n`).join('\n') });
  const graph = buildDependencyGraph(index);
  assert.deepEqual([...graph.nodes.keys()].sort(), ids.sort()); assert.equal(graph.edges.size, ids.length);
});

test('filters preserve the full model and cross-file context, including missing IDs and isolated definitions', () => {
  const graph = buildDependencyGraph(indexOf(files));
  const filtered = filterDependencies(graph, { file: 'requirements.md', kind: 'REQ' });
  assert.deepEqual(filtered.nodes.map(node => node.id), ['REQ-001', 'REQ-002']);
  assert.deepEqual(filtered.edges.map(edge => edge.key), ['DD-001>REQ-001', 'REQ-001>DD-001', 'REQ-001>REQ-002']);
  assert.equal(filterDependencies(graph, { file: 'design.md', kind: 'Q' }).nodes[0].id, 'Q-404');
  assert.equal(filterDependencies(graph, { query: 'Isolated' }).nodes.length, 2);
  assert.equal(filterDependencies(graph, { file: 'absent.md' }).edges.length, 0);
  assert.equal(graph.nodes.size, 7); assert.equal(graph.edges.size, 8);
});

test('incoming and outgoing paths preserve direction and evidence, terminate on cycles, and choose shortest paths', () => {
  const graph = buildDependencyGraph(indexOf(files));
  const outgoing = dependencyPaths(graph, 'REQ-001', 'outgoing');
  assert.deepEqual(outgoing.pathTo('IP-001').map(edge => edge.key), ['REQ-001>DD-001', 'DD-001>PH-001', 'PH-001>IP-001']);
  assert.equal(outgoing.ids.filter(id => id === 'PH-001').length, 1);
  assert.deepEqual(outgoing.pathTo('REQ-001'), []); assert.deepEqual(outgoing.pathTo('DD-002'), []);
  const incoming = dependencyPaths(graph, 'IP-001', 'incoming');
  assert.deepEqual(incoming.pathTo('REQ-001').map(edge => edge.key), ['PH-001>IP-001', 'DD-001>PH-001', 'REQ-001>DD-001']);
  assert.deepEqual(outgoing.pathTo('Q-404').map(edge => edge.to), ['DD-001', 'Q-404']);
});

test('ambiguous definitions remain inspectable but cannot invent transitive paths by combining their references', () => {
  const graph = buildDependencyGraph(indexOf({ ...files, 'duplicate.md': '# DD-001\nAT-001\n# AT-001\nQ-001\n' }));
  assert.equal(graph.nodes.get('DD-001')!.definitions.length, 2);
  assert.ok(graph.edges.has('DD-001>AT-001'));
  const paths = dependencyPaths(graph, 'REQ-001', 'outgoing');
  assert.ok(paths.ids.includes('DD-001')); assert.ok(!paths.ids.includes('AT-001')); assert.ok(!paths.ids.includes('PH-001'));
  assert.equal(dependencyPaths(graph, 'DD-001', 'outgoing').ids.length, 0);
});

test('large cyclic chains remain complete and traversable without recursive walks or per-node copied paths', () => {
  const ids = Array.from({ length: 600 }, (_, i) => `REQ-${String(i).padStart(3, '0')}`);
  const graph = buildDependencyGraph(indexOf({ 'large.md': ids.map((id, i) => `# ${id}\n${ids[(i + 1) % ids.length]}\n`).join('\n') }));
  assert.equal(graph.nodes.size, 600); assert.equal(graph.edges.size, 600);
  const paths = dependencyPaths(graph, ids[0], 'outgoing'); assert.equal(paths.ids.length, 599); assert.equal(paths.pathTo(ids[599]).length, 599);
});

test('new document snapshots remove old references and paths without mutating an earlier model', () => {
  const before = buildDependencyGraph(indexOf(files));
  const after = buildDependencyGraph(indexOf({ ...files, 'design.md': '# DD-001\nNo references.\n' }));
  assert.ok(before.edges.has(dependencyKey('DD-001', 'PH-001'))); assert.ok(!after.edges.has(dependencyKey('DD-001', 'PH-001')));
  assert.equal(dependencyPaths(after, 'REQ-001', 'outgoing').pathTo('IP-001').length, 0);
});

// The development documents are not part of the public distribution.
test('the real project graph accounts for every indexed definition and owned mention', { skip: !existsSync('increments_plan.md') }, async () => {
  const documents = await Promise.all(['requirements.md', 'design.md', 'plan.md', 'increments_plan.md'].map(async file => [file, await readFile(file, 'utf8')]));
  const index = indexOf(Object.fromEntries(documents)), graph = buildDependencyGraph(index);
  for (const definition of index.definitions) assert.ok(graph.nodes.get(definition.id)!.definitions.includes(definition));
  for (const reference of index.references.filter(item => item.owner)) assert.ok(graph.edges.get(dependencyKey(reference.owner!.id, reference.id))!.evidence.includes(reference));
  assert.ok(graph.edges.has('DD-031>REQ-127')); assert.ok([...graph.edges.values()].some(edge => edge.from.startsWith('DD-') && edge.to.startsWith('DD-')));
});

test('the full model keeps direct task/requirement, task/task, missing and unlinked tasks', () => {
  const graph = buildDependencyGraph(indexOf({ 'tasks.md': '# TASK-001\nREQ-001 and TASK-002, TASK-404.\n# TASK-002\nTASK-001.\n# TASK-003\nUnlinked.\n# REQ-001\nAuthored completion is not verification.\n' }));
  assert.deepEqual([...graph.edges.keys()], ['TASK-001>REQ-001', 'TASK-001>TASK-002', 'TASK-001>TASK-404', 'TASK-002>TASK-001']);
  assert.equal(graph.nodes.get('TASK-404')?.definitions.length, 0);
  assert.equal(graph.nodes.get('TASK-003')?.definitions.length, 1);
  assert.deepEqual(dependencyPaths(graph, 'TASK-002', 'outgoing').pathTo('REQ-001').map(edge => edge.key), ['TASK-002>TASK-001', 'TASK-001>REQ-001']);
});
