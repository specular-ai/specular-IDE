import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { DEFAULT_STATUS_SITES, type StatusSites } from '../src/core/status-sites';
import { resolveStatusCandidates, statusExtractionLanes } from '../src/core/status-precedence';

const sites = (label: string, enabled = true): StatusSites => ({
  paragraphs: { enabled, mode: 'literal', label },
  tables: { enabled: false, mode: 'full', column: 'Status' },
  headings: { enabled: false, mode: 'regex', pattern: '\\[(?<status>[^\\]]+)\\]$' },
});
const configuration = (): IdConfiguration => ({
  version: 1,
  statusSites: sites('Status:'),
  categories: [{ key: 'req', name: 'Requirements' }, { key: 'dd', name: 'Design', statusSites: sites('State:') }],
  rules: [{ key: 'req', category: 'req', prefix: 'REQ' }, { key: 'dd', category: 'dd', prefix: 'DD' }],
  statuses: [
    { name: 'Draft' },
    { name: 'Done', rules: [{ mode: 'startsWith', value: 'Implemented' }], statusSites: sites('Outcome:') },
  ],
});
const candidate = (value: string) => ({ value, evidence: value });

test('project, category and status extraction lanes use complete replacement and preserve explicit disabling', () => {
  const config = validateIdConfiguration(configuration());
  assert.equal(statusExtractionLanes(config, config.categories[0])[0].sites.paragraphs.label, 'Status:');
  assert.equal(statusExtractionLanes(config, config.categories[1])[0].sites.paragraphs.label, 'State:');
  assert.deepEqual(statusExtractionLanes(config, config.categories[1]).map(lane => [lane.scope, lane.status, lane.sites.paragraphs.label]), [
    ['baseline', undefined, 'State:'], ['status', 'Done', 'Outcome:'],
  ]);
  config.categories[1].statusSites = sites('State:', false);
  assert.equal(statusExtractionLanes(config, config.categories[1])[0].sites.paragraphs.enabled, false);
});

test('status overrides replace baseline extraction only for their mapped status', () => {
  const palettes = configuration().statuses!;
  const result = resolveStatusCandidates(
    [candidate('Draft'), candidate('Implemented before override'), candidate('Unregistered')],
    new Map([['Done', [candidate('Implemented locally'), candidate('Draft'), candidate('Unknown local')]]]), palettes);
  assert.deepEqual(result.candidates.map(item => [item.value, item.display, item.scope]), [
    ['Draft', 'Draft', 'baseline'], ['Unregistered', 'Unregistered', 'baseline'], ['Implemented locally', 'Done', 'status'],
  ]);
  assert.equal(result.state, 'conflict');
});

test('agreeing candidates remain authored evidence while different resolved values conflict', () => {
  const palettes = configuration().statuses!;
  const agreeing = resolveStatusCandidates([candidate('Draft'), candidate('draft')], new Map(), palettes);
  assert.equal(agreeing.state, 'authored');
  assert.equal(agreeing.candidates.length, 2);
  const conflict = resolveStatusCandidates([candidate('Draft'), candidate('Unregistered')], new Map(), palettes);
  assert.equal(conflict.state, 'conflict');
});

test('empty palettes retain baseline values and overlapping mappings fail independently of editor order', () => {
  const empty = resolveStatusCandidates([candidate('Free form')], new Map(), []);
  assert.deepEqual(empty.candidates.map(item => item.display), ['Free form']);
  assert.equal(resolveStatusCandidates([], new Map(), []).state, 'none');
  for (const palettes of [
    [{ name: 'First', rules: [{ mode: 'startsWith' as const, value: 'Done' }] }, { name: 'Second', rules: [{ mode: 'exact' as const, value: 'Done' }] }],
    [{ name: 'Second', rules: [{ mode: 'exact' as const, value: 'Done' }] }, { name: 'First', rules: [{ mode: 'startsWith' as const, value: 'Done' }] }],
  ]) assert.throws(() => resolveStatusCandidates([candidate('Done')], new Map(), palettes), /Ambiguous status mapping.*First.*Second|Ambiguous status mapping.*Second.*First/);
});

test('schema round-trips complete category and status overrides and distinguishes absence from disabled', () => {
  const config = validateIdConfiguration(configuration());
  assert.equal(config.categories[0].statusSites, undefined);
  assert.equal(config.categories[1].statusSites?.paragraphs.label, 'State:');
  assert.equal(config.statuses?.[1].statusSites?.paragraphs.label, 'Outcome:');
  const disabled = configuration(); disabled.statuses![1].statusSites = sites('Outcome:', false);
  assert.equal(validateIdConfiguration(disabled).statuses?.[1].statusSites?.paragraphs.enabled, false);
});
