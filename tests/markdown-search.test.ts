import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_SEARCH_QUERY, SEARCH_LIMIT, searchMarkdown } from '../src/core/markdown-search';

test('literal search finds case variants in all Markdown source blocks in deterministic file/position order', () => {
  const documents = { 'z.markdown': '| Needle |\n~~~js\nNeedle\n~~~', 'a.md': '# NEEDLE\n\nneedle and Needle', 'b.ts': 'Needle', 'c.txt': 'Needle' };
  const results = searchMarkdown(documents, 'needle');
  assert.deepEqual(results.matches.map(match => [match.file, match.line, match.column, match.match]), [
    ['a.md', 1, 3, 'NEEDLE'], ['a.md', 3, 1, 'needle'], ['a.md', 3, 12, 'Needle'],
    ['z.markdown', 1, 3, 'Needle'], ['z.markdown', 3, 1, 'Needle'],
  ]);
  assert.equal(results.truncated, false);
  assert.equal(searchMarkdown(documents, 'Needle', true).matches.length, 3);
  const literal = '.*+?^${}()|[]\\';
  assert.deepEqual(searchMarkdown({ 'punctuation.md': literal + ' text ' + literal }, literal).matches.map(match => match.offset), [0, literal.length + 6]);
});

test('Unicode case matching and CRLF locations retain exact normalized source offsets', () => {
  const raw = '# Notes\r\n\r\nİ extra 🧭 CAFÉ café\r\nΣ σ ς\r\n';
  const normalized = raw.replace(/\r\n/g, '\n');
  const matches = searchMarkdown({ 'notes.md': raw }, 'café').matches;
  assert.deepEqual(matches.map(match => [match.line, match.column, match.match]), [[3, 12, 'CAFÉ'], [3, 17, 'café']]);
  for (const match of matches) assert.equal(normalized.slice(match.offset, match.end), match.match);
  assert.deepEqual(searchMarkdown({ 'notes.md': raw }, 'Σ').matches.map(match => match.match), ['Σ', 'σ', 'ς']);
  assert.equal(searchMarkdown({ 'notes.md': raw }, '🧭').matches[0].end - searchMarkdown({ 'notes.md': raw }, '🧭').matches[0].offset, 2);
});

test('empty, multiline, excessive and unmatched queries yield no results; snippets stay bounded', () => {
  for (const query of ['', 'a\nb', 'a\rb', 'x'.repeat(MAX_SEARCH_QUERY + 1), 'absent']) {
    assert.deepEqual(searchMarkdown({ 'a.md': 'text' }, query), { matches: [], truncated: false });
  }
  const result = searchMarkdown({ 'a.md': 'a'.repeat(1000) + 'TARGET' + 'b'.repeat(1000) }, 'target').matches[0];
  assert.equal(result.before, '…' + 'a'.repeat(60)); assert.equal(result.after, 'b'.repeat(100) + '…');
  assert.equal(result.column, 1001); assert.equal(result.match, 'TARGET');
});

test('the display limit distinguishes exactly 500 occurrences from incomplete results', () => {
  const exact = searchMarkdown({ 'a.md': 'match '.repeat(SEARCH_LIMIT) }, 'match');
  assert.equal(exact.matches.length, SEARCH_LIMIT); assert.equal(exact.truncated, false);
  const more = searchMarkdown({ 'a.md': 'match '.repeat(SEARCH_LIMIT), 'b.md': 'match' }, 'match');
  assert.equal(more.matches.length, SEARCH_LIMIT); assert.equal(more.truncated, true);
});
