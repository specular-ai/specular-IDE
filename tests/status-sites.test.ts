import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, LEGACY_ID_CONFIGURATION, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { DEFAULT_ID_DEFINITION_SITES } from '../src/core/definition-sites';
import { DEFAULT_STATUS_SITES, type StatusSites } from '../src/core/status-sites';
import { mapStatuses } from '../src/core/statuses';
import { ProjectConfigurationStore } from '../src/core/project-configuration';

const sites = (changes: { [K in keyof StatusSites]?: Partial<StatusSites[K]> } = {}): StatusSites => ({
  paragraphs: { ...DEFAULT_STATUS_SITES.paragraphs, ...changes.paragraphs },
  tables: { ...DEFAULT_STATUS_SITES.tables, ...changes.tables },
  headings: { ...DEFAULT_STATUS_SITES.headings, ...changes.headings },
});
const config = (statusSites?: StatusSites): IdConfiguration => ({ ...LEGACY_ID_CONFIGURATION, ...(statusSites ? { statusSites } : {}) });
const index = (text: string, configuration = config()) => mapStatuses(buildIndex([analyzeDocument('a.md', text, compileIdMatcher(configuration))]), configuration.statuses ?? []);
const values = (text: string, configuration = config()) => index(text, configuration).definitions.map(d => [d.id, d.authoredStatus?.evidence.map(e => e.value), d.authoredStatus?.state]);

test('absent and explicit defaults preserve legacy fields, boundaries, exclusions and node evidence', () => {
  const text = '# REQ-1 [Approved]\r\n**sTaTuS:**  Confirmed \r\n\r\nStatus: confirmed\r\n\r\n## Notes\r\nStatus: Ignored\r\n\r\n# REQ-2\r\n> Status: Quoted\r\n\r\n- Status: Listed\r\n\r\n~~~\r\nStatus: Code\r\n~~~\r\n\r\nStatus: Multiline\r\nprose\r\n\r\n| ID | STATUS | Status | Text |\r\n| --- | --- | --- | --- |\r\n| DD-1 | **Draft** | Done | REQ-1 |\r\n| DD-2 | | | Missing |\r\n';
  assert.deepEqual(index(text, config(sites())), index(text));
  assert.deepEqual(values(text), [['REQ-1', ['Confirmed', 'confirmed'], 'authored'], ['REQ-2', ['Multiline'], 'authored'], ['DD-1', ['Draft', 'Done'], 'conflict'], ['DD-2', undefined, undefined]]);
  const source = index(text).definitions[0].authoredStatus!.evidence[0].source;
  assert.equal(text.slice(source.offset, source.end), '**sTaTuS:**  Confirmed ');
});

test('a literal status paragraph continued on the next line reads its first line, with LF or CRLF endings (increment 87a)', () => {
  for (const eol of ['\n', '\r\n']) {
    const text = ['### DD-001 - Decision', '', 'Status: Confirmed.', 'Related requirements: REQ-001, REQ-003.', '', '**Decision:** Build it.', ''].join(eol);
    assert.deepEqual(values(text), [['DD-001', ['Confirmed.'], 'authored']]);
    const source = index(text).definitions[0].authoredStatus!.evidence[0].source;
    assert.ok(text.slice(source.offset, source.end).startsWith('Status: Confirmed.'));
  }
  // The label must still start the paragraph.
  assert.deepEqual(values('# REQ-1\nNotes first\nStatus: Draft\n'), [['REQ-1', undefined, undefined]]);
});

