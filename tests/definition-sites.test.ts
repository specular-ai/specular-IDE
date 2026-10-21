import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DEFAULT_ID_DEFINITION_SITES, type IdDefinitionSites } from '../src/core/definition-sites';
import { LEGACY_ID_CONFIGURATION, validateIdConfiguration, compileIdMatcher } from '../src/core/id-configuration';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { ProjectConfigurationStore } from '../src/core/project-configuration';
import { assignModules } from '../src/core/modules';
import { relationshipsFor } from '../src/core/relationships';

function sites(changes: { headings?: Partial<IdDefinitionSites['headings']>; tables?: Partial<IdDefinitionSites['tables']> } = {}): IdDefinitionSites {
  return { headings: { ...DEFAULT_ID_DEFINITION_SITES.headings, ...changes.headings }, tables: { ...DEFAULT_ID_DEFINITION_SITES.tables, ...changes.tables } };
}
function analyze(text: string, value = sites()) { return analyzeDocument('a.md', text, compileIdMatcher({ ...LEGACY_ID_CONFIGURATION, idDefinitionSites: value })); }
const definitions = (text: string, value = sites()) => analyze(text, value).occurrences.filter(o => o.kind === 'definition');

test('absent and explicit default sites retain heading/table definitions, statuses, ownership and source ranges', () => {
  const text = '# `REQ-01` Title\r\nStatus: Confirmed\r\nDD-1\r\n\r\n| Description | ID | Status |\r\n| --- | --- | --- |\r\n| REQ-01 | **DD-1** | Draft |\r\n';
  assert.deepEqual(analyze(text), analyzeDocument('a.md', text));
  for (const d of definitions(text)) assert.equal(text.slice(d.offset, d.end), d.id);
});

test('levels, disabled sites and anywhere placement keep other occurrences as references', () => {
  const text = '# REQ-1\n## Login (REQ-2)\n### REQ-3\n\n| ID | Text |\n| --- | --- |\n| REQ-4 | REQ-2 |\n';
  const configured = sites({ headings: { levels: [2], mode: 'anywhere' }, tables: { enabled: false } });
  const index = buildIndex([analyze(text, configured)]);
  assert.deepEqual(index.definitions.map(d => d.id), ['REQ-2']);
  assert.deepEqual(index.references.map(d => d.id), ['REQ-1', 'REQ-3', 'REQ-4', 'REQ-2']);
  assert.equal(index.findings.filter(f => f.kind === 'unresolved').length, 3);
  assert.equal(definitions(text, sites({ headings: { enabled: false }, tables: { enabled: false } })).length, 0);
  assert.equal(definitions(text, sites({ headings: { levels: [] }, tables: { enabled: false } })).length, 0);
  assert.throws(() => analyze('# REQ-1 and REQ-2', sites({ headings: { mode: 'anywhere' } })), /Line 1.*Ambiguous.*REQ-1.*REQ-2/);
});

test('advanced captures select exact occurrences through formatting, repeated IDs, CRLF and Unicode titles', () => {
  const text = '## Login **(REQ-123)** [Approved]\r\nStatus: Confirmed\r\n\r\n## REQ-9 before (REQ-9)\r\n';
  const config = sites({ headings: { mode: 'regex', pattern: '\\((?<id>REQ-\\d+)\\)' } });
  const model = analyze(text, config), ds = model.occurrences.filter(d => d.kind === 'definition');
  assert.deepEqual(ds.map(d => d.id), ['REQ-123', 'REQ-9']);
  assert.equal(ds[1].offset, text.lastIndexOf('REQ-9'));
  assert.equal(ds[0].authoredStatus?.evidence[0].value, 'Confirmed');
  for (const d of ds) assert.equal(text.slice(d.offset, d.end), d.id);
  const unicode = '# \u{1f680} login (REQ-5)'; const d = definitions(unicode, config)[0]; assert.equal(d.offset, unicode.indexOf('REQ-5'));
  assert.equal(definitions('# login (REQ-5)', sites({ headings: { mode: 'regex', pattern: 'LOGIN \\((?<id>REQ-\\d+)\\)', ignoreCase: true } })).length, 1);
  assert.throws(() => analyze('# (REQ-1) (REQ-2)', config), /Ambiguous definition/);
});

