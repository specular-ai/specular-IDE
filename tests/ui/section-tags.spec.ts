import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expandDiscoveryMethods } from './configuration-entries';

/** Increment 96g: Spec Kit phase and priority tags, proposed by discovery as pattern entries and shown in Project Lens. */
let app: ElectronApplication, page: Page, root: string, project: string;
const tasks = (title: string) => `# Tasks: ${title}\n\n## Phase 1: Setup (Shared Infrastructure)\n\n- [ ] T001 Create the project\n- [ ] T002 [P] Configure linting\n\n## Phase 2: Foundational (Blocking Prerequisites)\n\n- [ ] T003 Add the database\n\n## Phase 3: User Story 1 - Sign in (Priority: P1) 🎯 MVP\n\n- [ ] T004 [US1] Sign in\n\n## Phase 4: User Story 2 - Export (Priority: P2)\n\n- [x] T005 [US2] Export reports\n\n## Phase 5: Polish & Cross-Cutting Concerns\n\n- [ ] T006 Update docs\n\n## Parallel Example\n\n- T001, T002 can run in parallel\n`;
const FILES: Record<string, string> = { '.specify/memory/constitution.md': '# Constitution\n', 'specs/001-a/tasks.md': tasks('A'), 'specs/002-b/tasks.md': tasks('B'), 'specs/003-c/tasks.md': tasks('C') };
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow(); await expect(page.locator('#project-heading')).toHaveText('project');
}
const entry = (text: string) => page.locator('#discovery-review > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: text }) });
// Increment 96h: as in the local swift-secp256k1, the project already has a Tasks category with a narrower rule and no tags.
const EXISTING = { version: 1, categories: [{ key: 'TASK', name: 'Tasks', role: 'task', idScopes: [{ pattern: 'specs/*' }] }], rules: [{ key: 'task', category: 'TASK', pattern: String.raw`\bT\d{3}\b` }] };
test.beforeEach(async ({}, info) => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/section-tags-')); project = path.join(root, 'project');
  for (const [file, text] of Object.entries(FILES)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  if (info.title.includes('existing')) { await mkdir(path.join(project, '.specular'), { recursive: true }); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(EXISTING)); }
  await launch();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('discovery proposes phase and priority pattern tags for Spec Kit tasks; Preview counts them and Project Lens groups by them', async () => {
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('candidate groups');
  const taskEntry = entry('T001');
  await taskEntry.locator(':scope > summary').click();
  await expect(taskEntry.locator('.discovery-tags')).toContainText('Tagged by section: headings matching ^Phase \\d+: (?<phase>Setup|Foundational|Polish)\\b as phase:{phase}');
  await expect(taskEntry).toContainText('In 3 task lists, 9 Setup, Foundational, or Polish phase headings');
  for (const item of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    if ((await item.locator(':scope > summary').textContent())!.includes('T001')) continue;
    await item.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Nothing has been saved');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await expect(page.locator('#config-summary')).toContainText('Section tags: phase:foundational 3, phase:polish 3, phase:setup 6, priority:p1 3, priority:p2 3');
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const category = page.locator('#config-categories > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: 'T' }) }).last();
  if (await category.getAttribute('open') === null) await category.locator(':scope > summary').click();
  const section = category.locator('.config-category-tags');
  if (await section.getAttribute('open') === null) await section.locator(':scope > summary > span').click();
  await expect(section.getByLabel('Match', { exact: true }).locator('option:checked')).toHaveText(['Pattern', 'Pattern']);
  await expect(section.getByLabel('Tag', { exact: true }).nth(1)).toHaveValue('priority:{priority}');
  // Switching a row to a heading text keeps the typed value.
  await section.getByLabel('Match', { exact: true }).nth(1).selectOption('heading');
  await expect(section.getByLabel('Heading text', { exact: true })).toHaveValue(String.raw`\(Priority: (?<priority>P\d)\)`);
  await section.getByLabel('Match', { exact: true }).nth(1).selectOption('pattern');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.find((c: { sectionTags?: unknown }) => c.sectionTags).sectionTags[1]).toEqual({ pattern: String.raw`\(Priority: (?<priority>P\d)\)`, tag: 'priority:{priority}' });
  await page.locator('#lens-grouping').selectOption('tag');
  await expect(page.locator('#lens-results .lens-group > summary > span:first-child')).toHaveText(['phase:foundational', 'phase:polish', 'phase:setup', 'priority:p1', 'priority:p2']);
  await page.locator('#lens-grouping').selectOption('none');
  // The filter lists the tags built from headings.
  await page.locator('#tag-filter').selectOption('priority:p2');
  await expect(page.locator('#lens-results .lens-card')).toHaveCount(3);
});

test('discovery offers the task tags for an existing Tasks category; staging adds them without the rule and Preview reports no overlap', async () => {
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('1 suggestion adds section tags to existing categories');
  const tags = entry('Add section tags to Tasks');
  await tags.locator(':scope > summary').click();
  await expect(tags).toContainText('Tasks already recognizes these IDs, so the tags can be added to it without the suggested rule.');
  await expect(tags.locator('.discovery-tags')).toContainText('headings matching ^Phase \\d+: (?<phase>Setup|Foundational|Polish)\\b as phase:{phase}');
  await expect(tags).toContainText('Its list definitions are off, so checkbox list items will define its IDs.');
  // The ambiguous T suggestion stays for review; delete everything else.
  await expect(entry('T001')).toContainText('Ambiguous: the examples are recognized');
  for (const item of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    if ((await item.locator(':scope > summary').textContent())!.includes('Add section tags')) continue;
    await item.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await expect(page.locator('#discovery-remaining')).toHaveText('1 suggestions remaining');
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Added section tags to Tasks. Review each category');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await expect(page.locator('#config-summary')).toContainText('Section tags: phase:foundational 3, phase:polish 3, phase:setup 6, priority:p1 3, priority:p2 3');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.rules).toEqual(EXISTING.rules);
  expect(saved.categories.map((c: { key: string }) => c.key)).toEqual(['TASK']);
  expect(saved.categories[0].sectionTags.map((t: { tag: string }) => t.tag)).toEqual(['phase:{phase}', 'priority:{priority}']);
  expect(saved.categories[0].idDefinitionSites.lists).toEqual({ enabled: true, types: ['unordered', 'ordered'], mode: 'start', checkboxOnly: true });
});
