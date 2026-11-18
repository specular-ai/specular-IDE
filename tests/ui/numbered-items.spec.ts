import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expandDiscoveryMethods } from './configuration-entries';

/** Increment 96d: Kiro acceptance criteria numbered by position, proposed by discovery and edited in Categories. */
let app: ElectronApplication, page: Page, root: string, project: string;
const requirements = (title: string) => `# ${title}\n\n### Requirement 1: Sign in\n\n#### Acceptance Criteria\n\n1. WHEN a user enters valid credentials THE system SHALL sign them in\n2. WHEN the password is wrong THE system SHALL refuse\n\n### Requirement 2: Export\n\n#### Acceptance Criteria\n\n1. THE system SHALL export reports\n2. THE system SHALL email them\n`;
const FILES: Record<string, string> = {
  '.kiro/specs/a/requirements.md': requirements('A'),
  '.kiro/specs/a/tasks.md': '# Tasks\n\n- [ ] 1. Build sign-in\n  - _Requirements: 1.1, 2.2_\n',
  '.kiro/specs/b/requirements.md': requirements('B'),
  '.kiro/specs/b/design.md': '# Design\n\n### Property 1: Wrong passwords are refused\n\n**Validates: Requirements 1.2**\n',
};
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow(); await expect(page.locator('#project-heading')).toHaveText('project');
}
const entry = (text: string) => page.locator('#discovery-review > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: text }) });
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/numbered-items-')); project = path.join(root, 'project');
  for (const [file, text] of Object.entries(FILES)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  await launch();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('discovery proposes acceptance criteria and their citations; staged criteria resolve and appear in Categories and Project Lens', async () => {
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('candidate groups');
  const criteria = entry('- Acceptance criterion');
  await expect(criteria.locator(':scope > summary')).toContainText('Criterion 1.1 - Acceptance criterion');
  await criteria.locator(':scope > summary').click();
  await expect(criteria.locator('.discovery-convention')).toContainText('Each item of an ordered list under "Acceptance Criteria" inside a Requirement is numbered by its position: the second item under Requirement 3 is Criterion 3.2. Citations such as "Requirements: 3.2" or "Validates: Requirements 3.2" refer to Criterion 3.2, and "Requirements: 3" refers to Requirement 3.');
  await expect(criteria).toContainText('8 items of ordered lists under "Acceptance Criteria" headings inside Requirement headings, in 2 files.');
  for (const item of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    const title = (await item.locator(':scope > summary').textContent())!;
    if (title.includes('- Requirement') || title.includes('- Acceptance criterion')) continue;
    await item.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Nothing has been saved');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await expect(page.locator('#config-summary')).toContainText('0 unresolved references · 0 duplicate definitions');
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const category = page.locator('#config-categories > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: 'Acceptance criterion' }) });
  if (await category.getAttribute('open') === null) await category.locator(':scope > summary').click();
  const numbered = category.locator('.config-category-numbered');
  // The open section spans the row, so the category's other fields keep their columns.
  expect((await category.getByLabel('Name', { exact: true }).boundingBox())!.width).toBeGreaterThan(200);
  await expect(numbered.getByLabel('Parent category of numbered items', { exact: true }).locator('option:checked')).toHaveText('Requirement');
  await expect(numbered.getByLabel('Section heading (optional)', { exact: true })).toHaveValue('Acceptance Criteria');
  await expect(numbered.getByLabel('Element ID template', { exact: true })).toHaveValue('Criterion {parent}.{item}');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.find((c: { name: string }) => c.name === 'Acceptance criterion').numberedItems).toMatchObject({ section: 'Acceptance Criteria', id: 'Criterion {parent}.{item}' });
  expect(saved.rules.filter((r: { list?: unknown }) => r.list).length).toBe(2);
  await expect(page.locator('.lens-card').filter({ hasText: 'Criterion 1.1 · .kiro/specs/a' }).filter({ hasText: 'WHEN a user enters valid credentials' })).toHaveCount(1);
});

test('bugfix criteria are proposed with the acceptance criteria, defined by a rule that defines, and resolve their citations (96e)', async () => {
  await mkdir(path.join(project, '.kiro/specs/fix'), { recursive: true });
  await writeFile(path.join(project, '.kiro/specs/fix/bugfix.md'), '# Bugfix Requirements Document\n\n## Bug Analysis\n\n### Current Behavior (Defect)\n\n1.1 WHEN the stack deploys THEN the functions fail\n\n### Expected Behavior (Correct)\n\n2.1 The stack SHALL deploy in order\n2.2 The stack SHALL report progress\n\n### Unchanged Behavior (Regression Prevention)\n\n3.1 WHEN images exist THEN the system SHALL CONTINUE TO deploy\n');
  await writeFile(path.join(project, '.kiro/specs/fix/tasks.md'), '# Tasks\n\n- [x] 1.1 Fix the order\n  - _Requirements: 2.1, 2.2, 3.1_\n');
  await page.locator('#refresh').click();
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('candidate groups');
  const criteria = entry('- Acceptance criterion');
  await criteria.locator(':scope > summary').click();
  await expect(criteria.locator('.discovery-convention')).toContainText('Paragraphs starting with a number, such as "2.1 The system SHALL …" in a bugfix specification, define Criterion 2.1.');
  await expect(criteria).toContainText('4 criteria of Kiro bugfix specifications in 1 files (1 current, 2 expected, 1 unchanged behaviour)');
  // 97a: proposed by the bundled Kiro profile, and listed after Specular's own suggestions.
  await expect(criteria.locator(':scope > summary')).toContainText('- Acceptance criterion · Kiro');
  await expect(criteria.locator('.discovery-provider')).toHaveText('Proposed by the Kiro profile.');
  const titles = (await page.locator('#discovery-review > .config-entry > summary').allTextContents()).filter(title => !title.includes('Folder-derived'));
  expect(titles.findIndex(title => title.includes('· Kiro'))).toBe(titles.length - 1);
  await expect(criteria.getByLabel('Suggested regex', { exact: true })).toHaveCount(0);
  // 96f: the behaviour sections become tags.
  await expect(criteria.locator('.discovery-tags')).toContainText('Tagged by section: "Current Behavior (Defect)" as bugfix:defect, "Expected Behavior (Correct)" as bugfix:expected, "Unchanged Behavior (Regression Prevention)" as bugfix:unchanged.');
  for (const item of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    const title = (await item.locator(':scope > summary').textContent())!;
    if (title.includes('- Requirement') || title.includes('- Acceptance criterion')) continue;
    await item.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Nothing has been saved');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await expect(page.locator('#config-summary')).toContainText('0 unresolved references · 0 duplicate definitions');
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const category = page.locator('#config-categories > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: 'Acceptance criterion' }) });
  if (await category.getAttribute('open') === null) await category.locator(':scope > summary').click();
  await expect(category.getByLabel('Defines at definition sites', { exact: true })).toBeChecked();
  // 96f: the Section tags list shows the proposed tags; its open section spans the row.
  const tags = category.locator('.config-category-tags');
  if (await tags.getAttribute('open') === null) await tags.locator(':scope > summary > span').click();
  await expect(tags.getByLabel('Heading text', { exact: true })).toHaveCount(3);
  await expect(tags.getByLabel('Tag', { exact: true }).nth(1)).toHaveValue('bugfix:expected');
  expect((await category.getByLabel('Name', { exact: true }).boundingBox())!.width).toBeGreaterThan(200);
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  await expect(page.locator('.lens-card').filter({ hasText: 'Criterion 2.1 · .kiro/specs/fix' }).filter({ hasText: '2.1 The stack SHALL deploy in order' })).toHaveCount(1);
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.find((c: { name: string }) => c.name === 'Acceptance criterion').sectionTags.map((t: { tag: string }) => t.tag)).toEqual(['bugfix:defect', 'bugfix:expected', 'bugfix:unchanged']);
  // 96f: cards show tags; the Lens filters by tag and groups by tag with an untagged group.
  await expect(page.locator('.lens-card').filter({ hasText: 'Criterion 2.1 · .kiro/specs/fix' }).locator('.tag-badge')).toHaveText('bugfix:expected');
  await page.locator('#tag-filter').selectOption('bugfix:expected');
  await expect(page.locator('#lens-results .lens-card')).toHaveCount(2);
  await page.locator('#tag-filter').selectOption('');
  await page.locator('#lens-grouping').selectOption('tag');
  await expect(page.locator('#lens-results .lens-group > summary > span:first-child')).toHaveText(['bugfix:defect', 'bugfix:expected', 'bugfix:unchanged', 'Untagged']);
  await expect(page.locator('#lens-results .lens-group').filter({ hasText: 'bugfix:expected' }).locator('.lens-group-count')).toHaveText('2 IDs');
});

test('Kiro tasks are proposed from checkbox items in tasks.md, stage with the criteria, and carry their checkbox statuses (104)', async () => {
  await writeFile(path.join(project, '.kiro/specs/a/tasks.md'), '# Tasks\n\n- [ ] 1. Build sign-in\n  - [x] 1.1 Add the form\n    - _Requirements: 1.1, 2.2_\n  - [-] 1.2 Check the password\n- [ ] 2. Export after Task 1\n');
  await writeFile(path.join(project, '.kiro/specs/b/tasks.md'), '# Tasks\n\n- [x] 1. Export reports\n- [ ] 2. Email them\n');
  await page.locator('#refresh').click();
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('candidate groups');
  const tasks = entry('- Task · Kiro');
  await tasks.locator(':scope > summary').click();
  await expect(tasks.locator('.discovery-convention')).toContainText('Checkbox items starting with a number, such as "- [ ] 1.1 …" in **/.kiro/specs/**/tasks.md, define Task 1.1.');
  await expect(tasks.locator('.discovery-convention')).toContainText('Checkbox markers give their status.');
  await expect(tasks).toContainText('6 checkbox items starting with a number in 2 tasks.md files of Kiro specs');
  for (const item of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    const title = (await item.locator(':scope > summary').textContent())!;
    if (title.includes('- Requirement') || title.includes('- Acceptance criterion') || title.includes('- Task')) continue;
    await item.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Nothing has been saved');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await expect(page.locator('#config-summary')).toContainText('0 unresolved references · 0 duplicate definitions');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  await expect(page.locator('.lens-card').filter({ hasText: 'Task 1.1 · .kiro/specs/a' })).toHaveCount(1);
  await expect(page.locator('.lens-card').filter({ hasText: 'Task 1.1 · .kiro/specs/a' })).toContainText('Done');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.rules.find((r: { key: string }) => r.key === 'kiro-task')).toMatchObject({ id: 'Task {task}', defines: true });
  expect(saved.categories.find((c: { key: string }) => c.key === 'kiro-task').statusSites.checkboxes.enabled).toBe(true);
});
