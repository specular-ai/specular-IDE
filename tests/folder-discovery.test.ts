import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidateProposal, discoverIds, mergeProposal, validateProposal } from '../src/core/id-discovery';
import { addFolderGenerators, folderRootTaken, measureSpecFolders, previewFolderGenerators, stageFolderUpdate } from '../src/core/folder-generators';
import { indexProject } from '../src/core/project-index';
import { LEGACY_ID_CONFIGURATION, validateIdConfiguration } from '../src/core/id-configuration';
import { AgentToolbox, AGENT_INSTRUCTIONS, CONFIGURATION_GUIDE, proposedConfiguration } from '../src/core/agent-tools';
import { foldersChanged, proposedGenerators, stageAgentProposal } from '../src/core/agent-proposal';
import { FOLDER_DRAFT, FOLDER_EXTRA, GOOD_DRAFT, RATIONALE, SNAPSHOT } from './helpers/agent-discovery-fixtures';

/** Increment 96: discovery proposes folder-derived features. */
const LAYOUTS: Record<string, string> = {
  'specs/001-a/spec.md': '# Feature A\n\n## REQ-1 Sign in\n',
  'specs/002-b/spec.md': '# Feature B\n\n## REQ-2 Export\n',
  'specs/002-b/contracts/api.md': '# API\n',
  '.kiro/specs/x/requirements.md': '# Requirements X\n',
  '.kiro/specs/x/design.md': '# Design X\n',
  '.kiro/specs/x/tasks.md': '# Tasks X\n',
  '.kiro/specs/y/bugfix.md': '# Bugfix Y\n',
  '.kiro/specs/y/tasks.md': '# Tasks Y\n',
  'openspec/specs/auth/spec.md': '# Auth\n',
  'openspec/specs/billing/spec.md': '# Billing\n',
  'openspec/changes/add-x/proposal.md': '# Change: Add X\n',
  'openspec/changes/add-y/proposal.md': '# Change: Add Y\n',
  'openspec/changes/add-x/specs/auth/spec.md': '# Auth delta\n',
  'openspec/changes/add-y/specs/billing/spec.md': '# Billing delta\n',
  'docs/only/spec.md': '# Only one folder\n',
  'README.md': '# Readme\n',
};

test('spec folder roots of Spec Kit, Kiro, and OpenSpec capabilities are detected; change folders and single folders are not', () => {
  const folders = discoverIds(LAYOUTS).layout!.specFolders!;
  assert.deepEqual(folders.map(f => [f.root, f.folders]), [
    ['.kiro/specs', ['.kiro/specs/x', '.kiro/specs/y']],
    ['openspec/specs', ['openspec/specs/auth', 'openspec/specs/billing']],
    ['specs', ['specs/001-a', 'specs/002-b']],
  ]);
  assert.deepEqual(folders[2].evidence.map(e => [e.id, e.file]), [['Feature A', 'specs/001-a/spec.md'], ['Feature B', 'specs/002-b/spec.md']]);
  // A root nested in another root is not proposed separately.
  const nested = discoverIds({ 'specs/a/spec.md': '# A\n', 'specs/b/spec.md': '# B\n', 'specs/a/parts/one/spec.md': '# One\n', 'specs/a/parts/two/spec.md': '# Two\n' }).layout!.specFolders!;
  assert.deepEqual(nested.map(f => f.root), ['specs']);
  assert.equal(discoverIds({ 'a.md': '# A\n' }).layout!.specFolders, undefined);
});

test('folder suggestions carry their pattern, folders, and counts, and survive proposal validation', () => {
  const inventory = discoverIds(LAYOUTS);
  measureSpecFolders(inventory.layout!.specFolders!, Object.keys(LAYOUTS), indexProject(LAYOUTS, LEGACY_ID_CONFIGURATION, new Map()), LEGACY_ID_CONFIGURATION);
  const proposal = candidateProposal(inventory);
  const specs = proposal.folders!.find(f => f.pattern === 'specs/*')!;
  assert.deepEqual([specs.target, specs.folders, specs.ids], ['features', ['specs/001-a', 'specs/002-b'], [1, 1]]);
  assert.match(specs.uncertainty, /2 folders in specs\/ hold the specifications/);
  const valid = validateProposal(proposal, LAYOUTS);
  assert.deepEqual(valid.folders!.map(f => f.pattern), ['.kiro/specs/*', 'openspec/specs/*', 'specs/*']);
  assert.throws(() => validateProposal({ ...proposal, folders: [{ ...specs, pattern: 'specs' }] }, LAYOUTS), /Folder generator pattern/);
  assert.throws(() => validateProposal({ ...proposal, folders: [{ ...specs, target: 'modules' }] }, LAYOUTS), /features target/);
  assert.throws(() => validateProposal({ ...proposal, folders: [{ ...specs, folders: ['docs/x'] }] }, LAYOUTS), /child folders of their pattern/);
  assert.throws(() => validateProposal({ ...proposal, folders: [{ ...specs, ids: [1] }] }, LAYOUTS), /counts must match/);
  assert.throws(() => validateProposal(proposal, { ...LAYOUTS, 'specs/001-a/spec.md': '# Changed\n' }), /evidence/);
});

