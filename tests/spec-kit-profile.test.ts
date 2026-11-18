import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BUNDLED_PROFILES, discoveryProviders, validateProfile } from '../src/core/discovery-profiles';
import { candidateProposal, discoverIds, validateProposal } from '../src/core/id-discovery';
import { LEGACY_ID_CONFIGURATION, validateIdConfiguration } from '../src/core/id-configuration';
import { ProjectConfigurationStore } from '../src/core/project-configuration';
import { AgentToolbox } from '../src/core/agent-tools';

/** Increment 97b: the Spec Kit profile, project profiles in .specular/profiles/, and provider switches. */
const TASKS = (title: string) => `# Tasks: ${title}\n\n## Phase 1: Setup (Shared Infrastructure)\n\n- [ ] T001 Create the project\n- [ ] T002 [P] Configure linting\n\n## Phase 2: Foundational (Blocking Prerequisites)\n\n- [ ] T003 Add the database\n\n## Phase 3: User Story 1 - Sign in (Priority: P1) 🎯 MVP\n\n- [ ] T004 [US1] Sign in\n\n## Phase 4: User Story 2 - Export (Priority: P2)\n\n- [x] T005 [US2] Export reports\n\n## Phase 5: Polish & Cross-Cutting Concerns\n\n- [ ] T006 Update docs\n\n## Parallel Example\n\n- T001, T002 can run in parallel\n`;
const FILES = { 'specs/001-a/tasks.md': TASKS('A'), 'specs/002-b/tasks.md': TASKS('B'), 'specs/003-c/tasks.md': TASKS('C') };
// A team convention: decisions written as "Decision 3" headings in docs/decisions, each with an ordered list of "Consequences".
const DECISIONS = { schema: 1, id: 'team-decisions', tool: 'Team ADRs', versions: 'docs/decisions template v2',
  detectors: [{ id: 'consequences', kind: 'list-section', heading: 'Consequences', within: 'numbered-keyword', min: 3 }],
  proposals: [{ detector: 'consequences', key: '{{parent}}-consequences', name: 'Consequence', numberedItems: { id: 'Consequence {parent}.{item}' }, scope: 'parent', uncertainty: [{ text: '{{items}} consequences under {{keyword}} headings.' }] }] };
const ADR = (n: number) => `## Decision ${n}: Use SQLite\n\n### Consequences\n\n1. One file\n2. No server\n`;
const ADRS = { 'docs/decisions/a.md': '# Decisions\n\n' + ADR(1), 'docs/decisions/b.md': '# Decisions\n\n' + ADR(2) + '\n' + ADR(3) };

test('the bundled Spec Kit profile tags the task suggestion by phase and priority, as 96g did', () => {
  const kit = validateProfile(BUNDLED_PROFILES[1]);
  assert.deepEqual([kit.id, kit.tool, kit.detectors[0].kind, kit.proposals[0].detector], ['spec-kit', 'Spec Kit', 'heading-sections', 'task-sections']);
  const inventory = discoverIds(FILES), result = inventory.providers!.find(p => p.provider === 'spec-kit')!.results[0];
  assert.deepEqual(result.kind === 'heading-sections' && [result.files, result.counts, result.ids], [3, { phases: 9, priorities: 6 }, ['T001', 'T002', 'T003', 'T004', 'T005', 'T006']]);
  const tasks = validateProposal(candidateProposal(inventory), FILES).suggestions.find(s => s.category.sectionTags)!;
  assert.deepEqual(tasks.category.sectionTags!.map(t => t.tag), ['phase:{phase}', 'priority:{priority}']);
  assert.equal(tasks.category.idDefinitionSites!.lists!.checkboxOnly, true);
  assert.equal(tasks.tagReason, 'In 3 task lists, 9 Setup, Foundational, or Polish phase headings (phase:setup, …) and 6 user-story headings with a priority (priority:p1, …) divide these tasks, so the tasks under them are tagged by their section; tasks are defined by their checkbox items.');
  // The tags join a suggestion of Specular's own, which stays unlabelled.
  assert.equal(tasks.provider, undefined);
});

