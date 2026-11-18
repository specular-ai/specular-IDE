import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUNDLED_PROFILES, discoveryProviders, evaluateApplies, runProfiles, validateProfile } from '../src/core/discovery-profiles';
import { appliesError } from '../packages/plugin-api/src/index';
import { validateIdConfiguration } from '../src/core/id-configuration';
import { candidateProposal, discoverIds, mergeProposal, validateProposal } from '../src/core/id-discovery';
import { indexProject } from '../src/core/project-index';

/** Increment 97a: discovery providers written as profiles, with Kiro's heuristics as the bundled Kiro profile. */
const FEATURE = (n: number) => `# Requirements\n\n### Requirement ${n}: Sign in\n\n#### Acceptance Criteria\n\n1. THE system SHALL sign in\n2. THE system SHALL refuse\n`;
const BUGFIX = '# Bugfix Requirements Document\n\n### Current Behavior (Defect)\n\n1.1 WHEN it deploys THEN it fails\n\n### Expected Behavior (Correct)\n\n2.1 The stack SHALL deploy\n\n### Unchanged Behavior (Regression Prevention)\n\n3.1 It SHALL CONTINUE TO deploy\n';
const KIRO = { '.kiro/specs/a/requirements.md': FEATURE(1), '.kiro/specs/b/requirements.md': FEATURE(1) + FEATURE(2).replace('# Requirements\n', ''), '.kiro/specs/c/bugfix.md': BUGFIX, '.kiro/specs/c/tasks.md': '# Tasks\n\n- [ ] 1. Fix it\n  - _Requirements: 1.1, 2.1_\n' };
const KEYWORD = (value: string) => /^([A-Z][A-Za-z]*(?: [A-Z][A-Za-z]*)?) (\d{1,4})(?=$|[\s:.–—-])/u.exec(value)?.[1];

test('the bundled Kiro profile proposes acceptance and bugfix criteria, labelled with its tool', () => {
  const [kiro] = BUNDLED_PROFILES.map(validateProfile);
  assert.deepEqual([kiro.id, kiro.tool, kiro.detectors.map(d => d.kind)], ['kiro', 'Kiro', ['list-section', 'paragraph-sections', 'matching-lines']]);
  const inventory = discoverIds(KIRO);
  assert.deepEqual(inventory.providers!.map(p => [p.tool, p.results.map(r => r.kind)]), [['Kiro', ['list-section', 'paragraph-sections']]]);
  const proposal = validateProposal(candidateProposal(inventory), KIRO), criteria = proposal.suggestions.find(s => s.category.numberedItems)!;
  assert.equal(criteria.provider, 'Kiro');
  assert.deepEqual(criteria.category.numberedItems, { parent: 'discovered-k1', section: 'Acceptance Criteria', id: 'Criterion {parent}.{item}' });
  assert.equal(criteria.rule!.id, 'Criterion {group}.{item}');
  assert.deepEqual(criteria.category.sectionTags!.map(t => t.tag), ['bugfix:defect', 'bugfix:expected', 'bugfix:unchanged']);
  assert.match(criteria.uncertainty, /^6 items of ordered lists under "Acceptance Criteria" headings inside Requirement headings, in 2 files\. .* 3 criteria of Kiro bugfix specifications in 1 files \(1 current, 1 expected, 1 unchanged behaviour\)/);
  // The requirement rule stops before ".1", since items cite as Requirement 1.1; Specular's own suggestions have no provider.
  const requirement = proposal.suggestions.find(s => s.key === 'discovered-k1')!;
  assert.equal(requirement.rule!.pattern, String.raw`\bRequirement \d+\b(?!\.\d)`);
  assert.equal(requirement.provider, undefined);
});

