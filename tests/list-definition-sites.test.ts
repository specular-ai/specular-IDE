import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ID_DEFINITION_SITES, type IdDefinitionSites } from '../src/core/definition-sites';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { assignModules } from '../src/core/modules';
import { relationshipsFor } from '../src/core/relationships';

const listSites = (types: ('unordered' | 'ordered')[] = ['unordered', 'ordered']): IdDefinitionSites => ({
  headings: { ...DEFAULT_ID_DEFINITION_SITES.headings, enabled: false },
  tables: { ...DEFAULT_ID_DEFINITION_SITES.tables, enabled: false },
  lists: { enabled: true, types, mode: 'start' },
});
const configuration = (sites: IdDefinitionSites = listSites()): IdConfiguration => ({
  version: 1, idDefinitionSites: sites,
  categories: [{ key: 'fr', name: 'Functional requirements', role: 'requirement' }, { key: 'dd', name: 'Design', role: 'design' }, { key: 'req', name: 'Requirements', role: 'requirement' }, { key: 'task', name: 'Tasks', role: 'task' }],
  rules: [{ key: 'fr', category: 'fr', prefix: 'FR' }, { key: 'dd', category: 'dd', prefix: 'DD' }, { key: 'req', category: 'req', prefix: 'REQ' }, { key: 'task', category: 'task', prefix: 'TASK' }],
});
const index = (text: string, config = configuration()) => buildIndex([analyzeDocument('a.md', text, compileIdMatcher(config))]);

test('the supplied emphasized FR list produces exact navigable definitions', () => {
  const text = `### Functional Requirements

- **FR-001**: Projects/Project.swift MUST define a SchnorrVectorTests target
- **FR-002**: The compatibility table MUST map versions
- **FR-003**: Version ranges MUST use Swift syntax
- **FR-004**: CI MUST test supported Swift versions
- **FR-005**: CI MUST open a pull request
`;
  const result = index(text);
  assert.deepEqual(result.definitions.map(item => item.id), ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005']);
  for (const item of result.definitions) assert.equal(text.slice(item.offset, item.end), item.id);
  assert.equal(result.findings.length, 0);
});

test('only a leading plain or emphasized first-paragraph ID defines a list item', () => {
  const text = `- FR-001: definition mentioning FR-002
- **FR-003**: emphasized
- See FR-004 for details
- \`FR-005\`: inline-code example
- Ordinary first line

  FR-006 later in the first paragraph

> - FR-007: quoted example

~~~md
- FR-008: fenced example
~~~
`;
  const result = index(text);
  assert.deepEqual(result.definitions.map(item => item.id), ['FR-001', 'FR-003']);
  assert.deepEqual(result.references.map(item => item.id), ['FR-002', 'FR-004', 'FR-005', 'FR-006']);
  assert.deepEqual(result.references.map(item => item.owner?.id), ['FR-001', undefined, undefined, undefined]);
});

test('ordered, nested, continuation and task-list items have deterministic ownership', () => {
  const text = `1. REQ-1: parent mentions DD-9

   - DD-1: child references REQ-1
   - See TASK-9

2. REQ-2: sibling

- [ ] **TASK-1**: implement REQ-2
`;
  const result = index(text);
  assert.deepEqual(result.definitions.map(item => item.id), ['REQ-1', 'DD-1', 'REQ-2', 'TASK-1']);
  assert.deepEqual(result.references.map(item => [item.id, item.owner?.id]), [['DD-9', 'REQ-1'], ['REQ-1', 'DD-1'], ['TASK-9', 'REQ-1'], ['REQ-2', 'TASK-1']]);
  assert.ok(result.findings.some(item => item.kind === 'pending' && item.message.includes('TASK-1')));
  assert.ok(JSON.stringify(relationshipsFor(result, 'REQ-1')).includes('DD-1'));
  const assigned = assignModules(result, { modules: [{ key: 'all', name: 'All' }], moduleRules: [{ key: 'all', path: '.', scope: 'folder', modules: ['all'] }] });
  assert.ok(assigned.definitions.every(item => item.moduleAssignment?.modules[0].key === 'all'));
});

test('list types and category replacement blocks apply independently', () => {
  const config = configuration({ ...listSites(), lists: { enabled: false, types: ['unordered', 'ordered'], mode: 'start' } });
  config.categories[0].idDefinitionSites = listSites(['unordered']);
  const result = index('- FR-1: local\n- DD-1: inherited disabled\n\n1. FR-2: ordered disabled locally\n', config);
  assert.deepEqual(result.definitions.map(item => item.id), ['FR-1']);
  assert.deepEqual(result.references.map(item => item.id), ['DD-1', 'FR-2']);
});

test('optional list schema preserves old blocks and validates explicit settings', () => {
  const old = { headings: DEFAULT_ID_DEFINITION_SITES.headings, tables: DEFAULT_ID_DEFINITION_SITES.tables };
  assert.equal(validateIdConfiguration({ ...configuration(), idDefinitionSites: old }).idDefinitionSites?.lists, undefined);
  assert.deepEqual(validateIdConfiguration(configuration()).idDefinitionSites?.lists, { enabled: true, types: ['unordered', 'ordered'], mode: 'start' });
  for (const lists of [
    { enabled: true, types: ['unordered', 'unordered'], mode: 'start' }, { enabled: true, types: ['other'], mode: 'start' },
    { enabled: 1, types: [], mode: 'start' }, { enabled: true, types: [], mode: 'anywhere' },
  ]) assert.throws(() => validateIdConfiguration({ ...configuration(), idDefinitionSites: { ...listSites(), lists } }));
});