test('literal State paragraphs and Progress cells follow configured ID headings and Key rows', () => {
  const configuration: IdConfiguration = { ...config(sites({ paragraphs: { label: ' State: ' }, tables: { column: ' progress ' } })),
    idDefinitionSites: { headings: { ...DEFAULT_ID_DEFINITION_SITES.headings, levels: [2], mode: 'anywhere' }, tables: { ...DEFAULT_ID_DEFINITION_SITES.tables, column: 'Key' } },
    statuses: [{ name: 'Ready', rules: [{ mode: 'startsWith', value: 'approved' }], colors: { light: '#123456' } }] };
  const text = '# REQ-0\nState: Ignored\n## Login (REQ-1)\nsTaTe: Approved today\n\n### Child\nState: Ignored\n\n| Key | Progress | Text |\n| --- | --- | --- |\n| REQ-2 | Approved | REQ-1 |\n| ordinary | Ignored | REQ-3 |\n';
  const result = index(text, configuration);
  assert.deepEqual(result.definitions.map(d => d.id), ['REQ-1', 'REQ-2']);
  assert.deepEqual(result.definitions.map(d => d.authoredStatus!.evidence.map(e => [e.value, e.display, e.site])), [[['Approved today', 'Ready', 'paragraphs']], [['Approved', 'Ready', 'tables']]]);
  assert.equal(result.references.find(r => r.id === 'REQ-3')?.authoredStatus, undefined);
  assert.deepEqual(values('# REQ-1\nState[+]: Draft\n\nStateeee: Wrong', config(sites({ paragraphs: { label: 'State[+]:' } })))[0][1], ['Draft']);
});

test('advanced heading, paragraph and table captures retain exact UTF-16 spans, formatting and CRLF locations', () => {
  const configuration: IdConfiguration = { ...config(sites({
    headings: { enabled: true },
    paragraphs: { mode: 'regex', pattern: '^state:\\s*(?<status>.+)$', ignoreCase: true },
    tables: { mode: 'regex', pattern: '\\((?<status>[^)]+)\\)', column: 'Progress' },
  })), idDefinitionSites: { headings: { ...DEFAULT_ID_DEFINITION_SITES.headings, mode: 'anywhere' }, tables: { ...DEFAULT_ID_DEFINITION_SITES.tables, column: 'Key' } } };
  const text = '## \u{1f680} Login (REQ-123) [**Approved**]\r\nState: **Approved** \r\n\r\n| Key | Progress |\r\n| --- | --- |\r\n| REQ-2 | Done (**Draft**) |\r\n';
  const result = index(text, configuration);
  assert.deepEqual(result.definitions.map(d => d.authoredStatus!.evidence.map(e => [e.value, e.site])), [[['Approved', 'headings'], ['Approved', 'paragraphs']], [['Draft', 'tables']]]);
  for (const d of result.definitions) for (const e of d.authoredStatus!.evidence) {
    assert.equal(text.slice(e.source.offset, e.source.end), e.value);
    const before = text.slice(0, e.source.offset).split('\n');
    assert.equal(e.source.line, before.length); assert.equal(e.source.column, before.at(-1)!.length + 1);
  }
  assert.equal(result.definitions[0].authoredStatus!.state, 'authored');
});

test('each site disables independently; heading/paragraph and duplicate conflicts keep every value without precedence', () => {
  const text = '# REQ-1 [Approved]\nStatus: Draft\n\n| ID | Status |\n| --- | --- |\n| REQ-2 | Done |\n';
  for (const kind of ['headings', 'paragraphs', 'tables'] as const) {
    const settings = sites({ headings: { enabled: true } }); settings[kind].enabled = false;
    const result = index(text, config(settings));
    assert.ok(result.definitions.every(d => d.authoredStatus?.evidence.every(e => e.site !== kind) ?? true));
    assert.equal(result.definitions.flatMap(d => d.authoredStatus?.evidence ?? []).length, 2);
  }
  const disabled = config(sites({ headings: { enabled: false }, paragraphs: { enabled: false }, tables: { enabled: false } }));
  disabled.statuses = [{ name: 'Done' }];
  assert.ok(index(text, disabled).definitions.every(d => !d.authoredStatus));
  const active = config(sites({ headings: { enabled: true } })); active.statuses = [];
  assert.equal(index(text, active).definitions[0].authoredStatus!.state, 'conflict');
  const repeated = buildIndex([analyzeDocument('a.md', '# REQ-1 [Approved]', compileIdMatcher(active)), analyzeDocument('b.md', '# REQ-1\nStatus: Draft', compileIdMatcher(active))]);
  assert.ok(repeated.definitions.every(d => d.authoredStatus!.state === 'conflict' && d.authoredStatus!.evidence.length === 2));
  assert.equal(index('## Ordinary [Approved]\nStatus: Draft', active).definitions.length, 0);
});