test('an invalid profile is reported with its error and the other providers still run', () => {
  const broken = { schema: 1, id: 'broken', tool: 'Broken', versions: 'none', detectors: [{ id: 'x', kind: 'list-section', heading: 'Notes', within: 'numbered-keyword', min: 1, citations: '(' }], proposals: [] };
  const { providers, errors } = runProfiles([broken, ...BUNDLED_PROFILES], KIRO, KEYWORD);
  assert.deepEqual(providers.map(p => p.provider), ['kiro']);
  assert.deepEqual(errors, ['Profile broken: needs 1-16 proposals.']);
  const inventory = discoverIds(KIRO, [broken, ...BUNDLED_PROFILES]);
  assert.deepEqual(inventory.providerErrors, ['Profile broken: needs 1-16 proposals.']);
  assert.ok(candidateProposal(inventory, [broken, ...BUNDLED_PROFILES]).suggestions.some(s => s.provider === 'Kiro'));
  // Each part of a profile is checked.
  const valid = BUNDLED_PROFILES[0] as Record<string, any>;
  const errorOf = (change: (profile: Record<string, any>) => void) => { const profile = structuredClone(valid); change(profile); try { validateProfile(profile); return ''; } catch (error) { return (error as Error).message; } };
  assert.match(errorOf(p => { p.schema = 2; }), /schema must be 1/);
  assert.match(errorOf(p => { p.id = 'Kiro Tool'; }), /id must be/);
  assert.match(errorOf(p => { p.detectors[0].kind = 'tables'; }), /unknown kind/);
  assert.match(errorOf(p => { p.detectors[0].citations = '(?<x'; }), /citations is not a valid Unicode regular expression/);
  assert.match(errorOf(p => { p.detectors[1].line = '['; }), /line is not a valid Unicode regular expression/);
  assert.match(errorOf(p => { p.proposals[0].detector = 'missing'; }), /proposal 1 names no detector/);
  assert.match(errorOf(p => { p.proposals[1].join = 'anything'; }), /"join": "numbered-items"/);
  assert.match(errorOf(p => { p.proposals[0].references[0].list.item = '(?<n'; }), /reference item is not a valid Unicode regular expression/);
  assert.equal(errorOf(() => undefined), '');
});

test('a profile is data: another tool\'s success criteria under user stories are proposed by its own profile, only where it applies', () => {
  const profile = { schema: 1, id: 'stories', tool: 'Story Kit', versions: 'v1', applies: { files: ['stories/**'] },
    detectors: [{ id: 'success', kind: 'list-section', heading: 'Success Criteria', within: 'numbered-keyword', min: 3 }],
    proposals: [{ detector: 'success', key: '{{parent}}-success', name: 'Success criterion', numberedItems: { id: 'Success {parent}.{item}' }, scope: 'parent',
      uncertainty: [{ text: '{{items}} success criteria under {{keyword}} headings in {{files}} files.' }] }] };
  const story = (n: number) => `# Stories\n\n## Story ${n}: Export\n\n### Success Criteria\n\n1. Reports export\n2. Exports are dated\n`;
  const files = { 'stories/a.md': story(1), 'stories/b.md': story(1) + story(2).replace('# Stories\n', '') };
  const proposal = validateProposal(candidateProposal(discoverIds(files, [profile]), [profile]), files);
  const success = proposal.suggestions.find(s => s.provider === 'Story Kit')!;
  assert.deepEqual([success.key, success.category.name, success.category.numberedItems], ['discovered-k1-success', 'Success criterion', { parent: 'discovered-k1', section: 'Success Criteria', id: 'Success {parent}.{item}' }]);
  assert.equal(success.uncertainty, '6 success criteria under Story headings in 2 files.');
  // 97d: outside its files the profile does not apply, so it is off unless the project turns it on; the 97a form reads as `any`.
  const project = [{ file: '.specular/profiles/stories.json', profile }], elsewhere = Object.keys(files).map(file => file.replace('stories/', 'docs/'));
  const here = discoveryProviders(project, {}, [], Object.keys(files)), there = discoveryProviders(project, {}, [], elsewhere);
  assert.deepEqual(here.providers.find(p => p.id === 'stories'), { id: 'stories', tool: 'Story Kit', versions: 'v1', source: 'project', file: '.specular/profiles/stories.json', applies: true, declared: true, files: 2, example: 'stories/a.md', enabled: true });
  assert.deepEqual([here.profiles.map(p => p.id), there.profiles.map(p => p.id), discoveryProviders(project, { enabled: ['stories'] }, [], elsewhere).profiles.map(p => p.id)], [['stories'], [], ['stories']]);
  assert.deepEqual(validateProfile(profile).applies, { any: [{ files: 'stories/**' }] });
});

