import { test } from 'node:test';
import assert from 'node:assert/strict';
import { indexProject } from '../src/core/project-index';
import { matchesIds, ruleRegex, validateIdConfiguration, type IdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, existingCategoryTags, mergeProposal, validateProposal, type ConventionProposal } from '../src/core/id-discovery';
import { classifyDiscoveryCategory } from '../src/core/discovery-category-classification';
import { AgentToolbox, AGENT_INSTRUCTIONS } from '../src/core/agent-tools';
import { proposedSectionTags, stageAgentProposal } from '../src/core/agent-proposal';

/** Increment 96h: section tags for categories the draft already has, from Discover by patterns and from the agent. */
const TASKS = (title: string) => `# Tasks: ${title}\n\n## Phase 1: Setup (Shared Infrastructure)\n\n- [ ] T001 Create the project\n- [ ] T002 [P] Configure linting\n\n## Phase 2: Foundational (Blocking Prerequisites)\n\n- [ ] T003 Add the database\n\n## Phase 3: User Story 1 - Sign in (Priority: P1) 🎯 MVP\n\n- [ ] T004 [US1] Sign in\n\n## Phase 4: User Story 2 - Export (Priority: P2)\n\n- [x] T005 [US2] Export reports\n\n## Phase 5: Polish & Cross-Cutting Concerns\n\n- [ ] T006 Update docs\n\n## Parallel Example\n\n- T001, T002 can run in parallel\n`;
const FILES = { 'specs/001-a/tasks.md': TASKS('A'), 'specs/002-b/tasks.md': TASKS('B'), 'specs/003-c/tasks.md': TASKS('C') };
// As in the local swift-secp256k1: a Tasks category with a narrower rule, default definition sites (lists off), and no tags.
const EXISTING = validateIdConfiguration({ version: 1, categories: [{ key: 'TASK', name: 'Tasks', role: 'task', idScopes: [{ pattern: 'specs/*' }] }], rules: [{ key: 'task', category: 'TASK', pattern: String.raw`\bT\d{3}\b` }] });
/** The review's classification, with evidence owners from the draft's rules as the analysis worker computes them. */
function classify(draft: IdConfiguration, proposal: ConventionProposal) {
  const rules = draft.rules.filter(matchesIds).map(rule => ({ rule, regex: ruleRegex(rule) }));
  return proposal.suggestions.map(suggestion => classifyDiscoveryCategory(draft, suggestion, { owners: suggestion.evidence.map(evidence => rules.filter(item => {
    item.regex.lastIndex = 0; const match = item.regex.exec(evidence.id); return match?.index === 0 && match[0].length === evidence.id.length;
  }).map(item => item.rule.category)) }, proposal.suggestions));
}
const owners = (decisions: ReturnType<typeof classify>) => decisions.map(decision => decision.kind === 'existing' || decision.reason === 'different-rule-for-existing-evidence' ? decision.category : undefined);

test('Discover by patterns offers the tags of a task suggestion an existing category recognizes, and staging adds them without the rule', () => {
  const proposal = candidateProposal(discoverIds(FILES)), decisions = classify(EXISTING, proposal);
  const index = proposal.suggestions.findIndex(s => s.category.sectionTags);
  assert.deepEqual(decisions[index], { kind: 'ambiguous', reason: 'different-rule-for-existing-evidence', category: 'TASK' });
  const [tags, ...others] = existingCategoryTags(EXISTING, proposal.suggestions, owners(decisions));
  assert.equal(others.length, 0);
  assert.equal(tags.category, 'TASK'); assert.equal(tags.checkboxLists, true);
  assert.deepEqual(tags.sectionTags.map(entry => entry.tag), ['phase:{phase}', 'priority:{priority}']);
  assert.match(tags.uncertainty, /^In 3 task lists, 9 Setup, Foundational, or Polish phase headings .* Tasks already recognizes these IDs, so the tags can be added to it without the suggested rule\.$/);
  // Staged alone, as after deleting the ambiguous suggestion: no rule is added, and checkbox items define the tasks.
  const staged = mergeProposal(EXISTING, validateProposal({ version: 1, suggestions: [], tags: [tags] }, FILES));
  assert.deepEqual(staged.rules, EXISTING.rules);
  assert.deepEqual(staged.categories[0].sectionTags, tags.sectionTags);
  assert.deepEqual(staged.categories[0].idDefinitionSites!.lists, { enabled: true, types: ['unordered', 'ordered'], mode: 'start', checkboxOnly: true });
  const result = indexProject(FILES, staged, new Map()), counts = new Map<string, number>();
  for (const tag of result.definitions.flatMap(o => o.tags ?? [])) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  assert.deepEqual(Object.fromEntries(counts), { 'phase:setup': 6, 'phase:foundational': 3, 'priority:p1': 3, 'priority:p2': 3, 'phase:polish': 3 });
  assert.equal(result.findings.filter(f => /overlap/.test(f.message)).length, 0);
  // A category that already has the entries gets no suggestion; staging twice adds nothing twice.
  assert.deepEqual(existingCategoryTags(staged, proposal.suggestions, owners(classify(staged, proposal))), []);
  assert.deepEqual(mergeProposal(staged, { version: 1, suggestions: [], tags: [tags] }).categories[0].sectionTags, tags.sectionTags);
  assert.throws(() => mergeProposal(validateIdConfiguration({ version: 1, categories: [], rules: [] }), { version: 1, suggestions: [], tags: [tags] }), /not in the draft/);
});

