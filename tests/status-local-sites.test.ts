import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, type IdConfiguration } from '../src/core/id-configuration';
import { DEFAULT_STATUS_SITES, type StatusSites } from '../src/core/status-sites';
import { mapStatuses } from '../src/core/statuses';

const sites = (changes: { [K in keyof StatusSites]?: Partial<StatusSites[K]> } = {}): StatusSites => ({
  paragraphs: { ...DEFAULT_STATUS_SITES.paragraphs, ...changes.paragraphs },
  tables: { ...DEFAULT_STATUS_SITES.tables, ...changes.tables },
  headings: { ...DEFAULT_STATUS_SITES.headings, ...changes.headings },
});
const configuration = (): IdConfiguration => ({
  version: 1,
  statusSites: sites(),
  categories: [{ key: 'req', name: 'Requirements', statusSites: sites({ paragraphs: { label: 'State:' } }) }, { key: 'dd', name: 'Design' }],
  rules: [{ key: 'req', category: 'req', prefix: 'REQ' }, { key: 'dd', category: 'dd', prefix: 'DD' }],
  statuses: [{ name: 'Draft' }, { name: 'Done', rules: [{ mode: 'startsWith', value: 'Implemented' }], statusSites: sites({ paragraphs: { label: 'Outcome:' } }) }],
});
const index = (text: string, config = configuration()) => mapStatuses(buildIndex([analyzeDocument('a.md', text, compileIdMatcher(config))]), config.statuses ?? []);

test('category baseline and status-specific paragraphs compose without circular selection', () => {
  const result = index('# REQ-1\nStatus: Ignored\n\nState: Draft\n\nOutcome: Implemented locally\n\n# DD-1\nStatus: Draft\n\nState: Ignored\n\nOutcome: Implemented elsewhere\n');
  assert.deepEqual(result.definitions.map(item => [item.id, item.authoredStatus?.state, item.authoredStatus?.evidence.map(e => [e.value, e.display])]), [
    ['REQ-1', 'conflict', [['Draft', 'Draft'], ['Implemented locally', 'Done']]],
    ['DD-1', 'conflict', [['Draft', 'Draft'], ['Implemented elsewhere', 'Done']]],
  ]);
});

test('status override suppresses its baseline value and discards captures belonging to another status', () => {
  const result = index('# REQ-1\nState: Implemented by baseline\n\n# REQ-2\nOutcome: Draft\n');
  assert.deepEqual(result.definitions.map(item => [item.id, item.authoredStatus]), [['REQ-1', undefined], ['REQ-2', undefined]]);
});

test('explicitly disabled category sites retain local status extraction and absence restores inheritance', () => {
  const config = configuration(); config.categories[0].statusSites = sites({ paragraphs: { enabled: false }, tables: { enabled: false }, headings: { enabled: false } });
  let result = index('# REQ-1\nStatus: Draft\n\nOutcome: Implemented\n', config);
  assert.deepEqual(result.definitions[0].authoredStatus?.evidence.map(e => e.display), ['Done']);
  delete config.categories[0].statusSites;
  result = index('# REQ-1\nStatus: Draft\n', config);
  assert.equal(result.definitions[0].authoredStatus?.evidence[0].display, 'Draft');
});

test('local heading and table sites retain exact evidence and apply only to matching statuses', () => {
  const config = configuration(); config.statuses![1].statusSites = sites({
    paragraphs: { enabled: false }, headings: { enabled: true, pattern: '\\[(?<status>[^\\]]+)\\]$' }, tables: { column: 'Outcome', mode: 'regex', pattern: '(?<status>Implemented table)' },
  });
  const text = '# REQ-1 [Implemented heading]\n\n| ID | State | Outcome |\n| --- | --- | --- |\n| DD-1 | | Implemented table |\n';
  const result = index(text, config);
  assert.deepEqual(result.definitions.map(item => item.authoredStatus?.evidence.map(e => [e.site, e.value, text.slice(e.source.offset, e.source.end)])), [
    [['headings', 'Implemented heading', 'Implemented heading']],
    [['tables', 'Implemented table', 'Implemented table']],
  ]);
});
