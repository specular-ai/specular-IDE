import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { DEFAULT_ID_DEFINITION_SITES } from '../src/core/definition-sites';
import { DEFAULT_CHECKBOX_MARKERS, DEFAULT_STATUS_SITES, validateStatusSites, type StatusSites } from '../src/core/status-sites';

// Increment 88: checkbox markers on ID-defining list items as authored statuses (DD-055).
const TASKS = '# Tasks\n\n- [x] 1. Write tests\n  - [X] 1.1 Unit tests\n  - [ ] 1.2 Integration tests\n- [-] 2. Phase one\n- [?] 3. Unknown marker\n- [ ] Not a task\n';
const sites = (checkboxes?: StatusSites['checkboxes']): StatusSites => ({ ...structuredClone(DEFAULT_STATUS_SITES), checkboxes });
const enabled = (markers = DEFAULT_CHECKBOX_MARKERS) => sites({ enabled: true, markers: { ...markers } });
const LISTS = { ...DEFAULT_ID_DEFINITION_SITES, lists: { enabled: true, types: ['unordered', 'ordered'], mode: 'start' } };
const config = (extra: Partial<IdConfiguration> = {}): IdConfiguration => validateIdConfiguration({
  version: 1, categories: [{ key: 'task', name: 'Tasks', role: 'task' }], rules: [{ key: 't', category: 'task', pattern: '^\\d+(?:\\.\\d+)*' }], idDefinitionSites: LISTS, ...extra,
});
const run = (configuration: IdConfiguration, documents: Record<string, string> = { 'tasks.md': TASKS }) => indexProject(documents, configuration);
const statuses = (configuration: IdConfiguration, documents?: Record<string, string>) =>
  run(configuration, documents).definitions.map(d => [d.id, d.authoredStatus?.evidence.map(e => e.display ?? e.value).join(', '), d.authoredStatus?.state]);
const pending = (configuration: IdConfiguration) => run(configuration).findings.filter(f => f.kind === 'pending').map(f => f.line);

test('checkbox markers on ID-defining items become statuses with the marker as evidence', () => {
  const configuration = config({ statusSites: enabled() });
  assert.deepEqual(statuses(configuration), [
    ['1', 'Done', 'authored'], ['1.1', 'Done', 'authored'], ['1.2', 'Open', 'authored'], ['2', 'In progress', 'authored'], ['3', undefined, undefined]]);
  for (const definition of run(configuration).definitions.filter(d => d.authoredStatus)) {
    const [evidence] = definition.authoredStatus!.evidence;
    assert.equal(evidence.site, 'checkboxes');
    assert.match(TASKS.slice(evidence.source.offset, evidence.source.end), /^\[[xX \-]\]$/);
  }
  // `[-]` and `N.` no longer hide the ID: the definition range is the number itself.
  const phase = run(configuration).definitions.find(d => d.id === '2')!;
  assert.equal(TASKS.slice(phase.offset, phase.end), '2');
});

test('the site is disabled by default, and mappings can be edited', () => {
  assert.deepEqual(statuses(config()).map(row => row[1]), [undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual(statuses(config({ statusSites: sites({ enabled: false, markers: { ...DEFAULT_CHECKBOX_MARKERS } }) })).map(row => row[1]), [undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual(statuses(config({ statusSites: enabled({ x: 'Complete', '?': 'Blocked' }) })).map(row => row[1]), ['Complete', undefined, undefined, undefined, 'Blocked']);
  // Mapped values go through the status list like other authored values.
  const listed = config({ statusSites: enabled(), statuses: [{ name: 'Finished', rules: [{ mode: 'exact', value: 'Done' }] }] });
  assert.deepEqual(statuses(listed).map(row => row[1]), ['Finished', 'Finished', 'Open', 'In progress', undefined]);
});

test('unchecked ID-defining items are Open instead of pending only while the site is enabled', () => {
  // Line 5 is `1.2` (an ID); line 8 is an unchecked item without an ID.
  assert.deepEqual(pending(config()), [5, 8]);
  assert.deepEqual(pending(config({ statusSites: enabled() })), [8]);
});

test('category overrides, status-specific sites, and conflicting duplicates behave as for other sites', () => {
  const override = config({ categories: [{ key: 'task', name: 'Tasks', role: 'task', statusSites: enabled() }] });
  assert.deepEqual(statuses(override)[0], ['1', 'Done', 'authored']);
  assert.deepEqual(pending(override), [8]);
  // A status with its own checkbox site accepts only values that map to it.
  const local = config({ statuses: [{ name: 'Done', statusSites: enabled() }] });
  assert.deepEqual(statuses(local).map(row => row[1]), ['Done', 'Done', undefined, undefined, undefined]);
  const duplicates = { 'a.md': '- [x] 4. First copy\n', 'b.md': '- [ ] 4. Second copy\n' };
  assert.deepEqual(statuses(config({ statusSites: enabled() }), duplicates).map(row => row[2]), ['conflict', 'conflict']);
});

test('start mode accepts `.` and `)` after a leading ID only before whitespace or the end', () => {
  const configuration = validateIdConfiguration({ version: 1, categories: [{ key: 'research', name: 'Research' }], rules: [{ key: 'r', category: 'research', prefix: 'R', separator: '' }], idDefinitionSites: LISTS });
  const defined = (text: string) => indexProject({ 'a.md': text }, configuration).definitions.map(d => d.id);
  assert.deepEqual(defined('## R1. simdutf port\n\n- R2) Second\n\n- R3.\n'), ['R1', 'R2', 'R3']);
  assert.deepEqual(defined('## R1.2 Title\n\n- R4.x is prose\n\n- R5.Title\n'), []);
});

test('invalid checkbox mappings are rejected', () => {
  const invalid = (markers: unknown) => () => validateStatusSites({ ...structuredClone(DEFAULT_STATUS_SITES), checkboxes: { enabled: true, markers } });
  assert.throws(invalid({ '': 'Done' }), /single character/);
  assert.throws(invalid({ xx: 'Done' }), /single character/);
  assert.throws(invalid({ ']': 'Done' }), /single character/);
  assert.throws(invalid({ x: ' ' }), /1-128 characters/);
  assert.throws(invalid(Object.fromEntries('abcdefghijklmnopq'.split('').map(c => [c, 'Done']))), /at most 16/);
  assert.throws(() => validateStatusSites({ ...structuredClone(DEFAULT_STATUS_SITES), checkboxes: { enabled: 'yes', markers: {} } }), /boolean/);
  // Configurations without the site stay valid.
  const { checkboxes, ...legacy } = structuredClone(DEFAULT_STATUS_SITES);
  assert.equal(validateStatusSites(legacy).checkboxes, undefined);
});
