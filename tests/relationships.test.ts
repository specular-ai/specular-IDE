import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { relationshipsFor, relatedThroughDecisions, supportsRelationships } from '../src/core/relationships';

const model = (text: string) => analyzeDocument('spec.md', text);
const refs = (text: string) => model(text).occurrences.filter(item => item.kind === 'reference').map(item => [item.id, item.owner?.id]);

test('heading ownership respects ordinary subsections, nested definitions, and equal or shallower boundaries', () => {
  const text = 'Unowned REQ-100.\n# DD-001\nREQ-001\n## Details\nREQ-002\n## DD-002\nREQ-003\n### More\nREQ-004\n## Sibling\nREQ-005\n# General\nREQ-006\n';
  assert.deepEqual(refs(text), [['REQ-100', undefined], ['REQ-001', 'DD-001'], ['REQ-002', 'DD-001'], ['REQ-003', 'DD-002'], ['REQ-004', 'DD-002'], ['REQ-005', 'DD-001'], ['REQ-006', undefined]]);
  for (const item of model(text).occurrences.filter(item => item.owner)) assert.equal(text.slice(item.owner!.offset, item.owner!.offset + item.owner!.id.length), item.owner!.id);
});

test('ID table rows override the enclosing owner and cannot leak references into other rows', () => {
  const text = '# DD-001\n\n| Description | ID |\n| --- | --- |\n| DD-002 and DD-003 | **REQ-001** |\n| DD-004 | REQ-002 |\n| DD-005 | invalid |\n\nAfter REQ-003.\n\n| Value |\n| --- |\n| REQ-004 |\n';
  assert.deepEqual(refs(text), [['DD-002', 'REQ-001'], ['DD-003', 'REQ-001'], ['DD-004', 'REQ-002'], ['DD-005', undefined], ['REQ-003', 'DD-001'], ['REQ-004', 'DD-001']]);
});

test('encoded definitions, quoted examples and ordinary code never establish owners or false links', () => {
  const text = '# DD&#45;001\nREQ-001\n\n> # DD-002\n> REQ-002\n\n```markdown\n# DD-003\nREQ-003\n```\n\n# DD-004\nA `REQ-004` reference.\n';
  assert.deepEqual(refs(text), [['REQ-001', undefined], ['REQ-004', 'DD-004']]);
});

test('Mermaid evidence uses the owning section and exact multiline CRLF positions', () => {
  const text = '# DD-001\r\n\r\n```mermaid\r\nflowchart LR\r\n A[REQ-001]\r\n B[REQ-002]\r\n```\r\n';
  const references = model(text).occurrences.filter(item => item.kind === 'reference');
  assert.equal(references.length, 2);
  for (const item of references) { assert.equal(item.owner?.id, 'DD-001'); assert.equal(text.slice(item.offset, item.end), item.id); assert.ok(item.label.includes(item.id)); }
});

test('groups each REQ/DD pair once, retains both authored directions and every evidence passage, excludes other pairs', () => {
  const index = buildIndex([model('# REQ-001\nDD-001 and REQ-001.\n# DD-001\nREQ-001 and REQ-001, DD-001, DD-002, PH-001.\n# General\nREQ-001\n')]);
  const result = relationshipsFor(index, 'REQ-001'); assert.equal(result.definitionCount, 1); assert.equal(result.groups.length, 1);
  const group = result.groups[0]; assert.equal(group.id, 'DD-001'); assert.equal(group.definition?.id, 'DD-001'); assert.equal(group.evidence.length, 3);
  assert.deepEqual(group.evidence.map(item => [item.from, item.to]), [['REQ-001', 'DD-001'], ['DD-001', 'REQ-001'], ['DD-001', 'REQ-001']]);
  assert.equal(relationshipsFor(index, 'DD-001').groups[0].id, 'REQ-001'); assert.equal(relationshipsFor(index, 'PH-001').groups.length, 0);
  assert.equal(index.references.filter(item => item.id === 'REQ-001').length, 4);
});

test('duplicate and missing endpoints remain explicit without selecting an arbitrary definition', () => {
  const index = buildIndex([model('# DD-001\nREQ-001 and REQ-404.\n# REQ-001\nFirst.\n# REQ-001\nSecond.\n# DD-001\nREQ-002\n# REQ-002\nUnique.\n')]);
  const result = relationshipsFor(index, 'DD-001'); assert.equal(result.definitionCount, 2);
  assert.equal(result.groups.find(g => g.id === 'REQ-001')?.definitionCount, 2); assert.equal(result.groups.find(g => g.id === 'REQ-001')?.definition, undefined);
  assert.equal(result.groups.find(g => g.id === 'REQ-404')?.definitionCount, 0); assert.equal(result.groups.find(g => g.id === 'REQ-404')?.definition, undefined);
  assert.equal(relationshipsFor(index, 'REQ-002').groups[0].definition, undefined);
});