test('proposed generators are added with fresh keys, and roots the draft already derives are skipped', () => {
  const draft = validateIdConfiguration({ ...structuredClone(LEGACY_ID_CONFIGURATION), folderGenerators: [{ key: 'generator1', target: 'features', pattern: 'specs/*', exclusions: [] }] });
  assert.deepEqual([folderRootTaken(draft, 'features', 'specs/*'), folderRootTaken(draft, 'features', 'SPECS/*'), folderRootTaken(draft, 'features', 'specs/a/*'), folderRootTaken(draft, 'modules', 'specs/*'), folderRootTaken(draft, 'features', '.kiro/specs/*')], [true, true, true, false, false]);
  const { configuration, added } = addFolderGenerators(draft, [{ target: 'features', pattern: 'specs/*', exclusions: [] }, { target: 'features', pattern: '.kiro/specs/*', exclusions: [] }, { target: 'modules', pattern: 'services/*', exclusions: [] }]);
  assert.deepEqual(added.map(r => [r.key, r.target, r.pattern]), [['generator2', 'features', '.kiro/specs/*'], ['generator3', 'modules', 'services/*']]);
  assert.equal(configuration.folderGenerators!.length, 3); assert.equal(draft.folderGenerators!.length, 1);
});

test('the agent measures folder generators, needs a folder rationale, and staging only adds new generators', () => {
  const box = new AgentToolbox(structuredClone(SNAPSHOT));
  const evaluated = box.call('evaluate_configuration', { configuration: FOLDER_DRAFT });
  assert.equal(evaluated.ok, true, evaluated.message);
  const folders = (evaluated.value as any).folders;
  // FR-001 and FR-002 are defined in specs/001-login, FR-001 in specs/002-export; tasks are defined in both folders' task lists.
  assert.deepEqual(folders.generators.map((g: any) => [g.pattern, g.folders, g.examples.map((e: any) => e.folder)]), [['specs/*', 2, ['specs/001-login', 'specs/002-export']]]);
  assert.equal(folders.unassigned.features, 0); assert.ok(folders.generators[0].ids > 0);
  assert.equal((box.call('evaluate_configuration', { configuration: GOOD_DRAFT }).value as any).folders, undefined);
  const rejected = box.call('submit_proposal', { configuration: FOLDER_DRAFT, rationale: RATIONALE });
  assert.match(rejected.message!, /folderRationale/);
  const accepted = box.call('submit_proposal', { configuration: FOLDER_DRAFT, rationale: RATIONALE, ...FOLDER_EXTRA });
  assert.equal(accepted.ok, true, accepted.message); assert.equal(box.proposal!.folderRationale, FOLDER_EXTRA.folderRationale);
  assert.match(accepted.summary, /folder generators/);
  // Staging adds new generators only, under fresh keys, and keeps the existing ones.
  const base = validateIdConfiguration({ ...structuredClone(LEGACY_ID_CONFIGURATION), folderGenerators: [{ key: 'generator1', target: 'modules', pattern: 'services/*', exclusions: [] }] });
  const proposed = proposedConfiguration(base, { ...GOOD_DRAFT, folderGenerators: [{ key: 'specs', target: 'features', pattern: 'specs/*', exclusions: [] }] });
  assert.deepEqual([foldersChanged(base, proposed), foldersChanged(base, proposedConfiguration(base, GOOD_DRAFT)), proposedGenerators(base, proposed).map(r => r.pattern)], [true, false, ['specs/*']]);
  const staged = stageAgentProposal(base, proposed, [], false, { folders: true });
  assert.deepEqual(staged.folderGenerators!.map(r => [r.key, r.target, r.pattern]), [['generator1', 'modules', 'services/*'], ['generator2', 'features', 'specs/*']]);
  assert.deepEqual(stageAgentProposal(base, proposed, [], false, {}).folderGenerators, base.folderGenerators);
  // A draft that omits folderGenerators keeps the current ones; an invalid pattern is rejected.
  assert.deepEqual(proposedConfiguration(base, GOOD_DRAFT).folderGenerators, base.folderGenerators);
  assert.match((box.call('evaluate_configuration', { configuration: { ...GOOD_DRAFT, folderGenerators: [{ key: 'bad', target: 'features', pattern: 'specs', exclusions: [] }] } }).value as any).error, /Folder generator/);
});

