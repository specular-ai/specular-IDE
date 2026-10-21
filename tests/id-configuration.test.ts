import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { compileIdMatcher, validateIdConfiguration, LEGACY_ID_CONFIGURATION, type IdConfiguration } from '../src/core/id-configuration';
import { ProjectConfigurationStore } from '../src/core/project-configuration';
import { Workspace } from '../src/core/workspace';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { captureBriefSource } from '../src/core/briefs';
import { budgetText, IndexWorker, recognitionBudget, type AnalysisWorker, type IndexRequest, type IndexResponse } from '../src/core/index-worker';

export const custom: IdConfiguration = { version: 1, categories: [{ key: 'requirements', name: 'Requirements', role: 'requirement' }],
  rules: [{ key: 'reference', category: 'requirements', prefix: 'REF' },
    { key: 'named', category: 'requirements', pattern: '(?<![\\w/])feature/[a-z]+(?![\\w/])' }] };
test('custom rules replace defaults, retain spelling and numeric padding, and preserve heading/table ownership', () => {
  const text = '# REF-01 First\r\nREF-01 and feature/login.\r\n\r\n| ID | Name |\r\n| --- | --- |\r\n| feature/login | REF-01 |\r\nREQ-01\r\n';
  const model = analyzeDocument('a.md', text, compileIdMatcher(custom));
  assert.deepEqual(model.occurrences.filter(item => item.kind === 'definition').map(item => item.id), ['REF-01', 'feature/login']);
  assert.ok(model.occurrences.every(item => text.slice(item.offset, item.end) === item.id));
  assert.equal(model.occurrences.find(item => item.kind === 'reference' && item.line === 6)?.owner?.id, 'feature/login');
  assert.ok(!model.occurrences.some(item => item.id === 'REQ-01'));
  assert.deepEqual(buildIndex([model]).findings, []);
  assert.deepEqual(captureBriefSource('a.md', text, 0, text.length, true, false, model.occurrences).ids, ['REF-01', 'feature/login']);
});
test('legacy recognition is unchanged; explicit empty rules disable recognition', () => {
  const text = '# REQ-001\nDD-02 TASK-3 Q-4 IP-5 PH-6 AT-7 US-8 STORY-9 SM-10 STATE-11 REF-1 req-1';
  assert.equal(analyzeDocument('a.md', text).occurrences.length, 11);
  assert.equal(analyzeDocument('a.md', text, compileIdMatcher({ version: 1, categories: [], rules: [] })).occurrences.length, 0);
});
test('case-insensitive recognition does not normalize identity and advanced patterns own their boundaries', () => {
  const config = { ...custom, rules: [{ ...custom.rules[0], ignoreCase: true }] };
  const model = analyzeDocument('a.md', '# REF-01\nref-01 REF-1 REF-01', compileIdMatcher(config));
  assert.deepEqual(buildIndex([model]).findings.map(item => item.message), ['No definition found for ref-01.', 'No definition found for REF-1.']);
  const match = compileIdMatcher({ ...custom, rules: [{ key: 'literal', category: 'requirements', pattern: '@x:[a-z]+' }] });
  assert.equal(match('(@x:alpha)')[0].id, '@x:alpha');
});
test('quotes, code examples, and encoded headings cannot invent custom definitions; Mermaid keeps references', () => {
  const text = '# REF&#45;01\n> # REF-02\n\n```md\n# REF-03\n```\n\n# `REF-04`\nA `REF-04` reference.\n```mermaid\ngraph LR\nA[REF-04]\n```';
  const model = analyzeDocument('a.md', text, compileIdMatcher(custom));
  assert.deepEqual(model.occurrences.map(item => [item.id, item.kind]), [['REF-04', 'definition'], ['REF-04', 'reference'], ['REF-04', 'reference']]);
  assert.ok(model.occurrences.every(item => text.slice(item.offset, item.end) === item.id));
});
test('schema rejects malformed, oversized, unknown, and duplicate rules and categories', () => {
  for (const value of [null, { ...custom, version: 2 }, { ...custom, extra: true },
    { ...custom, categories: [...custom.categories, ...custom.categories] },
    { ...custom, rules: [custom.rules[0], custom.rules[0]] },
    { ...custom, rules: [{ ...custom.rules[0], category: 'missing' }] },
    { ...custom, rules: [{ ...custom.rules[0], pattern: 'x' }] },
    { ...custom, rules: [{ key: 'bad', category: 'requirements', pattern: '(' }] },
    { ...custom, rules: Array(65).fill(custom.rules[0]) }]) assert.throws(() => validateIdConfiguration(value));
});
test('zero-length and overlapping matches fail as a whole with rule evidence', () => {
  assert.throws(() => compileIdMatcher({ ...custom, rules: [{ key: 'empty', category: 'requirements', pattern: 'a*' }] }), /empty/);
  const contextual = compileIdMatcher({ ...custom, rules: [{ key: 'empty', category: 'requirements', pattern: '(?=REF)' }] });
  assert.throws(() => contextual('REF'), /empty/);
  const match = compileIdMatcher({ ...custom, rules: [...custom.rules, { key: 'overlap', category: 'requirements', pattern: 'REF-\\d+' }] });
  assert.throws(() => analyzeDocument('a.md', '# REF-01', match), /Rules 1 and 3 overlap/);
});
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'specular-config-'));
  await mkdir(path.join(root, '.specular'));
  return { root, file: path.join(root, '.specular/project.json'), store: new ProjectConfigurationStore(root) };
}
test('configuration reload retains last valid rules on error; deletion restores defaults and isolates projects', async () => {
  const a = await fixture(), b = await fixture();
  try {
    const absent = await a.store.load(); assert.deepEqual(absent.configuration, LEGACY_ID_CONFIGURATION);
    await writeFile(a.file, JSON.stringify(custom)); const valid = await a.store.load(); assert.notEqual(valid.revision, absent.revision);
    await writeFile(a.file, '{"key":"privateCategory",bad}'); const invalid = await a.store.load();
    assert.equal(invalid.revision, valid.revision); assert.match(invalid.warning!, /last valid/);
    assert.match(invalid.warning!, /Invalid JSON/); assert.ok(!invalid.warning!.includes('privateCategory'));
    const firstInvalid = await new ProjectConfigurationStore(a.root).load(); assert.deepEqual(firstInvalid.configuration, LEGACY_ID_CONFIGURATION);
    assert.deepEqual((await b.store.load()).configuration, LEGACY_ID_CONFIGURATION);
    await rm(a.file); assert.equal((await a.store.load()).revision, absent.revision);
  } finally { await rm(a.root, { recursive: true, force: true }); await rm(b.root, { recursive: true, force: true }); }
});
test('configuration saves detect external changes, preserve failed drafts, serialize writers, and reload on restart', async () => {
  const f = await fixture();
  try {
    const state = await f.store.save(custom, 'absent');
    assert.deepEqual((await new ProjectConfigurationStore(f.root).load()).configuration, custom);
    await writeFile(f.file, JSON.stringify(LEGACY_ID_CONFIGURATION)); const before = await readFile(f.file, 'utf8');
    await assert.rejects(f.store.save(custom, state.diskVersion), /changed on disk/);
    assert.equal(await readFile(f.file, 'utf8'), before);
    const now = await f.store.load();
    await assert.rejects(f.store.save({ ...custom, version: 99 }, now.diskVersion));
    assert.equal(await readFile(f.file, 'utf8'), before);
    const results = await Promise.allSettled([f.store.save(custom, now.diskVersion), f.store.save(custom, now.diskVersion)]);
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('workspace discovers configuration separately while leaving .specular excluded', async () => {
  const f = await fixture();
  try {
    await writeFile(f.file, JSON.stringify(custom)); await writeFile(path.join(f.root, 'a.md'), '# REF-01');
    const workspace = await Workspace.open(f.root), snapshot = await workspace.snapshot();
    assert.deepEqual(snapshot.idConfiguration?.configuration, custom);
    assert.deepEqual(snapshot.files.map(file => file.path), ['a.md']);
    await assert.rejects(workspace.read('.specular/project.json'), /excluded/);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('configuration Apply rejects stale Markdown, changed projects and malformed preview versions', async () => {
  const f = await fixture();
  try {
    const markdown = path.join(f.root, 'a.md'); await writeFile(markdown, '# REF-01');
    const workspace = await Workspace.open(f.root), preview = await workspace.snapshot();
    await writeFile(markdown, '# REF-02');
    await assert.rejects(workspace.saveConfiguration(custom, 'absent', preview.documentVersions), /Markdown changed/);
    await assert.rejects(readFile(f.file));
    const fresh = await workspace.snapshot();
    await assert.rejects(workspace.saveConfiguration(custom, 'absent', fresh.documentVersions, () => false), /active project changed/);
    await assert.rejects(workspace.saveConfiguration(custom, 'absent', { 'a.md': 'not-a-version' }), /Invalid/);
    const saved = await workspace.saveConfiguration(custom, 'absent', fresh.documentVersions);
    assert.deepEqual(saved.configuration, custom);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
test('configuration refuses external directory junctions', async () => {
  const a = await fixture(), b = await fixture();
  try {
    await rm(path.join(a.root, '.specular'), { recursive: true });
    await symlink(path.join(b.root, '.specular'), path.join(a.root, '.specular'), 'junction');
    assert.match((await a.store.load()).warning!, /real project directory/);
    await assert.rejects(a.store.save(custom, 'absent'), /real project directory/);
  } finally { await rm(a.root, { recursive: true, force: true }); await rm(b.root, { recursive: true, force: true }); }
});
test('index worker terminates slow or obsolete work, ignores late results, and can retry', async () => {
  const workers: (AnalysisWorker & { stopped: boolean })[] = [], responses: IndexResponse[] = [];
  const host = new IndexWorker(() => {
    const worker = { onmessage: null, onerror: null, postMessage: (_: IndexRequest) => {}, stopped: false, terminate() { this.stopped = true; } };
    workers.push(worker); return worker;
  }, response => responses.push(response), 20);
  host.run({ revision: 1, documents: {} }); const late = workers[0].onmessage!;
  host.run({ revision: 2, documents: {} }); assert.equal(workers[0].stopped, true);
  late({ data: { revision: 1 } } as MessageEvent<IndexResponse>);
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(workers[1].stopped, true); assert.equal(responses.length, 1); assert.equal(responses[0].revision, 2); assert.match(responses[0].error!, /stopped/);
  host.run({ revision: 3, documents: {} });
  workers[2].onmessage!({ data: { revision: 3, index: buildIndex([]) } } as MessageEvent<IndexResponse>);
  assert.equal(responses.length, 2); host.cancel();
});

test('the recognition budget follows the request size within 5 and 30 seconds', (t) => {
  assert.deepEqual([0, 1_000_000, 13_500_000, 20_000_000, 40_000_000].map(recognitionBudget), [5000, 6000, 18_500, 25_000, 30_000]);
  assert.equal(budgetText(18_500, 13_500_000), '18.5-second limit for 13.5 million characters');
  assert.equal(budgetText(5000, 2_400), '5-second limit for 2,400 characters');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const responses: IndexResponse[] = [], workers: { stopped: boolean }[] = [];
  const host = new IndexWorker(() => {
    const worker = { onmessage: null, onerror: null, postMessage: (_: IndexRequest) => {}, stopped: false, terminate() { this.stopped = true; } };
    workers.push(worker); return worker;
  }, response => responses.push(response));
  // A worker that never answers is stopped after the scaled budget and not before.
  host.run({ revision: 1, documents: { 'a.md': 'a'.repeat(9_000_000), 'b.md': 'b'.repeat(4_500_000) } });
  t.mock.timers.tick(18_499); assert.equal(responses.length, 0);
  t.mock.timers.tick(1); assert.equal(workers[0].stopped, true);
  assert.match(responses[0].error!, /exceeded its 18\.5-second limit for 13\.5 million characters and was stopped/);
  // A small project, for example with a slow regex, is still stopped after about 5 seconds.
  host.run({ revision: 2, documents: { 'a.md': 'REQ-1' } });
  t.mock.timers.tick(4999); assert.equal(responses.length, 1);
  t.mock.timers.tick(1); assert.match(responses[1].error!, /exceeded its 5-second limit for 5 characters/);
});

test('prefix separators retain legacy hyphens and support underscore and adjacent digits', () => {
  const text = 'REF-1 REF-01 REF1 REF01 REF_01 XREF1 REF01x';
  for (const [separator, expected] of [[undefined, ['REF-1', 'REF-01']], ['-', ['REF-1', 'REF-01']], ['_', ['REF_01']], ['', ['REF1', 'REF01']]] as const) {
    const config = { ...custom, rules: [{ ...custom.rules[0], separator }] };
    assert.deepEqual(compileIdMatcher(config)(text).map(item => item.id), expected);
    assert.deepEqual(validateIdConfiguration(JSON.parse(JSON.stringify(config))).rules[0], validateIdConfiguration(config).rules[0]);
  }
  assert.throws(() => validateIdConfiguration({ ...custom, rules: [{ ...custom.rules[0], separator: '.' }] }), /Separator/);
  assert.throws(() => validateIdConfiguration({ ...custom, rules: [{ ...custom.rules[1], separator: '-' }] }), /Separator/);
});
