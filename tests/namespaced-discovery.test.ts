import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { validateIdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, mergeProposal, validateProposal, type ConventionProposal } from '../src/core/id-discovery';

// Increment 101: namespaced heading identifiers, shaped like szerintedmi/kinetic-mirror-matrix-esp32's command reference.
const commands: Record<string, string> = {
  'docs/mqtt-command-schema.md': '# MQTT Command Schema\n\n## Network commands\n\n### NET:STATUS\n\nReports the link.\n\n### NET:GET_CONFIG\n\nSee also `NET:STATUS`.\n\n'
    + '### NET:SET / NET:SET_PRIMARY\n\nSets the primary network.\n\n### NET:RESET\n\n## Broker commands\n\n### MQTT:GET_CONFIG\n\nLike NET:GET_CONFIG, for the broker.\n\n### MQTT:SET_CONFIG\n',
  'docs/mqtt-payload-examples.md': '# Payload examples\n\n## NET:STATUS\n\n```json\n{}\n```\n\n## MQTT:GET_CONFIG\n\n```json\n{}\n```\n',
};
const proposal = (documents: Record<string, string>) => validateProposal(JSON.parse(JSON.stringify(candidateProposal(discoverIds(documents)))), documents);
const named = (p: ConventionProposal, name: string) => p.suggestions.filter(item => item.category.name === name);

test('namespaced headings are proposed per prefix with a rule over the whole identifier, not as keyword categories', () => {
  const p = proposal(commands), [net] = named(p, 'NET'), [mqtt] = named(p, 'MQTT');
  assert.equal(named(p, 'NET').length, 1, JSON.stringify(p.suggestions.map(s => s.category.name)));
  assert.equal(net.rule?.pattern, String.raw`\bNET:[A-Z][A-Z0-9_]*\b`);
  assert.equal(mqtt.rule?.pattern, String.raw`\bMQTT:[A-Z][A-Z0-9_]*\b`);
  assert.deepEqual(net.category.idDefinitionSites?.headings, { enabled: true, levels: [2, 3], mode: 'start' });
  assert.ok(!p.suggestions.some(s => s.category.idDefinitionSites?.headings.mode === 'keyword'), 'no keyword categories for NET or MQTT');
  assert.deepEqual(net.evidence.map(e => e.id), ['NET:STATUS', 'NET:GET_CONFIG', 'NET:SET', 'NET:RESET', 'NET:STATUS']);
  assert.ok(net.evidence.every(e => commands[e.file].slice(e.offset, e.end) === e.id));
  assert.match(net.uncertainty, /Namespaced headings "NET:<NAME>": 5 headings in 2 files at level 2, 3, with 4 distinct identifiers such as NET:STATUS\. 1 is headed in more than one file \(such as NET:STATUS\), so it indexes as a duplicate\./);
  assert.match(mqtt.uncertainty, /the same name under another prefix is a different ID/);
});

test('staging both prefixes indexes NET:GET_CONFIG and MQTT:GET_CONFIG as two IDs without a conflict', () => {
  const configuration = validateIdConfiguration(mergeProposal({ version: 1, categories: [], rules: [] }, proposal(commands)));
  const index = indexProject(commands, configuration);
  const schema = index.definitions.filter(item => item.file === 'docs/mqtt-command-schema.md').map(item => `${item.category?.name} ${item.id}`);
  assert.deepEqual(schema, ['NET NET:STATUS', 'NET NET:GET_CONFIG', 'NET NET:SET', 'NET NET:RESET', 'MQTT MQTT:GET_CONFIG', 'MQTT MQTT:SET_CONFIG']);
  assert.deepEqual(index.references.filter(item => item.file === 'docs/mqtt-command-schema.md').map(item => item.id).sort(), ['NET:GET_CONFIG', 'NET:SET_PRIMARY', 'NET:STATUS']);
});

test('headings that are not namespaced identifiers stay with the keyword detector or are ignored', () => {
  const documents = {
    'a.md': '# A\n\n## Step: Install\n\n## Step: Configure\n\n## Note:Something\n\n## Note:Other\n\n## NET:only\n\n## NET:lower\n',
    'b.md': '# B\n\n## Step: Run\n\n## API:GET_USERS\n',
  };
  const p = proposal(documents);
  assert.equal(named(p, 'Step')[0]?.category.idDefinitionSites?.headings.mode, 'keyword');
  assert.ok(!p.suggestions.some(s => s.category.name === 'Note' && s.rule), 'a lowercase name is not namespaced');
  assert.ok(!named(p, 'NET').some(s => s.rule), 'lowercase names are not namespaced');
  assert.equal(named(p, 'API').length, 0, 'one identifier per prefix is not enough');
  // A document title is the file's name, not a record.
  assert.equal(discoverIds({ 'x.md': '# CMD:FIRST\n\n## CMD:SECOND\n' }).namespaced?.length, 0);
});

test('keyword suggestions that define the same name say so', () => {
  const documents = {
    'a.md': '# A\n\n## Command: Start\n\n## Command: Stop\n\n## Event: Start\n\n## Event: Stopped\n',
    'b.md': '# B\n\n## Command: Pause\n\n## Event: Paused\n',
  };
  const p = proposal(documents), [command] = named(p, 'Command'), [event] = named(p, 'Event');
  assert.match(command.uncertainty, /Event headings define the same name \("Start"\): adding both recognizes it in two categories, which stops recognition, so keep one\./);
  assert.match(event.uncertainty, /Command headings define the same name \("Start"\)/);
  const nested = proposal({ 'a.md': '# A\n\n## Requirement: Login\n\n### Scenario: Login\n\n## Requirement: Logout\n\n### Scenario: Logout\n', 'b.md': '# B\n\n## Requirement: Audit\n\n### Scenario: Audit\n' });
  assert.ok(nested.suggestions.every(s => !/define the same/.test(s.uncertainty)), 'a nested keyword is identified within its parent');
});
