import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Increment 88: task checkbox markers as authored statuses.
let app: ElectronApplication, page: Page, root: string, project: string;
const lists = { headings: { enabled: false, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered'], mode: 'start' } };
const config = { version: 1, categories: [{ key: 'task', name: 'Tasks', role: 'task', idDefinitionSites: lists }], rules: [{ key: 't', category: 'task', pattern: '^\\d+(?:\\.\\d+)*' }] };
const source = '# Tasks\n\n- [x] 1. Write tests\n  - [x] 1.1 Unit tests\n  - [ ] 1.2 Integration tests\n- [-] 2. Phase one\n';
const card = (id: string) => page.locator(`#lens-results .lens-card[data-id="${id}"]`).first();
const statusSites = () => page.locator('#config-status-sites');
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/checkbox-statuses-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config)); await writeFile(path.join(project, 'tasks.md'), source);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#project-heading')).toHaveText('project'); await expect(card('2')).toBeVisible();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app?.close().catch(() => {});
});

test('the checkbox site is enabled, a mapping is edited, and task statuses preview, apply, and group', async () => {
  await expect(card('1').locator('.status-badge')).toHaveCount(0);
  await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Definition and status sites', exact: true }).click();
  const enable = statusSites().getByLabel('Enable checkbox statuses');
  await expect(enable).not.toBeChecked();
  await expect(statusSites().getByLabel('Checkbox marker 4', { exact: true })).toHaveValue('-');
  await enable.check();
  await statusSites().getByLabel('Status value for checkbox marker 4', { exact: true }).fill('Working');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-filter').selectOption('statuses');
  const row = (id: string) => page.locator('.config-status-result').filter({ has: page.locator('button.config-result', { hasText: new RegExp(`^${id.replace('.', '\\.')}\\b`) }) });
  await expect(row('2')).toContainText('checkboxes: Working');
  await expect(row('1.2')).toContainText('checkboxes: Open');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.statusSites.checkboxes).toEqual({ enabled: true, markers: { x: 'Done', X: 'Done', ' ': 'Open', '-': 'Working' } });
  await expect(card('1').locator('.status-badge').first()).toHaveText('Done');
  await expect(card('2').locator('.status-badge').first()).toHaveText('Working');
  await page.getByLabel('Group definitions by').selectOption('status');
  await expect(page.locator('.lens-group > summary')).toHaveText(['Done2 IDs', 'Open1 ID', 'Working1 ID']);
  expect(await readFile(path.join(project, 'tasks.md'), 'utf8')).toBe(source);
});