test('Key tables and captured cell IDs share ownership and status extraction with relationships and modules', () => {
  const text = '# REQ-1 Parent\n\n| Status | Key | Text |\n| --- | --- | --- |\n| Draft | (**DD-1**) | REQ-1 |\n| Confirmed | (`TASK-1`) | DD-1 |\n';
  const config = sites({ tables: { column: ' key ', mode: 'regex', pattern: '\\((?<id>[A-Z]+-\\d+)\\)' } });
  const model = analyze(text, config), index = buildIndex([model]);
  assert.deepEqual(index.definitions.map(d => d.id), ['REQ-1', 'DD-1', 'TASK-1']);
  assert.deepEqual(index.references.map(r => [r.id, r.owner?.id]), [['REQ-1', 'DD-1'], ['DD-1', 'TASK-1']]);
  assert.deepEqual(index.definitions.slice(1).map(d => d.authoredStatus?.evidence[0].value), ['Draft', 'Confirmed']);
  assert.ok(JSON.stringify(relationshipsFor(index, 'REQ-1')).includes('DD-1'));
  const assigned = assignModules(index, { modules: [{ key: 'ui', name: 'UI' }], moduleRules: [{ key: 'all', path: '.', scope: 'folder', modules: ['ui'] }] });
  assert.ok([...assigned.definitions, ...assigned.references].every(o => o.moduleAssignment?.modules[0].name === 'UI'));
  for (const o of model.occurrences) assert.equal(text.slice(o.offset, o.end), o.id);
});

test('renamed exact ID cells and selected headings preserve direct-status boundaries', () => {
  const text = '## Login REQ-1\nStatus: Confirmed\n### Notes\nStatus: Ignored\n\n| KEY | Status |\n| --- | --- |\n| REQ-2 | Draft |\n';
  const ds = definitions(text, sites({ headings: { mode: 'anywhere', levels: [2] }, tables: { column: 'Key' } }));
  assert.deepEqual(ds.map(d => [d.id, d.authoredStatus?.evidence.map(e => e.value)]), [['REQ-1', ['Confirmed']], ['REQ-2', ['Draft']]]);
});

test('category overrides replace the full site block while other categories inherit project sites', () => {
  const projectSites = sites({ headings: { levels: [2] }, tables: { enabled: false } });
  const tableOnly = sites({ headings: { enabled: false }, tables: { enabled: true, column: 'Requirement' } });
  const disabled = sites({ headings: { enabled: false }, tables: { enabled: false } });
  const categories = LEGACY_ID_CONFIGURATION.categories.map(category => category.key === 'REQ' ? { ...category, idDefinitionSites: tableOnly }
    : category.key === 'TASK' ? { ...category, idDefinitionSites: disabled } : category);
  const matcher = compileIdMatcher({ ...LEGACY_ID_CONFIGURATION, categories, idDefinitionSites: projectSites });
  const text = '## REQ-1 heading\n## DD-1 heading\n## TASK-1 heading\n\n| Requirement | Text |\n| --- | --- |\n| REQ-2 | DD-1 |\n';
  const index = buildIndex([analyzeDocument('a.md', text, matcher)]);
  assert.deepEqual(index.definitions.map(item => item.id), ['DD-1', 'REQ-2']);
  assert.deepEqual(index.references.map(item => item.id), ['REQ-1', 'TASK-1', 'DD-1']);
  assert.equal(index.references.at(-1)?.owner?.id, 'REQ-2');
  const assigned = assignModules(index, { modules: [{ key: 'all', name: 'All' }], moduleRules: [{ key: 'all-files', path: '.', scope: 'folder', modules: ['all'] }] });
  assert.ok(assigned.definitions.every(item => item.moduleAssignment?.modules[0].key === 'all'));
});