test('the instructions and schema guide cover folder generators', () => {
  assert.match(AGENT_INSTRUCTIONS, /Features and modules:/); assert.match(AGENT_INSTRUCTIONS, /folderRationale/);
  assert.match(CONFIGURATION_GUIDE, /FOLDER GENERATORS/);
});

/** Increment 96a: depth-tolerant folder patterns. */
const DEEP: Record<string, string> = {
  'specs/a/spec.md': '# A\n\n## REQ-1 One\n',
  'specs/a/checklists/requirements.md': '# Checklist\n\n## REQ-2 Checked\n',
  'specs/group/b/spec.md': '# B\n\n## REQ-3 Three\n',
  'specs/group/c/requirements.md': '# C\n\n## REQ-4 Four\n',
  'specs/group/notes.md': '# Notes\n\n## REQ-5 Loose\n',
};
const deepDraft = (files: Record<string, string>) => validateIdConfiguration({ ...structuredClone(LEGACY_ID_CONFIGURATION), folderGenerators: [{ key: 'generator1', target: 'features', pattern: 'specs/**', exclusions: [] }] });

test('a ** pattern derives one entry per outermost specification folder at any depth, skipping group folders', () => {
  const draft = deepDraft(DEEP), index = indexProject(DEEP, draft, new Map());
  const preview = previewFolderGenerators(draft.folderGenerators!, Object.keys(DEEP), index, draft);
  assert.deepEqual(preview.entries.map(e => [e.provenance.folder, e.name, e.files, e.members.map(m => m.label)]), [
    ['specs/a', 'a', 2, ['REQ-1', 'REQ-2']], ['specs/group/b', 'b', 1, ['REQ-3']], ['specs/group/c', 'c', 1, ['REQ-4']]]);
  // Update stages the entries; a second Update after a new specification keeps keys and edited names.
  const first = stageFolderUpdate(draft, 'features', Object.keys(DEEP), index).configuration!;
  assert.deepEqual(first.generatedFolders!.map(m => m.folder), ['specs/a', 'specs/group/b', 'specs/group/c']);
  assert.doesNotThrow(() => validateIdConfiguration(first));
  first.features![1].name = 'Renamed b';
  const more = { ...DEEP, 'specs/group/d/spec.md': '# D\n' };
  const second = stageFolderUpdate(first, 'features', Object.keys(more), indexProject(more, first, new Map())).configuration!;
  assert.deepEqual(second.features!.map(f => [f.key, f.name]), [['generated1', 'a'], ['generated2', 'Renamed b'], ['generated3', 'c'], ['generated4', 'd']]);
  // Saved mappings of a ** pattern must lie under its root.
  assert.throws(() => validateIdConfiguration({ ...first, generatedFolders: [{ ...first.generatedFolders![0], folder: 'docs/a' }] }), /Generated mappings/);
  // Exclusions remove a specification folder.
  const excluded = previewFolderGenerators([{ key: 'generator1', target: 'features', pattern: 'specs/**', exclusions: ['specs/group/b'] }], Object.keys(DEEP), index, draft);
  assert.deepEqual(excluded.entries.map(e => e.provenance.folder), ['specs/a', 'specs/group/c']);
});

