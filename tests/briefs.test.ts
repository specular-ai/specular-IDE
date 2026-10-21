import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureBriefSource, assembleBrief, describeBriefSource } from '../src/core/briefs';
import { parseMarkdown } from '../src/core/documents';

test('assembles both selections separately without inventing preview source positions', () => {
  const source = captureBriefSource('spec.md', '**Shared text**', 0, 15, false);
  const preview = { kind: 'preview' as const, file: 'spec.md', text: 'Shared text', ids: [], unsaved: false, diskConflict: false };
  const both = assembleBrief([source, preview], 'Explain.');
  assert.match(both, /## Selected Markdown/);
  assert.match(both, /## Selected preview text/);
  assert.match(both, /exact source lines are unavailable/);
  assert.deepEqual(parseMarkdown(both).children.filter(node => node.type === 'code').map(node => node.lang), ['markdown', 'text']);
  assert.doesNotMatch(assembleBrief(preview, 'Explain.'), /Selection: lines/);
  assert.throws(() => assembleBrief([], 'Explain.'), /Choose a selection/);
});

test('captures only the selection, its line range, and complete recognized IDs', () => {
  const before = '# REQ-001 — Start\n\n';
  const selection = 'Use REQ-001 with DD-002 and REQ-001.\n';
  const text = before + selection + '\nREQ-003 is outside the selection.';
  const source = captureBriefSource('docs/spec.md', text, before.length, before.length + selection.length, false);
  assert.equal(source.text, selection);
  assert.deepEqual(source.ids, ['REQ-001', 'DD-002']);
  assert.equal(source.startLine, 3); assert.equal(source.endLine, 3);
  assert.equal(source.file, 'docs/spec.md');
  assert.deepEqual(captureBriefSource('docs/spec.md', text, before.length, before.length + 9, false).ids, []);
});

test('uses document context when recognizing IDs in quoted and fenced examples', () => {
  const text = '# REQ-001 — Start\n\n> Example REQ-999\n\n```md\nExample REQ-998\n```\n\nUse `REQ-001`.\n';
  const source = captureBriefSource('spec.md', text, 0, text.length, true, true);
  assert.deepEqual(source.ids, ['REQ-001']);
  assert.match(describeBriefSource(source), /Unsaved editor snapshot.*disk conflict/);
  assert.equal(source.text, text);
});

test('rejects whitespace, invalid ranges, code files, and blank instructions', () => {
  assert.throws(() => captureBriefSource('spec.md', '   ', 0, 3, false), /Select some Markdown/);
  assert.throws(() => captureBriefSource('spec.md', 'abc', 0, 0, false), /Select some Markdown/);
  assert.throws(() => captureBriefSource('spec.md', 'abc', -1, 2, false), /Select some Markdown/);
  assert.throws(() => captureBriefSource('code.ts', 'abc', 0, 3, false), /Open a Markdown/);
  const source = captureBriefSource('spec.md', 'Paragraph', 0, 9, false);
  assert.throws(() => assembleBrief(source, ' \n '), /Enter an instruction/);
  assert.match(assembleBrief(source, 'Explain this.'), /None recognized/);
});

test('preserves nested Markdown fences and literal paths in the assembled brief', () => {
  const text = '# REQ-001 — Example\n\n```ts\nconst example = "```";\n```';
  const source = captureBriefSource('docs/spec`notes.md', text, 0, text.length, true);
  const brief = assembleBrief(source, ' Implement this requirement. ');
  const blocks = parseMarkdown(brief).children.filter(node => node.type === 'code');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].lang, 'markdown');
  assert.equal(blocks[0].value, text + '\n');
  assert.match(brief, /Implement this requirement\./);
  assert.match(brief, /docs\/spec`notes\.md/);
  assert.match(brief, /Unsaved editor snapshot/);
});

test('captures authored TASK IDs in briefs while ignoring quoted and fenced examples', () => {
  const text = '# TASK-001\nImplement DD-001 with TASK-002.\n\n> TASK-999\n\n```md\nTASK-998\n```\n';
  const source = captureBriefSource('tasks.md', text, 0, text.length, true);
  assert.deepEqual(source.ids, ['TASK-001', 'DD-001', 'TASK-002']);
  assert.match(assembleBrief(source, 'Review the task.'), /IDs: TASK-001, DD-001, TASK-002/);
});