test('status-site schema rejects malformed patterns, absent captures and invalid options', () => {
  for (const pattern of ['(', '(Draft)', '\\(\\?<status>Draft\\)', '[(?<status>]']) {
    assert.throws(() => validateIdConfiguration(config(sites({ headings: { pattern } }))), /regular expression|named/);
  }
  for (const settings of [
    { ...sites(), other: true }, sites({ paragraphs: { mode: ['literal'] as any } }), sites({ headings: { mode: ['regex'] as any } }), sites({ paragraphs: { label: '' } }), sites({ tables: { column: '\n' } }),
    sites({ tables: { pattern: '(?<status>.+)' } }), sites({ headings: { pattern: 'x'.repeat(513) } }),
    sites({ headings: { ignoreCase: 'yes' as any } }), sites({ paragraphs: { enabled: 1 as any } }),
  ]) assert.throws(() => validateIdConfiguration(config(settings)));
});

test('advanced empty, missing, split and encoded captures fail the entire analysis', () => {
  for (const pattern of ['(?<status>)', '(?<status>Draft)?Approved', '(?<status>\\s+)']) {
    assert.throws(() => index('# REQ-1 [Approved]', config(sites({ headings: { enabled: true, pattern } }))), /empty or missing/);
  }
  for (const text of ['# REQ-1 [Appr&#111;ved]', '# REQ-1 [Appr**oved**]']) {
    assert.throws(() => index(text, config(sites({ headings: { enabled: true } }))), /literal source span/);
  }
  const configuration = config(sites({ headings: { enabled: true, pattern: '\\[(?<status>[^\\]]+)\\]' } }));
  const text = '# REQ-1 [Draft] [Draft]';
  const evidence = index(text, configuration).definitions[0].authoredStatus!.evidence;
  assert.deepEqual(evidence.map(e => e.source.offset), [text.indexOf('Draft'), text.lastIndexOf('Draft')]);
  assert.deepEqual(values('# REQ-1 [Draft] [Done]', configuration)[0][1], ['Draft', 'Done']);
});

test('bounded values and output reject incomplete advanced results, retaining legacy long-prose behavior', () => {
  assert.equal(index('# REQ-1\nStatus: ' + 'x'.repeat(4096)).definitions[0].authoredStatus!.evidence[0].value.length, 4096);
  assert.equal(index('# REQ-1\nStatus: ' + 'x'.repeat(4097)).definitions[0].authoredStatus, undefined);
  assert.throws(() => index('# REQ-1 [' + 'x'.repeat(4097) + ']', config(sites({ headings: { enabled: true } }))), /1-4096/);
  assert.throws(() => index('# REQ-1\none\ntwo', config(sites({ paragraphs: { mode: 'regex', pattern: '(?<status>[\\s\\S]+)' } }))), /one line/);
  assert.throws(() => index('# REQ-1 ' + '[x] '.repeat(257), config(sites({ headings: { enabled: true, pattern: '\\[(?<status>[^\\]]+)\\]' } }))), /256/);
  assert.throws(() => index('# REQ-1\n\n' + 'Status: Draft\n\n'.repeat(257)), /256/);
});

test('status sites and empty palettes persist, reject stale/invalid saves, and restore absent defaults independently', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'specular-status-sites-'));
  try {
    const store = new ProjectConfigurationStore(root), initial = await store.load();
    const configuration = config(sites({ headings: { enabled: true }, tables: { enabled: false }, paragraphs: { enabled: false } }));
    configuration.statuses = [];
    const saved = await store.save(configuration, initial.diskVersion);
    assert.deepEqual((await new ProjectConfigurationStore(root).load()).configuration, configuration);
    await assert.rejects(store.save(config(), initial.diskVersion), /changed on disk/);
    await assert.rejects(store.save({ ...configuration, statusSites: { ...configuration.statusSites, invalid: true } }, saved.diskVersion));
    assert.deepEqual(JSON.parse(await readFile(path.join(root, '.specular/project.json'), 'utf8')), configuration);
    const reset = { ...configuration }; delete reset.statusSites;
    await store.save(reset, saved.diskVersion);
    assert.deepEqual((await store.load()).configuration, reset);
  } finally { await rm(root, { recursive: true, force: true }); }
});