test('discovery proposes ** when specifications sit at more than one depth, and lists exactly what Update derives', () => {
  const deep = discoverIds(DEEP).layout!.specFolders!;
  assert.deepEqual(deep.map(f => [f.pattern, f.folders]), [['specs/**', ['specs/a', 'specs/group/b', 'specs/group/c']]]);
  // Area folders without direct specifications join into one ** root.
  const areas = discoverIds({ '.kiro/specs/A/a1/requirements.md': '# a1\n', '.kiro/specs/A/a2/tasks.md': '# a2\n', '.kiro/specs/B/b1/design.md': '# b1\n', '.kiro/specs/B/b2/bugfix.md': '# b2\n' }).layout!.specFolders!;
  assert.deepEqual(areas.map(f => [f.pattern, f.folders.length]), [['.kiro/specs/**', 4]]);
  // When all specifications are child folders, * stays, and child folders without one are listed and marked.
  const flat = discoverIds({ '.kiro/specs/x/requirements.md': '# x\n', '.kiro/specs/y/tasks.md': '# y\n', '.kiro/specs/notes/readme.md': '# notes\n', '.kiro/specs/loose.md': '# loose\n' }).layout!.specFolders!;
  assert.deepEqual(flat.map(f => [f.pattern, f.folders, f.withoutSpec]), [['.kiro/specs/*', ['.kiro/specs/notes', '.kiro/specs/x', '.kiro/specs/y'], ['.kiro/specs/notes']]]);
  const proposal = candidateProposal({ ...discoverIds(DEEP) });
  assert.match(proposal.folders![0].uncertainty, /sit at more than one depth/);
  assert.equal(validateProposal(proposal, DEEP).folders![0].pattern, 'specs/**');
  // The 96 layouts keep their * patterns.
  assert.deepEqual(discoverIds(LAYOUTS).layout!.specFolders!.map(f => f.pattern), ['.kiro/specs/*', 'openspec/specs/*', 'specs/*']);
});

test('the agent measures a ** generator and its guide explains both forms', () => {
  const box = new AgentToolbox({ documents: DEEP, configuration: structuredClone(LEGACY_ID_CONFIGURATION) });
  const value = box.call('evaluate_configuration', { configuration: { categories: [{ key: 'req', name: 'Requirements' }], rules: [{ key: 'req', category: 'req', prefix: 'REQ' }], folderGenerators: [{ key: 'specs', target: 'features', pattern: 'specs/**', exclusions: [] }] } }).value as any;
  assert.deepEqual(value.folders.generators.map((g: any) => [g.pattern, g.folders, g.ids]), [['specs/**', 3, 4]]);
  assert.equal(value.folders.unassigned.features, 1);
  assert.match(CONFIGURATION_GUIDE, /"<root>\/\*\*" one per folder at any depth/);
});

/** Increment 96b: per-specification scopes. */
test('restarting numbered headings get a scope per specification folder at any depth, exclusive when a few files elsewhere use them', () => {
  const files = {
    'specs/a/requirements.md': '# A\n\n### Requirement 1\n\n### Requirement 2\n',
    'specs/group/b/requirements.md': '# B\n\n### Requirement 1\n\n### Requirement 2\n',
    'docs/report.md': '# Report\n\n### Requirement 1\n',
  };
  const inventory = discoverIds(files), keyword = inventory.keywords!.find(k => k.keyword === 'Requirement')!;
  assert.deepEqual([keyword.scope, keyword.specScope], ['specs/**/{spec}/*.md', { scope: 'specs/**/{spec}/*.md', onlyInScopes: true, outside: 1 }]);
  const proposal = validateProposal(candidateProposal(inventory), files), suggestion = proposal.suggestions.find(s => s.category.name === 'Requirement')!;
  assert.deepEqual([suggestion.category.idScopes, suggestion.category.onlyInScopes], [[{ pattern: 'specs/**/{spec}/*.md' }], true]);
  assert.match(suggestion.uncertainty, /Numbering restarts in each specification.*1 file outside the specification folders/);
  const draft = mergeProposal(LEGACY_ID_CONFIGURATION, { version: 1, suggestions: [suggestion] }), index = indexProject(files, draft, new Map());
  const definitions = index.definitions.filter(o => o.category?.key === suggestion.category.key);
  assert.deepEqual(definitions.map(o => [o.file, o.id, o.scope]), [
    ['specs/a/requirements.md', 'Requirement 1', 'spec:a'], ['specs/a/requirements.md', 'Requirement 2', 'spec:a'],
    ['specs/group/b/requirements.md', 'Requirement 1', 'spec:b'], ['specs/group/b/requirements.md', 'Requirement 2', 'spec:b']]);
  assert.equal(index.findings.filter(f => f.kind === 'duplicate').length, 0);
});