test('new text snapshots remove old relationships without mutating earlier evidence', () => {
  const before = relationshipsFor(buildIndex([model('# DD-001\nREQ-001\n# REQ-001\n')]), 'REQ-001');
  const after = relationshipsFor(buildIndex([model('# DD-001\nREQ-002\n# REQ-001\n')]), 'REQ-001');
  assert.equal(before.groups[0].evidence.length, 1); assert.equal(after.groups.length, 0);
});

// The development documents are not part of the public distribution.
test('Specular requirements and design have a source-backed DD-031 to REQ-127 relationship', { skip: !existsSync('increments_plan.md') }, async () => {
  const files = ['requirements.md', 'design.md', 'plan.md', 'increments_plan.md'];
  const documents: Record<string, string> = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(file, 'utf8')] as const)));
  const index = buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text)));
  const group = relationshipsFor(index, 'REQ-127').groups.find(item => item.id === 'DD-031'); assert.ok(group?.definition);
  assert.ok(group.evidence.some(item => item.from === 'DD-031' && item.to === 'REQ-127'));
  for (const { reference } of group.evidence) {
    const source = documents[reference.file]; assert.equal(source.slice(reference.offset, reference.end), reference.id);
    assert.equal(source.slice(reference.owner!.offset, reference.owner!.offset + reference.owner!.id.length), reference.owner!.id);
  }
  // Changelog mentions are still indexed but must not leak into the preceding decision.
  assert.ok(index.references.some(item => item.file === 'design.md' && item.id === 'DD-031' && !item.owner));
});

const taskFiles = {
  'req.md': '# REQ-001\nDD-001.\n# REQ-002\nDD-001.\n',
  'dd.md': '# DD-001\nREQ-001 and TASK-001, TASK-404.\n# DD-002\nREQ-002.\n',
  'tasks.md': '# TASK-001 - Completed (authored)\nDD-001 and DD-001, REQ-001, TASK-002.\n\n| ID | Work |\n| --- | --- |\n| TASK-002 | DD-001 and DD-002 |\n| TASK-003 | Unlinked |\n\n# Notes\nTASK-999 unowned.\n',
};
const taskIndex = () => buildIndex(Object.entries(taskFiles).map(([file, text]) => analyzeDocument(file, text)));
test('authored heading and table tasks preserve both hops, repeated evidence and reverse browsing without adding direct TASK/REQ pairs', () => {
  const index = taskIndex();
  const direct = relationshipsFor(index, 'REQ-001').groups;
  const through = relatedThroughDecisions(index, 'REQ-001', direct);
  assert.deepEqual(through.map(item => item.id), ['TASK-001', 'TASK-002', 'TASK-404']);
  assert.equal(through[0].anchor, 'DD-001'); assert.equal(through[0].evidence.length, 3);
  assert.deepEqual(through[0].evidence.map(item => item.from), ['DD-001', 'TASK-001', 'TASK-001']);
  assert.deepEqual(relationshipsFor(index, 'TASK-001').groups.map(item => item.id), ['DD-001']);
  assert.deepEqual(relatedThroughDecisions(index, 'TASK-001', relationshipsFor(index, 'TASK-001').groups).map(item => item.id), ['REQ-001', 'REQ-002']);
  assert.equal(index.definitions.find(item => item.id === 'TASK-002')?.line, 6);
  assert.equal(relationshipsFor(index, 'TASK-003').groups.length, 0);
  assert.equal(index.references.find(item => item.id === 'TASK-999')?.owner, undefined);
  for (const group of [...direct, ...through]) for (const item of group.evidence) {
    const text = taskFiles[item.reference.file as keyof typeof taskFiles];
    assert.equal(text.slice(item.reference.offset, item.reference.end), item.to);
  }
  assert.ok(index.findings.some(item => item.kind === 'unresolved' && item.message.includes('TASK-404')));
});
test('task paths do not expand missing or duplicate intermediates or an ambiguous focus; filters apply to every hop', () => {
  const index = taskIndex();
  const direct = relationshipsFor(index, 'REQ-001').groups;
  assert.deepEqual(relatedThroughDecisions(index, 'REQ-001', direct, 'tasks.md').map(item => item.id), ['TASK-001', 'TASK-002']);
  index.definitions.push({ ...index.definitions.find(item => item.id === 'DD-001')! });
  assert.equal(relatedThroughDecisions(index, 'REQ-001', relationshipsFor(index, 'REQ-001').groups).length, 0);
  index.definitions.pop();
  index.definitions.push({ ...index.definitions.find(item => item.id === 'TASK-001')! });
  assert.equal(relatedThroughDecisions(index, 'TASK-001', relationshipsFor(index, 'TASK-001').groups).length, 0);
  assert.equal(relationshipsFor(index, 'DD-001').groups.find(item => item.id === 'TASK-001')?.definition, undefined);
});
test('task edits refresh links and duplicate diagnostics without changing the earlier snapshot', () => {
  const before = taskIndex();
  const edited = buildIndex(Object.entries({ ...taskFiles, 'tasks.md': '# TASK-001\nDD-002.\n# TASK-001\nDuplicate.\n' }).map(([file, text]) => analyzeDocument(file, text)));
  assert.equal(relationshipsFor(before, 'TASK-001').groups.length, 1);
  assert.equal(relationshipsFor(edited, 'TASK-001').groups.length, 2);
  assert.equal(edited.findings.filter(item => item.kind === 'duplicate' && item.message.includes('TASK-001')).length, 2);
});