test('the bugfix tags reach an existing criteria category whose templated rule makes the suggestion existing', () => {
  const sites = { headings: { enabled: false, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: false, types: ['unordered', 'ordered'], mode: 'start' }, paragraphs: { enabled: true, mode: 'start' } };
  const draft = validateIdConfiguration({ version: 1, categories: [{ key: 'criterion', name: 'Acceptance criterion', idDefinitionSites: sites }],
    rules: [{ key: 'bugfix', category: 'criterion', pattern: String.raw`^(?<group>\d+)\.(?<item>\d+)(?=\s)`, id: 'Criterion {group}.{item}', defines: true }] });
  const bugfix = '# Bugfix Requirements Document\n\n### Current Behavior (Defect)\n\n1.1 WHEN it deploys THEN it fails\n\n### Expected Behavior (Correct)\n\n2.1 The stack SHALL deploy\n\n### Unchanged Behavior (Regression Prevention)\n\n3.1 It SHALL CONTINUE TO deploy\n';
  const files = { 'specs/a/bugfix.md': bugfix, 'specs/b/bugfix.md': bugfix };
  const proposal = candidateProposal(discoverIds(files)), decisions = classify(draft, proposal);
  const [tags] = existingCategoryTags(draft, proposal.suggestions, owners(decisions));
  assert.equal(decisions[proposal.suggestions.findIndex(s => s.category.sectionTags)].kind, 'existing');
  assert.equal(tags.category, 'criterion'); assert.equal(tags.checkboxLists, undefined);
  assert.deepEqual(tags.sectionTags.map(entry => entry.tag), ['bugfix:defect', 'bugfix:expected', 'bugfix:unchanged']);
  const index = indexProject(files, mergeProposal(draft, validateProposal({ version: 1, suggestions: [], tags: [tags] }, files)), new Map());
  assert.deepEqual(index.definitions.filter(o => o.file === 'specs/a/bugfix.md').map(o => [o.id, o.tags]), [['Criterion 1.1', ['bugfix:defect']], ['Criterion 2.1', ['bugfix:expected']], ['Criterion 3.1', ['bugfix:unchanged']]]);
});