test('a project profile proposes its own convention under its tool; invalid and duplicate ones are reported; switches turn providers off', () => {
  const files = [{ file: '.specular/profiles/adr.json', profile: DECISIONS }, { file: '.specular/profiles/broken.json', error: 'is not valid JSON.' },
    { file: '.specular/profiles/kiro-copy.json', profile: BUNDLED_PROFILES[0] }, { file: '.specular/profiles/bad.json', profile: { ...DECISIONS, id: 'bad', detectors: [] } }];
  const paths = [...Object.keys(FILES), '.specify/memory/constitution.md', '.kiro/specs/a/requirements.md'], setup = discoveryProviders(files, {}, [], paths);
  assert.deepEqual(setup.providers.map(p => [p.id, p.tool, p.source, p.enabled]), [['kiro', 'Kiro', 'bundled', true], ['spec-kit', 'Spec Kit', 'bundled', true], ['trae', 'Trae', 'bundled', false], ['team-decisions', 'Team ADRs', 'project', true]]);
  assert.deepEqual(setup.errors, ['.specular/profiles/broken.json is not valid JSON.', '.specular/profiles/kiro-copy.json: profile kiro uses the id of another provider.', '.specular/profiles/bad.json: Profile bad: needs 1-16 detectors.']);
  const proposal = candidateProposal(discoverIds(ADRS, setup.profiles), setup.profiles);
  const consequence = proposal.suggestions.find(s => s.provider === 'Team ADRs')!;
  assert.deepEqual([consequence.category.name, consequence.category.numberedItems!.id, consequence.uncertainty], ['Consequence', 'Consequence {parent}.{item}', '6 consequences under Decision headings.']);
  // Turned off, Spec Kit runs no more: the task suggestion keeps no tags; the others still run.
  const off = discoveryProviders(files, { disabled: ['spec-kit'] }, [], paths);
  assert.deepEqual(off.providers.map(p => p.enabled), [true, false, false, true]);
  assert.deepEqual(off.profiles.map(p => p.id), ['kiro', 'team-decisions']);
  assert.ok(candidateProposal(discoverIds(FILES, off.profiles), off.profiles).suggestions.every(s => !s.category.sectionTags));
  // The switch is part of the project configuration.
  const saved = validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, discoveryProviders: { disabled: ['spec-kit'] } });
  assert.deepEqual(saved.discoveryProviders, { disabled: ['spec-kit'] });
  assert.throws(() => validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, discoveryProviders: { disabled: ['Spec Kit'] } }), /distinct provider ids/);
  assert.throws(() => validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, discoveryProviders: { disabled: ['kiro', 'kiro'] } }), /distinct provider ids/);
});

test('the project configuration store reads .specular/profiles/*.json and reports files it cannot use', async () => {
  await mkdir('.cache/profile-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.cache/profile-tests/project-'));
  assert.equal((await new ProjectConfigurationStore(root).load()).profiles, undefined);
  await mkdir(path.join(root, '.specular/profiles'), { recursive: true });
  await writeFile(path.join(root, '.specular/profiles/adr.json'), JSON.stringify(DECISIONS));
  await writeFile(path.join(root, '.specular/profiles/broken.json'), '{ "schema": ');
  await writeFile(path.join(root, '.specular/profiles/notes.txt'), 'ignored');
  const { profiles } = await new ProjectConfigurationStore(root).load();
  assert.deepEqual(profiles, [{ file: '.specular/profiles/adr.json', profile: DECISIONS }, { file: '.specular/profiles/broken.json', error: 'is not valid JSON.' }]);
});

test('template_profiles lists the providers, what the enabled ones found, and what they propose; heuristic_candidates follows the switches', () => {
  const box = (disabled?: string[]) => new AgentToolbox({ documents: { ...FILES, ...ADRS, '.specify/memory/constitution.md': '# Constitution\n' }, configuration: validateIdConfiguration({ ...LEGACY_ID_CONFIGURATION, ...(disabled ? { discoveryProviders: { disabled } } : {}) }), profiles: [{ file: '.specular/profiles/adr.json', profile: DECISIONS }] });
  const value = box().call('template_profiles', {}).value as any;
  assert.deepEqual(value.providers.map((p: any) => [p.id, p.source, p.enabled, p.applies]), [['kiro', 'bundled', false, false], ['spec-kit', 'bundled', true, true], ['trae', 'bundled', false, false], ['team-decisions', 'project', true, true]]);
  const kit = value.providers[1], adr = value.providers[3];
  assert.deepEqual(kit.sectionTagsForMatchingCategory.map((t: any) => [t.tag, t.headings]), [['phase:{phase}', 9], ['priority:{priority}', 6]]);
  assert.deepEqual(kit.found[0].examples[0], { id: 'Phase 1: Setup (Shared Infrastructure)', path: 'specs/001-a/tasks.md', line: 3 });
  assert.deepEqual(adr.proposes.map((s: any) => s.name), ['Consequence']);
  const off = box(['spec-kit']);
  const listed = (off.call('template_profiles', {}).value as any).providers[1];
  assert.deepEqual([listed.enabled, listed.applies, 'found' in listed], [false, true, false]);
  assert.deepEqual((off.call('heuristic_candidates', {}).value as any).providerCandidates.map((p: any) => p.tool), ['Team ADRs']);
});
