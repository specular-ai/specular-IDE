import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoverIds, candidateProposal, validateProposal, mergeProposal } from '../src/core/id-discovery';
import { LEGACY_ID_CONFIGURATION, compileIdMatcher } from '../src/core/id-configuration';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { DEFAULT_ID_DEFINITION_SITES } from '../src/core/definition-sites';
const documents = { 'a.md': '# REF-01 Requirement\nREF-02 and USB3 on 2026-09-17.\n\n| ID | Description |\n| --- | --- |\n| DEC_1 | Decision |\n| DEC_2 | Another decision |\n\n`CODE-1`\n\n> QUOTE-1\n\n```md\n# FENCE-1\n```\n' };
test('pattern discovery excludes system paths without suppressing nearby plain identifiers', () => {
  const text = String.raw`# KEEP1 Requirement
KEEP2 and SOLO1 are plain identifiers.
/var/UNIX1/file.md /var/UNIX2/file.md
C:\WIN1\file.md D:/WIN2/file.md
\\server\share\UNC1.md \\server\share\UNC2.md
./REL1/file.md ../REL2/file.md docs/REL3.md docs\REL4.md
~/HOME1/file.md $HOME/HOME2/file.md %USERPROFILE%\HOME3\file.md
"C:\Program Files\SPACED1 notes.txt" '/var/SPACED2 notes/file.md'
"C:\Program Files\item SPACED3.txt" '/var/item SPACED4.txt'
(docs/PAREN1.md), docs/PAREN2.md; KEEP1 / KEEP2
/var/SOLO2.md /var/KEEP3.md
"KEEP1 is mentioned near /var/file.md" KEEP2
`;
  const documents = { 'paths.md': text };
  const inventory = discoverIds(documents);
  assert.deepEqual(inventory.candidates.map(c => c.prefix).sort(), ['KEEP', 'SOLO']);
  assert.equal(inventory.candidates.find(c => c.prefix === 'KEEP')!.count, 6);
  const proposal = candidateProposal(inventory);
  assert.deepEqual(proposal.suggestions.map(s => s.category.name), ['KEEP']);
  assert.doesNotThrow(() => validateProposal(proposal, documents));
});

test('pattern discovery excludes link labels, destinations and automatic URL links', () => {
  const text = [
    '# KEEP1 Requirement', 'KEEP2 and SOLO1 remain plain text.',
    '[LABEL1](https://example.com/DEST1 "TITLE1") [**LABEL2**](https://example.com/DEST2)',
    '[REF1][target] [REF2][target]', '[target]: https://example.com/DEST3',
    '<https://example.com/AUTO1> <https://example.com/AUTO2>',
    'https://example.com/BARE1?q=QUERY1#HASH1 https://example.com/BARE2?q=QUERY2#HASH2',
    'www.example.com/WWW1 www.example.com/WWW2',
    '[SOLO2](https://example.com) https://example.com/KEEP3',
    '# [HEAD1](https://example.com)', '- [LIST1](https://example.com)',
    '| ID |\n| --- |\n| [TABLE1](https://example.com) |',
  ].join('\n\n');
  const documents = { 'links.md': text };
  const inventory = discoverIds(documents);
  assert.deepEqual(inventory.candidates.map(c => c.prefix).sort(), ['KEEP', 'SOLO']);
  assert.equal(inventory.occurrences, 3);
  const proposal = candidateProposal(inventory);
  assert.deepEqual(proposal.suggestions.map(s => s.category.name), ['KEEP']);
  assert.deepEqual(proposal.suggestions[0].evidence.map(e => e.id), ['KEEP1', 'KEEP2']);
  assert.doesNotThrow(() => validateProposal(proposal, documents));
});

test('pattern proposals require distinct identifiers across all occurrences and selected files', () => {
  const documents = { 'a.md': 'ONE1 ' + 'FR1 '.repeat(40) + 'LATE1 '.repeat(12) + 'PAIR1 SAME1 ', 'b.md': 'FR1 LATE2 PAIR2 SAME1 `ONE2`\n\n> FR2\n' };
  const inventory = discoverIds(documents);
  const proposal = candidateProposal(inventory);
  assert.deepEqual(proposal.suggestions.map(s => s.category.name).sort(), ['LATE', 'PAIR']);
  assert.equal(inventory.candidates.find(c => c.prefix === 'FR')!.distinctIds, 1);
  assert.equal(inventory.candidates.find(c => c.prefix === 'LATE')!.distinctIds, 2);
  assert.equal(candidateProposal(discoverIds({ 'a.md': documents['a.md'] })).suggestions.length, 0);
  assert.doesNotThrow(() => validateProposal(proposal, documents));
});

