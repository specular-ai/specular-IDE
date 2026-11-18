import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expandDiscoveryMethods, selectConfigurationTab } from './configuration-entries';

/** Increment 99a: tool templates and agent command copies are proposed for exclusion and then left out of analysis. */
let app: ElectronApplication, page: Page, root: string, project: string;
const CONFIGURATION = { version: 1, categories: [{ key: 'task', name: 'Task', role: 'task' }], rules: [{ key: 'task', category: 'task', pattern: '\\bT\\d{3}\\b' }],
  idDefinitionSites: { headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered'], mode: 'start' } } };
const FILES: Record<string, string> = {
  '.specular/project.json': JSON.stringify(CONFIGURATION),
  'specs/001-login/tasks.md': '# Tasks\n\n- [x] T001 Build the form\n- [x] T002 Add sign-out\n',
  '.specify/templates/tasks-template.md': '# Tasks: [FEATURE]\n\n- [ ] T001 Create project structure\n- [ ] T002 Initialize project\n- [ ] T003 Configure linting\n',
  '.claude/commands/speckit.tasks.md': '# Tasks command\n\nUnique command text.\n\n- [ ] T004 Example task\n',
};
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#workspace')).toBeVisible();
}
async function open() {
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
}
const entry = (text: string) => page.locator('#discovery-review > .config-entry').filter({ has: page.locator(':scope > summary').filter({ hasText: text }) });
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/excluded-paths-')); project = path.join(root, 'project');
  for (const [file, text] of Object.entries(FILES)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  await launch();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('Discover proposes tool folders for exclusion; once applied they are browsable but not analyzed', async () => {
  // Before: the template and command tasks are defined, duplicated, and pending.
  await expect(page.locator('#metric-ids')).toHaveText('6');
  await expect(page.locator('#metric-pending')).toHaveText('4');

  await open();
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Found 2 tool folders to exclude from analysis.');
  const exclusion = entry('Exclude tool folders from analysis (2)');
  await exclusion.locator(':scope > summary').click();
  await expect(exclusion.locator('.discovery-exclusion-paths li')).toHaveText(['.specify/templates: 1 file, 3 definitions, 3 pending', '.claude/commands: 1 file, 1 definition, 1 pending']);
  await expect(exclusion).toContainText('Excluded files stay in the Explorer');
  // Keep only the exclusion.
  for (const item of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    if ((await item.locator(':scope > summary').textContent())!.includes('Exclude tool folders')) continue;
    await item.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Excluded .specify/templates, .claude/commands from analysis');

  await selectConfigurationTab(page, 'excluded');
  await expect(page.locator('#config-excluded-paths-input')).toHaveValue('.specify/templates, .claude/commands');
  await expect(page.locator('#config-excluded-paths-coverage')).toHaveText('Excludes 2 of 3 indexed Markdown files.');
  await page.locator('#config-excluded-paths-input').fill('.specify/templates, .claude/commands, ../outside');
  await expect(page.locator('#config-excluded-paths-coverage')).toContainText('Excluded path "../outside" is invalid');
  await page.locator('#config-excluded-paths-input').fill('.specify/templates, .claude/commands');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  expect(JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')).excludedPaths).toEqual(['.specify/templates', '.claude/commands']);

  // After: only the real tasks count; the excluded files are muted but still open and search.
  await expect(page.locator('#metric-ids')).toHaveText('2');
  await expect(page.locator('#metric-pending')).toHaveText('0');
  await expect(page.locator('#files [data-folder=".specify"]')).not.toHaveClass(/excluded/);
  await page.locator('#files [data-folder=".specify"]').click();
  await expect(page.locator('#files [data-folder=".specify/templates"]')).toHaveClass(/excluded/);
  await page.locator('#files [data-folder=".specify/templates"]').click();
  const template = page.locator('#files [data-file=".specify/templates/tasks-template.md"]');
  await expect(template).toHaveClass(/excluded/);
  await expect(template).toHaveAttribute('title', '.specify/templates/tasks-template.md - excluded from analysis (.specify/templates)');
  await expect(page.locator('#files [data-folder="specs"]')).not.toHaveClass(/excluded/);
  await template.click();
  await expect(page.locator('#document-path')).toHaveText('.specify/templates/tasks-template.md');
  await expect(page.locator('#preview')).toContainText('Create project structure');
  await expect(page.locator('#preview .id-link')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+F');
  await page.locator('#markdown-search-query').fill('Unique command text');
  await page.locator('#markdown-search-query').press('Enter');
  await expect(page.locator('#markdown-search-panel')).toContainText('speckit.tasks.md');
});
