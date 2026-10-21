import { mapStatuses } from '../src/core/statuses';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { validateIdConfiguration, LEGACY_ID_CONFIGURATION } from '../src/core/id-configuration';

test('statuses use only direct authored fields and retain exact evidence', () => {
  const text = '# REQ-1 One\nStatus: Confirmed\n\n## Notes\nStatus: Ignored\n\n# TASK-1 Task\n> Status: Quoted\n\n```md\nStatus: Code\n```\n\n- Status: List\n\nStatus: Completed\n\n| ID | Status | Description |\n| --- | --- | --- |\n| DD-1 | Draft | Decision |\n| DD-2 | | Missing |\n';
  const index = buildIndex([analyzeDocument('a.md', text)]);
  const status = (id: string) => index.definitions.find(d => d.id === id)!.authoredStatus;
  assert.deepEqual(status('REQ-1')!.evidence.map(e => e.value), ['Confirmed']);
  assert.deepEqual(status('TASK-1')!.evidence.map(e => e.value), ['Completed']);
  assert.deepEqual(status('DD-1')!.evidence.map(e => e.value), ['Draft']);
  assert.equal(status('DD-2'), undefined);
  assert.equal(buildIndex([analyzeDocument('long.md', '# REQ-9 Long\nStatus: ' + 'x'.repeat(4097))]).definitions[0].authoredStatus, undefined);
  const source = status('REQ-1')!.evidence[0].source;
  assert.equal(text.slice(source.offset, source.end), 'Status: Confirmed');
});
test('case variants agree; conflicting fields and duplicate definitions retain all values', () => {
  const first = analyzeDocument('a.md', '# REQ-1 One\nStatus: Confirmed\n\nStatus: confirmed\n\nREQ-1\n');
  assert.equal(buildIndex([first]).definitions[0].authoredStatus!.state, 'authored');
  const second = analyzeDocument('b.md', '# REQ-1 Duplicate\nStatus: Draft\n');
  const index = buildIndex([first, second]);
  assert.equal(index.definitions[0].authoredStatus!.state, 'conflict');
  assert.equal(index.references[0].authoredStatus!.evidence.length, 3);
  assert.equal(first.occurrences[0].authoredStatus!.evidence.length, 2);
  assert.ok(index.findings.some(f => f.kind === 'duplicate'));
  assert.equal(buildIndex([analyzeDocument('a.md', '# REQ-1 One\n')]).definitions[0].authoredStatus, undefined);
});
test('palette names are open, normalized and validated independently of categories', () => {
  const config = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, statuses: [{ name: ' Reviewed ', colors: { dark: '#AABBCC' } }] });
  assert.deepEqual(config.statuses, [{ name: 'Reviewed', colors: { dark: '#aabbcc' } }]);
  for (const statuses of [[{ name: 'Draft' }, { name: ' draft ' }], [{ name: '' }], [{ name: 'Draft', colors: { light: 'red' } }], [{ name: 'Draft', role: 'task' }]]) assert.throws(() => validateIdConfiguration({ ...config, statuses }));
  assert.equal(validateIdConfiguration(LEGACY_ID_CONFIGURATION).statuses, undefined);
  assert.deepEqual(validateIdConfiguration(JSON.parse(JSON.stringify({ ...config, statuses: [] }))).statuses, []);
  assert.throws(() => validateIdConfiguration({ ...config, statuses: [{ name: 'Draft' }, { name: ' draft ' }, { name: 'Done' }, { name: 'DONE' }] }), error => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /entry 1 "Draft" and entry 2 " draft "/);
    assert.match(error.message, /entry 3 "Done" and entry 4 "DONE"/);
    return true;
  });
});

test('status rules separate source text from display names, combine variants and reject ambiguous mappings', () => {
  const raw = buildIndex([analyzeDocument('a.md', '# REQ-1 One\nStatus: Implemented in increment 40.\n\nStatus: Implemented in increment 41.\n')]);
  const palettes = [{ name: 'Implemented', rules: [{ mode: 'startsWith' as const, value: 'implemented' }] }];
  const mapped = mapStatuses(raw, palettes);
  assert.equal(mapped.definitions[0].authoredStatus!.state, 'authored');
  assert.equal(mapped.definitions[0].authoredStatus!.evidence[0].display, 'Implemented');
  assert.equal(mapped.definitions[0].authoredStatus!.evidence[0].value, 'Implemented in increment 40.');
  assert.equal(raw.definitions[0].authoredStatus!.state, 'conflict');
  assert.throws(() => mapStatuses(raw, [...palettes, { name: 'Done', rules: [{ mode: 'regex', value: '^implemented.*$' }] }]), /Ambiguous/);
  assert.equal(mapStatuses(raw, [{ name: 'Done', rules: [{ mode: 'regex', value: '^implemented.*$' }] }]).definitions[0].authoredStatus!.evidence[0].display, 'Done');
  assert.equal(mapStatuses(raw, [{ name: 'Other' }]).definitions[0].authoredStatus!.evidence[0].display, 'Implemented in increment 40.');
  assert.throws(() => validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, statuses: [{ name: 'Done', rules: [{ mode: 'regex', value: '(' }] }] }), /regular expression/);
});