test('list hints retain exact spans, exclude later mentions and remain independent of configured definitions', () => {
  const text = '- **FR-001**: first, references FR-009\n  - *FR-002*: nested\n- [x] FR-003 — task\n\n1. FR-004: numbered\n\n   Later paragraph FR-008\n\n- Description **FR-007**\n- `CODE-1`: example\n- FR-006.extra\n\n> - QUOTE-1: excluded\n\n- **FR-**005: split token\n';
  const documents = { 'specs/one/a.md': text, 'specs/two/a.md': '- **FR-001**: different record\n' };
  const inventory = discoverIds(documents), fr = inventory.candidates.find(c => c.prefix === 'FR')!;
  assert.equal(fr.definitions, 5);
  assert.equal(inventory.candidates.length, 1);
  assert.deepEqual(fr.evidence.filter(e => e.context === 'list-item').map(e => e.id), ['FR-001', 'FR-002', 'FR-003', 'FR-004']);
  for (const e of fr.evidence) assert.equal(documents[e.file as keyof typeof documents].slice(e.offset, e.end), e.id);
  const proposal = validateProposal(candidateProposal(inventory), documents);
  let config = mergeProposal({ version: 1, categories: [], rules: [] }, proposal);
  assert.equal(buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, compileIdMatcher(config)))).definitions.length, 0);
  proposal.suggestions[0].category.idDefinitionSites = structuredClone(DEFAULT_ID_DEFINITION_SITES);
  proposal.suggestions[0].category.idDefinitionSites.lists!.enabled = true;
  proposal.suggestions[0].category.idScopes = [{ pattern: 'specs/*' }];
  config = mergeProposal({ version: 1, categories: [], rules: [] }, validateProposal(proposal, documents));
  const index = buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, compileIdMatcher(config))));
  assert.equal(index.definitions.length, 5);
  assert.deepEqual(index.definitions.filter(d => d.id === 'FR-001').map(d => d.scope), ['specs/one', 'specs/two']);
});

test('v1 list evidence accepts scoped equal tokens and rejects mislabeled, split, malformed and stale examples', () => {
  const documents = { 'specs/one/a.md': '- **R:alpha**: first\n- Mentions R:alpha\n- **R:**alpha: split\n', 'specs/two/a.md': '1. *R:alpha*: second\n' };
  const evidence = Object.entries(documents).map(([file, text]) => ({ id: 'R:alpha', file, offset: text.indexOf('R:alpha'), end: text.indexOf('R:alpha') + 7, context: 'list-item' as const }));
  const proposal = { version: 1 as const, suggestions: [{ key: 'r', category: { key: 'r', name: 'Records' }, rule: { key: 'r', category: 'r', pattern: 'R:[a-z]+' }, uncertainty: 'Two records in separate files.', evidence }] };
  assert.deepEqual(validateProposal(proposal, documents), proposal);
  for (const patch of [{ context: 'list' }, { offset: -1 }, { end: evidence[0].end + 1 }, { offset: documents['specs/one/a.md'].indexOf('R:alpha', evidence[0].end), end: documents['specs/one/a.md'].indexOf('R:alpha', evidence[0].end) + 7 }]) {
    const invalid = structuredClone(proposal); Object.assign(invalid.suggestions[0].evidence[0], patch);
    assert.throws(() => validateProposal(invalid, documents), /evidence/);
  }
  for (const text of ['- **R:**alpha: split', '> - R:alpha: quote', '- `R:alpha`: code', '- Intro\n\n  R:alpha later', '- R:alphabet: partial']) {
    const offset = text.indexOf('R:alpha');
    const invalid = structuredClone(proposal); invalid.suggestions[0].evidence = [{ ...evidence[0], offset, end: offset + 7 }];
    assert.throws(() => validateProposal(invalid, { ...documents, 'specs/one/a.md': text }), /evidence/);
  }
});
test('local discovery finds unknown prefixes, definition contexts and repeated mentions while excluding examples and dates', () => {
  const inventory = discoverIds(documents);
  assert.deepEqual(inventory.candidates.map(c => c.prefix).sort(), ['DEC', 'REF', 'USB']);
  const ref = inventory.candidates.find(c => c.prefix === 'REF')!;
  assert.equal(ref.count, 2); assert.equal(ref.definitions, 1);
  assert.equal(inventory.candidates.find(c => c.prefix === 'USB')!.definitions, 0);
  for (const c of inventory.candidates) for (const e of c.evidence) assert.equal(documents['a.md'].slice(e.offset, e.end), e.id);
  assert.equal(discoverIds({ 'b.md': '# A title mentioning REF-1\n' }).candidates[0].definitions, 0);
});
test('reviewed proposals preserve existing configuration and map selected custom IDs through the real matcher', () => {
  const p = candidateProposal(discoverIds(documents)); p.suggestions = p.suggestions.filter(s => s.evidence[0].id.startsWith('REF'));
  p.suggestions[0].category.name = 'Requirements'; p.suggestions[0].category.role = 'requirement';
  const result = mergeProposal(LEGACY_ID_CONFIGURATION, validateProposal(p, documents));
  assert.equal(LEGACY_ID_CONFIGURATION.rules.length, 11);
  const index = buildIndex([analyzeDocument('a.md', documents['a.md'], compileIdMatcher(result))]);
  assert.equal(index.definitions[0].id, 'REF-01'); assert.equal(index.definitions[0].category!.role, 'requirement');
  const renamed = mergeProposal(result, { ...p, suggestions: [{ ...p.suggestions[0], category: { ...p.suggestions[0].category, name: 'Changed' } }] });
  assert.deepEqual(renamed.categories.slice(0, result.categories.length), result.categories);
  assert.notEqual(renamed.categories.at(-1)!.key, result.categories.at(-1)!.key);
  assert.equal(renamed.rules.at(-1)!.category, renamed.categories.at(-1)!.key);
});