test('category override validation preserves inheritance, explicit disabling and renamed categories', () => {
  const override = sites({ headings: { enabled: false }, tables: { enabled: false } });
  const configured = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, categories: LEGACY_ID_CONFIGURATION.categories.map((category, index) => index === 0
    ? { ...category, name: 'Renamed requirements', idDefinitionSites: override } : category) });
  assert.deepEqual(configured.categories[0].idDefinitionSites, override);
  assert.equal(configured.categories[1].idDefinitionSites, undefined);
  for (const invalid of [{ ...override, bad: true }, { ...override, headings: { ...override.headings, levels: [7] } }]) {
    assert.throws(() => validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, categories: [{ ...LEGACY_ID_CONFIGURATION.categories[0], idDefinitionSites: invalid }] }));
  }
});
test('site patterns reject invalid/empty captures, unknown IDs and ambiguous columns', () => {
  for (const pattern of ['(', '(REQ-1)', '\\(\\?<id>REQ-1\\)', '[ (?<id> ]']) {
    assert.throws(() => validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, idDefinitionSites: sites({ headings: { mode: 'regex', pattern } }) }));
  }
  for (const pattern of ['(?<id>)', '(?<id>REQ-1)?x', '(?<id>REF-1)']) {
    assert.throws(() => analyze('# REQ-1 x REF-1', sites({ headings: { mode: 'regex', pattern } })), /empty|missing|recognition rule/);
  }
  assert.throws(() => analyze('| Key | KEY |\n| --- | --- |\n| REQ-1 | REQ-2 |', sites({ tables: { column: 'Key' } })), /ambiguous ID table columns/);
  for (const value of [sites({ headings: { levels: [0] } }), sites({ headings: { levels: [1, 1] } }), sites({ tables: { column: '' } }), sites({ headings: { pattern: 'x' } }), { ...sites(), other: true }]) {
    assert.throws(() => validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, idDefinitionSites: value }));
  }
});

test('encoded IDs, split captures, URL text, quotes, code and raw HTML cannot invent definitions', () => {
  const config = sites({ headings: { mode: 'regex', pattern: '(?<id>REQ-\\d+)' } });
  assert.throws(() => analyze('# REQ&#45;1', config), /literal source span/);
  assert.throws(() => analyze('# REQ-**1**', config), /literal source span/);
  assert.equal(definitions('# [Other](REQ-1)', config).length, 0);
  assert.equal(definitions('> # REQ-1\n\n```md\n# REQ-2\n```\n\n<div>REQ-3</div>', config).length, 0);
  const repeated = '# [REQ-1](REQ-1)'; assert.equal(definitions(repeated, config)[0].offset, repeated.indexOf('REQ-1'));
  assert.equal(definitions('# (REQ&#45;1) and REQ-1', sites({ headings: { mode: 'start' } })).length, 0);
});

test('site settings survive save/restart and explicit disabling; invalid or stale saves preserve configuration', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'specular-sites-'));
  try {
    const store = new ProjectConfigurationStore(root), initial = await store.load();
    const config = { ...LEGACY_ID_CONFIGURATION, idDefinitionSites: sites({ headings: { enabled: false }, tables: { enabled: false, column: 'Key' } }) };
    const saved = await store.save(config, initial.diskVersion);
    assert.deepEqual((await new ProjectConfigurationStore(root).load()).configuration, config);
    await assert.rejects(store.save({ ...config, idDefinitionSites: { ...config.idDefinitionSites, bad: true } }, saved.diskVersion));
    await assert.rejects(store.save(LEGACY_ID_CONFIGURATION, initial.diskVersion), /changed on disk/);
    assert.deepEqual(JSON.parse(await readFile(path.join(root, '.specular/project.json'), 'utf8')), config);
    await store.save(LEGACY_ID_CONFIGURATION, saved.diskVersion);
    assert.equal((await store.load()).configuration.idDefinitionSites, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