test('the Trae profile: tasks and subtasks per spec folder, defined by checkbox items or task headings, cited by dependency lines', () => {
  const tasks = (n: number) => `# Tasks\n- [x] Task 1: Read the code\n  - [x] SubTask 1.1: List modules\n  - [ ] SubTask 1.2: List scripts\n- [ ] Task 2: Plan\n  - [ ] SubTask 2.1: Draft\n${n > 2 ? '- [ ] Task 3: Report\n' : ''}\n# Task Dependencies\n- Task 2 depends on Task 1.\n`;
  const files = { '.trae/specs/a/tasks.md': tasks(3), '.trae/specs/a/spec.md': '# Spec\n\nTask 1 comes first.\n', '.trae/specs/b/tasks.md': tasks(2),
    // A talebook-style spec: task headings with a checkbox.
    '.trae/specs/c/tasks.md': '# Tasks\n\n## [x] Task 1: Model\n\n## [ ] Task 2: View\n', 'notes/plan.md': '- [ ] Task 9: elsewhere\n' };
  const setup = discoveryProviders([], {}, [], Object.keys(files));
  assert.deepEqual(setup.profiles.map(p => p.id), ['trae']);
  const proposal = validateProposal(candidateProposal(discoverIds(files, setup.profiles), setup.profiles), files);
  const task = proposal.suggestions.find(s => s.key === 'trae-task')!, subtask = proposal.suggestions.find(s => s.key === 'trae-subtask')!;
  assert.deepEqual([task.provider, task.category.name, task.category.role, task.category.idScopes, task.category.definitionPaths, task.rule?.pattern], ['Trae', 'Task', 'task', [{ pattern: '**/.trae/specs/*' }], ['**/.trae/specs/*/tasks.md'], String.raw`\bTask \d+\b(?!\.\d)`]);
  // Dependency lines are not checkbox items, so they are not counted.
  assert.match(task.uncertainty, /^7 task items or headings in 3 tasks\.md files/);
  assert.match(subtask.uncertainty, /^6 subtask items in 2 tasks\.md files/);
  const index = indexProject(files, mergeProposal(validateIdConfiguration({ version: 1, categories: [], rules: [] }), { version: 1, suggestions: [task, subtask] }));
  const defined = (key: string) => index.definitions.filter(o => o.category?.key === key).map(o => `${o.scope}:${o.id}`).sort();
  assert.deepEqual(defined('trae-task'), ['.trae/specs/a:Task 1', '.trae/specs/a:Task 2', '.trae/specs/a:Task 3', '.trae/specs/b:Task 1', '.trae/specs/b:Task 2', '.trae/specs/c:Task 1', '.trae/specs/c:Task 2']);
  assert.deepEqual(defined('trae-subtask'), ['.trae/specs/a:SubTask 1.1', '.trae/specs/a:SubTask 1.2', '.trae/specs/a:SubTask 2.1', '.trae/specs/b:SubTask 1.1', '.trae/specs/b:SubTask 1.2', '.trae/specs/b:SubTask 2.1']);
  // "Task 2 depends on Task 1" and the spec's mention cite their folder's tasks; outside tasks.md nothing defines them.
  assert.deepEqual(index.references.filter(o => o.category?.key === 'trae-task').map(o => `${o.file}:${o.id}`).sort(), ['.trae/specs/a/spec.md:Task 1', '.trae/specs/a/tasks.md:Task 1', '.trae/specs/a/tasks.md:Task 2', '.trae/specs/b/tasks.md:Task 1', '.trae/specs/b/tasks.md:Task 2', 'notes/plan.md:Task 9']);
  // matching-lines is validated like the other kinds.
  const bad = (detector: Record<string, unknown>, proposal: Record<string, unknown> = {}) => () => validateProfile({ schema: 1, id: 'x', tool: 'X', versions: 'v', detectors: [{ id: 'd', kind: 'matching-lines', files: ['*.md'], pattern: '^T', min: 1, ...detector }],
    proposals: [{ detector: 'd', join: 'category', create: { key: 'k', name: 'K' }, rule: { key: 'k', pattern: 'T' }, uncertainty: [{ text: 't' }], ...proposal }] });
  assert.doesNotThrow(bad({}));
  assert.throws(bad({ pattern: '(' }), /not a valid Unicode regular expression/);
  assert.throws(bad({ checkboxOnly: 'yes' }), /checkboxOnly must be true or false/);
  assert.throws(bad({}, { join: 'numbered-items' }), /"join": "category"/);
  assert.throws(bad({}, { create: { key: 'k', name: 'K', role: 'epic' } }), /role/i);
});

