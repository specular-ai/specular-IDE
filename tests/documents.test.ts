import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { analyzeDocument, buildIndex } from '../src/core/documents';

test('indexes heading and ID-column definitions across files, including inline code references', () => {
  const requirements = '| ID | Requirement | Status |\r\n| --- | --- | --- |\r\n| REQ-001 | Start a timer | Confirmed |\r\n';
  const design = '# DD-001 — State model\n\nImplements **REQ-001** and `REQ-001`.\n';
  const index = buildIndex([analyzeDocument('requirements.md', requirements), analyzeDocument('design.md', design)]);
  assert.deepEqual(index.definitions.map(item => item.id), ['REQ-001', 'DD-001']);
  assert.equal(index.references.filter(item => item.id === 'REQ-001').length, 2);
  const definition = index.definitions[0];
  assert.equal(definition.line, 3);
  assert.equal(requirements.slice(definition.offset, definition.end), 'REQ-001');
  assert.equal(index.findings.length, 0);
});

test('does not turn prose, fenced examples, or quoted examples into definitions or pending work', () => {
  const source = 'REQ-099 is a mention.\n\n> # REQ-098 — Example\n> - [ ] TODO example\n\n```md\n# REQ-097 — Example\nTODO example\n```\n\n# Ordinary heading mentioning REQ-096\n';
  const model = analyzeDocument('example.md', source);
  assert.deepEqual(model.occurrences.map(item => item.id), ['REQ-099', 'REQ-096']);
  assert.ok(model.occurrences.every(item => item.kind === 'reference'));
  assert.equal(model.pending.length, 0);
});

test('definitions can use formatting and non-first ID columns', () => {
  const source = '# `REQ-001` — Start\n\n| Title | ID |\n| --- | --- |\n| Pause | **REQ-002** |\n';
  const model = analyzeDocument('spec.md', source);
  assert.deepEqual(model.occurrences.map(item => [item.id, item.kind]), [['REQ-001', 'definition'], ['REQ-002', 'definition']]);
});

test('encoded ID text does not create an invalid source location', () => {
  const model = analyzeDocument('encoded.md', '# REQ&#45;001 — Example\n');
  assert.equal(model.occurrences.length, 0);
});

test('duplicate definitions remain ambiguous and unresolved references have exact sources', () => {
  const index = buildIndex([analyzeDocument('a.md', '# REQ-001 — First\n'), analyzeDocument('b.md', '# REQ-001 — Second\n\nSee REQ-404.\n')]);
  assert.equal(index.definitions.length, 2);
  assert.equal(index.findings.filter(item => item.kind === 'duplicate').length, 2);
  const unresolved = index.findings.find(item => item.kind === 'unresolved')!;
  assert.equal(unresolved.file, 'b.md'); assert.equal(unresolved.line, 3);
});

test('pending items are explicit, completed tasks clear, and TODO on a checkbox is not counted twice', () => {
  const text = '- [ ] TODO choose notification\n- [x] Choose duration\n\n| ID | Requirement | Status |\n| --- | --- | --- |\n| REQ-001 | Alert | Open |\n';
  assert.equal(analyzeDocument('spec.md', text).pending.length, 2);
  assert.equal(analyzeDocument('spec.md', '- [x] Choose notification\n').pending.length, 0);
  assert.equal(analyzeDocument('spec.md', '- [x] TODO choose notification\n').pending.length, 0);
});

test('Mermaid references preserve source offsets on Windows line endings', () => {
  const text = '# Design\r\n\r\n```mermaid\r\nflowchart LR\r\n A["REQ-001"] --> B["REQ-002"]\r\n```\r\n';
  const model = analyzeDocument('diagram.md', text);
  assert.equal(model.diagrams.length, 1);
  assert.equal(model.diagrams[0].line, 3);
  for (const item of model.occurrences) assert.equal(text.slice(item.offset, item.end), item.id);
});

// The development documents are not part of the public distribution.
test('the project documentation has a unique REQ-126 target and cross-file references', { skip: !existsSync('plan.md') }, async () => {
  const files = ['requirements.md', 'design.md', 'plan.md'];
  const models = await Promise.all(files.map(async file => analyzeDocument(file, await readFile(file, 'utf8'))));
  const index = buildIndex(models);
  assert.equal(index.definitions.filter(item => item.id === 'REQ-126').length, 1);
  assert.equal(index.definitions.find(item => item.id === 'REQ-126')?.file, 'requirements.md');
  assert.ok(index.references.some(item => item.id === 'REQ-126' && item.file === 'design.md'));
});
