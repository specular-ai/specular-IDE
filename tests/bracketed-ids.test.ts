import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { DEFAULT_ID_DEFINITION_SITES, validateIdDefinitionSites } from '../src/core/definition-sites';
import { DEFAULT_STATUS_SITES, validateStatusSites } from '../src/core/status-sites';

// Increment 91: bracketed IDs, full-width colons, list-item status labels, checkbox-only lists, and rejection fixes.
const ALL_SITES = { ...DEFAULT_ID_DEFINITION_SITES, lists: { enabled: true, types: ['unordered', 'ordered'], mode: 'start' }, paragraphs: { enabled: true, mode: 'start' } };
const config = (extra: Record<string, unknown> = {}): IdConfiguration => validateIdConfiguration({
  version: 1, categories: [{ key: 'item', name: 'Items' }],
  rules: [{ key: 'r', category: 'item', pattern: '(?:CQ-[HML]\\d+|R\\d+|T\\d{3}|任务 \\d+)' }], idDefinitionSites: ALL_SITES, ...extra,
});
const ranges = (text: string, configuration = config()) =>
  indexProject({ 'a.md': text }, configuration).definitions.map(d => [d.id, text.slice(d.offset, d.end)]);

test('bracketed IDs define in heading, list, and paragraph start mode, with the range on the ID', () => {
  const text = '**[CQ-H1] Missing input** (src/a.ts)\n\n## [R1] Title\n\n- [R2]: Title\n- [R3]: Title words\n- [R4] - Title\n\n[R5]: Paragraph\n';
  assert.deepEqual(ranges(text), [['CQ-H1', 'CQ-H1'], ['R1', 'R1'], ['R2', 'R2'], ['R3', 'R3'], ['R4', 'R4'], ['R5', 'R5']]);
  // In list items the bracket alone does not separate: such lists cite IDs.
  assert.deepEqual(ranges('- [R1] depends on [R2]\n1. **[CQ-H2]** Fix the filter\n- [R3]. Title\n'), []);
  // The closing bracket must follow the ID, and the separator rules still apply after it.
  assert.deepEqual(ranges('## [R1 Title\n\n## [R2]x Title\n\nSee [R3] here.\n'), []);
  // Checkbox markers keep 88's handling.
  assert.deepEqual(ranges('- [x] T001 Build\n- [-] T002 Test\n- [x] [R1]: Bracketed\n'), [['T001', 'T001'], ['T002', 'T002'], ['R1', 'R1']]);
});

test('start mode accepts the full-width colon', () => {
  assert.deepEqual(ranges('### 任务 1：设计\n\n任务 2：实现\n'), [['任务 1', '任务 1'], ['任务 2', '任务 2']]);
});

const PROGRESS = '- **Status**: DONE before any definition\n\n## R1 First\n\n- **Status**: DONE\n- **Owner**: Ana\n\n## R2 Second\n\n- Status: In progress\n';
const statuses = (paragraphs: Record<string, unknown>, text = PROGRESS) => indexProject({ 'a.md': text }, config({ statusSites: { ...structuredClone(DEFAULT_STATUS_SITES), paragraphs: { ...DEFAULT_STATUS_SITES.paragraphs, ...paragraphs } } }))
  .definitions.map(d => [d.id, d.authoredStatus?.evidence.map(e => e.value).join(', ')]);

test('list-item status labels give the owning definition its status when listItems is on', () => {
  assert.deepEqual(statuses({ listItems: true }), [['R1', 'DONE'], ['R2', 'In progress']]);
  assert.deepEqual(statuses({}), [['R1', undefined], ['R2', undefined]]);
  // List items that define IDs are not status sites.
  assert.deepEqual(statuses({ listItems: true }, '## R1 First\n\n- R2 Status: Done\n'), [['R1', undefined], ['R2', undefined]]);
  assert.deepEqual(validateStatusSites({ ...DEFAULT_STATUS_SITES, paragraphs: { ...DEFAULT_STATUS_SITES.paragraphs, listItems: true } }).paragraphs.listItems, true);
  assert.throws(() => validateStatusSites({ ...DEFAULT_STATUS_SITES, paragraphs: { ...DEFAULT_STATUS_SITES.paragraphs, listItems: 'yes' } }), /listItems must be boolean/);
});

test('checkboxOnly lists define only items with a task checkbox; other items refer', () => {
  const text = '- [ ] T001 Build\n- [-] T002 Test\n- T001 and T002 can run in parallel\n- T003 Plain\n';
  const index = (checkboxOnly?: boolean) => indexProject({ 'a.md': text }, config({ idDefinitionSites: { ...ALL_SITES, lists: { ...ALL_SITES.lists, ...(checkboxOnly === undefined ? {} : { checkboxOnly }) } } }));
  assert.deepEqual(index(true).definitions.map(d => d.id), ['T001', 'T002']);
  assert.deepEqual(index(true).references.map(d => d.id), ['T001', 'T002', 'T003']);
  assert.deepEqual(index().definitions.map(d => d.id), ['T001', 'T002', 'T001', 'T003']);
  assert.equal(validateIdDefinitionSites({ ...ALL_SITES, lists: { ...ALL_SITES.lists, checkboxOnly: false } }).lists!.checkboxOnly, undefined);
});

test('rejections name the site and the problem', () => {
  const { tables: _tables, ...noTables } = DEFAULT_ID_DEFINITION_SITES;
  assert.throws(() => validateIdDefinitionSites(noTables), { message: 'ID definition site tables must be an object.' });
  assert.throws(() => validateStatusSites({ ...DEFAULT_STATUS_SITES, paragraphs: 'Status:' }), { message: 'Status site paragraphs must be an object.' });
  // A regex paragraph status site does not need a label; a literal one does.
  const regex = validateStatusSites({ ...DEFAULT_STATUS_SITES, paragraphs: { enabled: true, mode: 'regex', pattern: '^State: (?<status>\\w+)' } });
  assert.equal(regex.paragraphs.label, 'Status:');
  assert.throws(() => validateStatusSites({ ...DEFAULT_STATUS_SITES, paragraphs: { enabled: true, mode: 'literal' } }), /Paragraph field label must contain/);
  // A capture spanning `**` names the captured text and advises narrowing it.
  assert.throws(() => statuses({ mode: 'regex', pattern: '^(?<status>DEFERRED until later)', label: undefined }, '## R1 First\n\n**DEFERRED** until later\n'),
    /Captured status "DEFERRED until later" has no reliable literal source span: .*must not span Markdown formatting such as \*\*.*Narrow the capture or use literal mode/);
});