import { compileIdMatcher, type IdConfiguration } from '../src/core/id-configuration';
import { buildDependencyGraph } from '../src/core/dependencies';
const configured: IdConfiguration = { version: 1, categories: [
  { key: 'needs', name: 'Business needs', role: 'requirement' }, { key: 'architecture', name: 'Architecture', role: 'design' },
  { key: 'work', name: 'Work items', role: 'task' }, { key: 'notes', name: 'Notes' },
], rules: [
  { key: 'ref', category: 'needs', prefix: 'REF' }, { key: 'alt', category: 'needs', prefix: 'NEED', separator: '' },
  { key: 'dec', category: 'architecture', prefix: 'DEC', separator: '_' }, { key: 'work', category: 'work', prefix: 'WORK' },
  { key: 'notes', category: 'notes', prefix: 'REQ' },
] };
test('configured roles drive Focus and category grouping without prefix assumptions', () => {
  const index = buildIndex([analyzeDocument('custom.md', '# REF-01\nDEC_1\n# NEED02\nDEC_1\n# DEC_1\nREF-01 WORK-1 WORK-404 REQ-1\n# WORK-1\nDEC_1\n# REQ-1\nDEC_1', compileIdMatcher(configured))]);
  assert.equal(supportsRelationships('REF-01', index), true);
  assert.equal(supportsRelationships('REQ-1', index), false);
  const direct = relationshipsFor(index, 'REF-01');
  assert.deepEqual(direct.groups.map(g => g.id), ['DEC_1']);
  assert.deepEqual(relatedThroughDecisions(index, 'REF-01', direct.groups).map(g => [g.id, g.definitionCount]), [['WORK-1', 1], ['WORK-404', 0]]);
  assert.deepEqual(relationshipsFor(index, 'DEC_1').groups.map(g => g.id), ['NEED02', 'REF-01', 'WORK-1', 'WORK-404']);
  const graph = buildDependencyGraph(index);
  assert.equal(graph.nodes.get('REF-01')?.kind, 'needs'); assert.equal(graph.nodes.get('NEED02')?.kind, 'needs');
  assert.equal(graph.nodes.get('REQ-1')?.kindLabel, 'Notes'); assert.ok(graph.edges.has('REQ-1>DEC_1'));
  const reassigned = structuredClone(configured); delete reassigned.categories[1].role;
  const changed = buildIndex([analyzeDocument('custom.md', '# REF-01\nDEC_1\n# DEC_1\nWORK-1', compileIdMatcher(reassigned))]);
  assert.deepEqual(relationshipsFor(changed, 'REF-01').groups, []);
  const duplicate = buildIndex([analyzeDocument('custom.md', '# REF-01\nDEC_1\n# DEC_1\nWORK-1\n# DEC_1\nWORK-1', compileIdMatcher(configured))]);
  assert.equal(relationshipsFor(duplicate, 'REF-01').groups[0].definitionCount, 2);
  assert.deepEqual(relatedThroughDecisions(duplicate, 'REF-01', relationshipsFor(duplicate, 'REF-01').groups), []);
});
test('context-dependent rules cannot assign conflicting categories to the same ID', () => {
  const config: IdConfiguration = { ...configured, rules: [{ key: 'first', category: 'needs', pattern: '(?<=A )REF-1' }, { key: 'second', category: 'notes', pattern: '(?<=B )REF-1' }] };
  assert.throws(() => buildIndex([analyzeDocument('custom.md', 'A REF-1\nB REF-1', compileIdMatcher(config))]), /conflicting categories/);
});