test('applicability: files and folders conditions over Markdown paths, combined with any and all, and validated', () => {
  const paths = ['.kiro/specs/a/requirements.md', '.kiro/specs/Area/b/bugfix.md', 'specs/001-a/spec.md', 'specs/001-a/plan.md', 'README.md'];
  assert.deepEqual(evaluateApplies(undefined, paths), { applies: true, declared: false, files: 0 });
  // A folder holds Markdown directly or in subfolders, so area folders count; globs ignore case.
  assert.deepEqual(evaluateApplies({ folders: '**/.kiro/specs/*' }, paths), { applies: true, declared: true, files: 2, example: '.kiro/specs/Area/b/bugfix.md' });
  assert.deepEqual(evaluateApplies({ folders: '**/.kiro/specs/*', min: 3 }, paths).applies, false);
  assert.deepEqual(evaluateApplies({ files: 'SPECS/*/SPEC.md' }, paths).files, 1);
  assert.equal(evaluateApplies({ all: [{ files: 'specs/*/spec.md' }, { files: 'specs/*/tasks.md' }] }, paths).applies, false);
  assert.deepEqual(evaluateApplies({ any: [{ folders: '**/.specify' }, { all: [{ files: 'specs/*/spec.md' }, { files: 'specs/*/plan.md' }] }] }, paths), { applies: true, declared: true, files: 2, example: 'specs/001-a/plan.md' });
  assert.equal(appliesError({ any: [{ files: 'a' }, { all: [{ folders: 'b', min: 2 }] }] }), undefined);
  for (const bad of [{}, { files: '' }, { files: 'a', min: 0 }, { files: 'a', folders: 'b' }, { any: [] }, { any: [{ all: [{ any: [{ files: 'a' }] }] }] }, { any: Array.from({ length: 17 }, () => ({ files: 'a' })) }])
    assert.match(appliesError(bad) ?? '', /^applies must be/, JSON.stringify(bad));
  // The bundled profiles apply where their tool's folders are.
  const bundled = (files: string[]) => discoveryProviders([], {}, [], files).providers.map(p => [p.id, p.applies]);
  assert.deepEqual(bundled(paths), [['kiro', true], ['spec-kit', false], ['trae', false]]);
  assert.deepEqual(bundled(['.specify/memory/constitution.md']), [['kiro', false], ['spec-kit', true], ['trae', false]]);
  assert.deepEqual(bundled(['specs/001-a/spec.md', 'specs/001-a/plan.md', 'specs/001-a/tasks.md']), [['kiro', false], ['spec-kit', true], ['trae', false]]);
  assert.deepEqual(bundled(['.trae/specs/a/tasks.md']), [['kiro', false], ['spec-kit', false], ['trae', true]]);
  // Switches: enabled turns on where it does not apply, disabled turns off; the lists are disjoint, and empty ones are dropped.
  assert.deepEqual(discoveryProviders([], { enabled: ['spec-kit'], disabled: ['kiro'] }, [], paths).providers.map(p => p.enabled), [false, true, false]);
  assert.deepEqual(validateIdConfiguration({ version: 1, categories: [], rules: [], discoveryProviders: { enabled: ['spec-kit'] } }).discoveryProviders, { enabled: ['spec-kit'] });
  assert.equal(validateIdConfiguration({ version: 1, categories: [], rules: [], discoveryProviders: {} }).discoveryProviders, undefined);
  assert.throws(() => validateIdConfiguration({ version: 1, categories: [], rules: [], discoveryProviders: { enabled: ['kiro'], disabled: ['kiro'] } }), /both enabled and disabled/);
});