const TAGGED = { categories: [{ key: 'TASK', name: 'Tasks', role: 'task', idScopes: [{ pattern: 'specs/*' }], idDefinitionSites: { headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered', 'ordered'], mode: 'start', checkboxOnly: true }, paragraphs: { enabled: false, mode: 'start' } },
  sectionTags: [{ pattern: String.raw`^Phase \d+: (?<phase>Setup|Foundational|Polish)\b`, tag: 'phase:{phase}' }, { pattern: String.raw`\(Priority: (?<priority>P\d)\)`, tag: 'priority:{priority}' }, { heading: 'Release 2', tag: 'release:2' }] }],
  rules: [{ key: 'task', category: 'TASK', pattern: String.raw`\bT\d{3}\b` }] };

test('evaluate_configuration measures section tags per category, and list_matches pages a tag\'s IDs and the untagged ones', () => {
  const box = new AgentToolbox({ documents: FILES, configuration: EXISTING });
  const result = box.call('evaluate_configuration', { configuration: TAGGED }), value = result.value as any;
  assert.equal(result.ok, true, result.message);
  const [tasks] = value.tags.categories;
  assert.deepEqual(tasks.tags.map((t: any) => [t.tag, t.ids]), [['phase:foundational', 3], ['phase:polish', 3], ['phase:setup', 6], ['priority:p1', 3], ['priority:p2', 3]]);
  assert.deepEqual([tasks.tagged, tasks.untagged, tasks.idleEntries], [18, 0, ['heading "Release 2"']]);
  assert.deepEqual(tasks.tags[0].example, { path: 'specs/001-a/tasks.md', line: 10, text: '- [ ] T003 Add the database' });
  assert.equal(value.tags.invalid, 0);
  const p1 = box.call('list_matches', { evaluationId: value.evaluationId, category: 'TASK', kind: 'tag', tag: 'priority:p1' }).value as any;
  assert.deepEqual(p1.matches.map((m: any) => [m.path, m.id]), [['specs/001-a/tasks.md', 'T004'], ['specs/002-b/tasks.md', 'T004'], ['specs/003-c/tasks.md', 'T004']]);
  assert.equal((box.call('list_matches', { evaluationId: value.evaluationId, category: 'TASK', kind: 'untagged' }).value as any).total, 0);
  assert.match(box.call('list_matches', { evaluationId: value.evaluationId, category: 'TASK', kind: 'tag' }).message!, /Provide the tag/);
  // Without section tags, the evaluation has no tags section.
  assert.equal((box.call('evaluate_configuration', { configuration: EXISTING }).value as any).tags, undefined);
});

test('a submission that adds section tags needs a tagRationale, and the instructions ask for measured tags', () => {
  const box = new AgentToolbox({ documents: FILES, configuration: EXISTING });
  const rationale = { TASK: 'Spec Kit tasks T001 in specs/*/tasks.md.' };
  const rejected = box.call('submit_proposal', { configuration: TAGGED, rationale });
  assert.match(rejected.message!, /adds section tags; give a tagRationale/);
  const accepted = box.call('submit_proposal', { configuration: TAGGED, rationale, tagRationale: 'Phase and priority headings divide the tasks: phase:setup 6, priority:p1 3.' });
  assert.equal(accepted.ok, true, accepted.message);
  assert.equal(box.proposal!.tagRationale, 'Phase and priority headings divide the tasks: phase:setup 6, priority:p1 3.');
  assert.equal(box.proposal!.evaluation.tags!.categories[0].tagged, 18);
  assert.match(AGENT_INSTRUCTIONS, /7\. Section tags:/); assert.match(AGENT_INSTRUCTIONS, /tagRationale/);
});

test('staging the agent\'s section tags adds them to an existing category that is not selected, keeping its entries', () => {
  const draft = validateIdConfiguration({ ...EXISTING, categories: [{ ...EXISTING.categories[0], sectionTags: [{ heading: 'Release 2', tag: 'release:2' }] }] });
  const proposed = validateIdConfiguration({ version: 1, ...TAGGED, categories: [...TAGGED.categories, { key: 'US', name: 'User story', sectionTags: [{ heading: 'MVP', tag: 'mvp' }] }] });
  assert.deepEqual(proposedSectionTags(draft, proposed).map(item => [item.category, item.entries.length, item.existing]), [['TASK', 2, true], ['US', 1, false]]);
  const before = JSON.stringify(draft);
  const staged = stageAgentProposal(draft, proposed, [], false, { tags: true });
  assert.equal(JSON.stringify(draft), before);
  assert.deepEqual(staged.categories.map(c => c.key), ['TASK']);
  assert.deepEqual(staged.categories[0].sectionTags!.map(entry => entry.tag), ['release:2', 'phase:{phase}', 'priority:{priority}']);
  assert.deepEqual(staged.rules, draft.rules);
  assert.equal(stageAgentProposal(draft, proposed, [], false, {}).categories[0].sectionTags!.length, 1);
});
