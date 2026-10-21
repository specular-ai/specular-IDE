import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Increment 91: list-item status labels and checkbox-only list definitions.
let app: ElectronApplication, page: Page, root: string, project: string;
const sites = { headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered'], mode: 'start' } };
const config = { version: 1, categories: [{ key: 'item', name: 'Items' }], rules: [{ key: 'r', category: 'item', pattern: '(?:M\\d+|T\\d{3})' }], idDefinitionSites: sites };
const source = '# Progress\n\n## M1 First milestone\n\n- **Status**: DONE\n- **Owner**: Ana\n\n## Tasks\n\n- [ ] T001 Build\n- [x] T002 Test\n- T001 and T002 can run in parallel\n';
const card = (id: string) => page.locator(`#lens-results .lens-card[data-id="${id}"]`).first();
const open = async () => { await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Definition and status sites', exact: true }).click(); };
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/list-item-statuses-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config)); await writeFile(path.join(project, 'progress.md'), source);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#project-heading')).toHaveText('project'); await expect(card('M1')).toBeVisible();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app?.close().catch(() => {});
});

test('Also read list items previews a list-item status and applies', async () => {
  await expect(card('M1').locator('.status-badge')).toHaveCount(0);
  await open();
  const listItems = page.locator('#config-status-sites').getByLabel('Also read list items');
  await expect(listItems).not.toBeChecked(); await listItems.check();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-filter').selectOption('statuses');
  await expect(page.locator('.config-status-result').filter({ has: page.locator('button.config-result', { hasText: /^M1\b/ }) })).toContainText('paragraphs: DONE');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.statusSites.paragraphs).toEqual({ enabled: true, mode: 'literal', label: 'Status:', listItems: true });
  await expect(card('M1').locator('.status-badge').first()).toHaveText('DONE');
});

test('Only items with a checkbox keeps plain items as references', async () => {
  const definitions = () => page.locator('#lens-results .lens-card[data-id="T001"]');
  await expect(definitions()).toHaveCount(2);
  await open();
  await page.locator('#config-definition-sites').getByLabel('Only items with a checkbox').check();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.idDefinitionSites.lists).toEqual({ enabled: true, types: ['unordered'], mode: 'start', checkboxOnly: true });
  await expect(definitions()).toHaveCount(1); await expect(card('T002')).toBeVisible();
  expect(await readFile(path.join(project, 'progress.md'), 'utf8')).toBe(source);
});