test('restarting prefix IDs get the specification scope; numbers that never repeat get none', () => {
  const restart = { 'specs/001-a/spec.md': '# A\n\n- **FR-001**: One.\n- **FR-002**: Two.\n', 'specs/002-b/spec.md': '# B\n\n- **FR-001**: Other.\n' };
  const fr = discoverIds(restart).candidates.find(c => c.prefix === 'FR')!;
  assert.deepEqual(fr.specScope, { scope: 'specs/*', outside: 0 });
  const suggestion = candidateProposal(discoverIds(restart)).suggestions.find(s => s.category.name === 'FR')!;
  assert.deepEqual([suggestion.category.idScopes, suggestion.category.onlyInScopes], [[{ pattern: 'specs/*' }], undefined]);
  const unique = { 'specs/001-a/spec.md': '# A\n\n- **FR-001**: One.\n', 'specs/002-b/spec.md': '# B\n\n- **FR-002**: Two.\n' };
  assert.equal(discoverIds(unique).candidates.find(c => c.prefix === 'FR')!.specScope, undefined);
  // The agent's heuristics report the scope with the candidate.
  const value = new AgentToolbox({ documents: restart, configuration: structuredClone(LEGACY_ID_CONFIGURATION) }).call('heuristic_candidates', {}).value as any;
  assert.equal(value.prefixCandidates.find((c: any) => c.prefix === 'FR').scope, 'specs/*');
  assert.match(CONFIGURATION_GUIDE, /"<root>\/\*\*\/\{spec\}\/\*\.md" gives each specification folder its own scope/);
});

/** Increment 96c: grouped OpenSpec capabilities. */
test('capabilities in group folders are derived at any depth, with their requirements and grouped change deltas', () => {
  const files = {
    'openspec/specs/auth/spec.md': '# auth\n\n### Requirement: Sign in\n\n#### Scenario: Valid password\n\n### Requirement: Sign out\n\n#### Scenario: Session ends\n',
    'openspec/specs/ui/commands/spec.md': '# commands\n\n### Requirement: Run command\n\n#### Scenario: Known command\n',
    'openspec/specs/ui/help/spec.md': '# help\n\n### Requirement: Show help\n\n#### Scenario: Help topic\n\n### Requirement: Sign in\n\n#### Scenario: Help login\n',
    'openspec/changes/archive/2026-01-01-help/proposal.md': '# Change: Help\n\n## Modified Capabilities\n\n- `help`: clearer topics.\n',
    'openspec/changes/archive/2026-01-01-help/specs/ui/help/spec.md': '## MODIFIED Requirements\n\n### Requirement: Show help\n\n#### Scenario: Help topic\n',
    'openspec/changes/archive/2026-01-02-auth/proposal.md': '# Change: Auth\n\n## Modified Capabilities\n\n- `auth`: sign out.\n',
    'openspec/changes/archive/2026-01-02-auth/specs/auth/spec.md': '## MODIFIED Requirements\n\n### Requirement: Sign out\n\n#### Scenario: Session ends\n',
  };
  const inventory = discoverIds(files);
  assert.deepEqual([inventory.layout!.specRoot, inventory.layout!.specGrouped, inventory.layout!.changeSpecsGrouped], ['openspec/specs', true, true]);
  const proposal = validateProposal(candidateProposal(inventory), files);
  const by = (name: string) => proposal.suggestions.find(s => s.category.name === name)!;
  assert.equal(by('Capability').category.derive!.pattern, 'openspec/specs/**/{capability}/spec.md');
  assert.deepEqual(by('Requirement').category.idScopes, [{ pattern: 'openspec/specs/**/{capability}/spec.md' }, { pattern: 'openspec/changes/**/specs/**/{capability}/spec.md' }]);
  const draft = mergeProposal(LEGACY_ID_CONFIGURATION, proposal), index = indexProject(files, draft, new Map());
  const named = (name: string) => index.definitions.filter(o => o.category?.name === name);
  assert.deepEqual(named('Capability').map(o => o.id).sort(), ['auth', 'commands', 'help']);
  // "Sign in" in auth and in help are different requirements, each in its capability's scope.
  assert.deepEqual(named('Requirement').filter(o => o.id.toLowerCase() === 'sign in').map(o => o.scope).sort(), ['capability:auth', 'capability:help']);
  // The grouped delta's MODIFIED record refers to the current requirement of help.
  const modified = index.references.find(o => o.file.endsWith('2026-01-01-help/specs/ui/help/spec.md') && o.category?.name === 'Requirement')!;
  assert.deepEqual([modified.id, modified.scope], ['Show help', 'capability:help']);
  assert.deepEqual([index.findings.filter(f => f.kind === 'unresolved').length, index.findings.filter(f => f.kind === 'duplicate').length], [0, 0]);
  // A flat layout keeps 85c's patterns.
  const flat = discoverIds({ 'openspec/specs/a/spec.md': '# a\n', 'openspec/specs/b/spec.md': '# b\n' }).layout!;
  assert.deepEqual([flat.specRoot, flat.specGrouped], ['openspec/specs', undefined]);
});