test('proposal collisions remap shared categories, rules and module memberships without changing inputs', () => {
  const key = 'k'.repeat(64);
  const base = { version: 1 as const, categories: [{ key, name: 'Existing' }], rules: [{ key, category: key, prefix: 'OLD' }], modules: [{ key, name: 'Existing module' }], moduleRules: [{ key, scope: 'file' as const, path: 'old.md', modules: [key] }] };
  const p = candidateProposal(discoverIds(documents)); p.suggestions = p.suggestions.slice(0, 2);
  for (const s of p.suggestions) { s.category = { key, name: 'New category' }; s.rule!.key = key; s.rule!.category = key; s.modules = [{ key, name: 'New module' }]; s.moduleRules = [{ key, path: 'a.md', scope: 'file', modules: [key] }]; }
  const original = structuredClone({ base, p });
  const result = mergeProposal(base, validateProposal(p, documents));
  assert.deepEqual({ base, p }, original);
  assert.equal(result.categories.length, 2); assert.equal(result.rules.length, 3);
  assert.equal(result.modules!.length, 2); assert.equal(result.moduleRules!.length, 2);
  assert.deepEqual(result.rules.slice(1).map(r => r.category), [result.categories[1].key, result.categories[1].key]);
  assert.deepEqual(result.moduleRules![1].modules, [result.modules![1].key]);
  for (const list of [result.categories, result.rules, result.modules!, result.moduleRules!]) { assert.equal(new Set(list.map(v => v.key)).size, list.length); assert.ok(list.every(v => v.key.length <= 64)); }
  assert.equal(result.rules[0].key, key); assert.deepEqual(result.moduleRules![0], base.moduleRules[0]);
});
test('versioned proposal review rejects missing, stale, oversized or malformed evidence without executing custom regex', () => {
  const p = candidateProposal(discoverIds(documents));
  assert.throws(() => validateProposal({ ...p, version: 9 }, documents), /version-1/);
  assert.throws(() => validateProposal(p, { 'a.md': 'changed' }), /evidence/);
  assert.throws(() => validateProposal({ ...p, suggestions: [{ ...p.suggestions[0], evidence: [] }] }, documents), /source examples/);
  assert.throws(() => validateProposal({ ...p, suggestions: [{ ...p.suggestions[0], uncertainty: 'x'.repeat(300000) }] }, documents), /256 KB/);
  const slow = structuredClone(p); slow.suggestions[0].rule!.pattern = '(a+)+$';
  assert.doesNotThrow(() => validateProposal(slow, documents)); // Execution belongs exclusively in the bounded preview worker.
  slow.suggestions[0].rule!.pattern = '('; assert.throws(() => validateProposal(slow, documents), /regular expression/);
});
test('candidate coverage is bounded and proposal module file rules are validated and merged', () => {
  assert.throws(() => discoverIds({ 'a.md': 'REF-1 '.repeat(20001) }), /20,000/);
  assert.throws(() => discoverIds(Object.fromEntries(Array.from({ length: 2001 }, (_, i) => [i + '.md', '']))), /2000 files/);
  assert.throws(() => discoverIds({ 'a.md': 'x'.repeat(20 * 1024 * 1024 + 1) }), /20 MB/);
  const p = candidateProposal(discoverIds(documents)); p.suggestions = p.suggestions.slice(0, 1);
  p.suggestions[0].modules = [{ key: 'gui', name: 'GUI' }]; p.suggestions[0].moduleRules = [{ key: 'gui-files', scope: 'file', path: 'a.md', modules: ['gui'] }];
  const result = mergeProposal(LEGACY_ID_CONFIGURATION, validateProposal(p, documents)); assert.equal(result.modules![0].name, 'GUI');
  p.suggestions[0].moduleRules[0].path = '../outside'; assert.throws(() => validateProposal(p, documents), /project-relative/);
});
