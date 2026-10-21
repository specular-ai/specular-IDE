import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { selectConfigurationTab, expandDiscoveryMethods } from './configuration-entries';

let app: ElectronApplication, page: Page, project: string;
const source = '# REQ-1 First\nStatus: Confirmed\n\n# REF-01 Candidate\nREF-02\n';
const configuration = { version: 1, categories: [{ key: 'req', name: 'Requirements' }], rules: [{ key: 'req', category: 'req', prefix: 'REQ' }], modules: [{ key: 'gui', name: 'GUI' }] };
const dialog = () => page.locator('#project-configuration-dialog');
const tab = (name: string) => page.getByRole('tab', { name, exact: true });
async function open() {
  await page.locator('#project-config-open').click();
  await expect(tab('Discover IDs')).toHaveAttribute('aria-selected', 'true');
  await expect(tab('Discover IDs')).toBeFocused();
  await expect(page.getByRole('tabpanel')).toHaveCount(1);
  await expandDiscoveryMethods(page);
  await tab('Discover IDs').focus();
}
async function preview() {
  await page.locator('#config-preview').click();
  await expect(page.locator('#config-status')).toContainText('Preview ready');
  await expect(page.locator('#config-apply')).toBeEnabled();
}
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.cache/ui-tests/configuration-tabs-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration));
  await writeFile(path.join(project, 'a.md'), source);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#metric-ids')).toHaveText('1');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('tabs preserve discovery review, scope, and edits; only actual draft changes invalidate suggestions', async () => {
  await open();
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click();
  const suggestion = page.locator('#discovery-review > .config-entry').filter({ hasText: 'REF-01' });
  await suggestion.locator(':scope > summary').click();
  await suggestion.getByLabel('Category display name', { exact: true }).fill('Reviewed category');
  const review = await page.locator('#discovery-review').textContent();
  for (const name of ['Categories', 'Definition and status sites', 'Application modules', 'Application features', 'Authored statuses', 'Dates', 'Discover IDs']) {
    await tab(name).click(); await expect(page.getByRole('tabpanel')).toHaveCount(1);
  }
  await expect(page.locator('#discovery-review')).toHaveText(review!);
  await expect(suggestion.getByLabel('Use suggestion')).toHaveCount(0);
  await expect(suggestion.getByLabel('Category display name', { exact: true })).toHaveValue('Reviewed category');
  await expect(page.getByRole('button', { name: 'Add suggestions to draft', exact: true })).toBeEnabled();
  await selectConfigurationTab(page, 'categories');
  await page.locator('.config-category').getByLabel('Name', { exact: true }).fill('Product requirements');
  await tab('Discover IDs').click(); await expect(page.locator('#discovery-review')).toBeEmpty();
  await expect(page.locator('#discovery-status')).toContainText('draft changed');
  await page.locator('#config-cancel').click(); await open();
  await selectConfigurationTab(page, 'categories');
  await expect(page.locator('.config-category').getByLabel('Name', { exact: true })).toHaveValue('Requirements');
});

test('shared preview applies inactive-tab edits and source resumption always selects Discover IDs', async () => {
  await open(); await selectConfigurationTab(page, 'categories');
  await page.locator('.config-category').getByLabel('Name', { exact: true }).fill('Product requirements');
  await selectConfigurationTab(page, 'modules'); await page.getByLabel('Module name', { exact: true }).fill('User interface');
  await tab('Discover IDs').click(); await preview();
  const summary = await page.locator('#config-summary').textContent();
  // Opening status controls must not start a scan or silently alter a reviewed draft.
  for (const name of ['Authored statuses', 'Categories', 'Application modules', 'Definition and status sites']) {
    await tab(name).click(); await expect(page.locator('#config-apply')).toBeEnabled();
    await expect(page.locator('#config-summary')).toHaveText(summary!);
  }
  await page.locator('#config-results').getByRole('button', { name: /^REQ-1/ }).click();
  await expect(dialog()).not.toBeVisible(); await open(); await expect(page.locator('#config-apply')).toBeEnabled();
  await selectConfigurationTab(page, 'categories'); await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Product requirements');
  await selectConfigurationTab(page, 'modules'); await expect(page.getByLabel('Module name', { exact: true })).toHaveValue('User interface');
  await tab('Discover IDs').click(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  expect(JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'))).toEqual({ ...configuration, categories: [{ key: 'req', name: 'Product requirements' }], modules: [{ key: 'gui', name: 'User interface' }] });
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(source);
  await open(); await preview(); await tab('Application modules').click();
  await writeFile(path.join(project, 'a.md'), source + '\nREQ-2\n');
  await expect(page.locator('#config-status')).toContainText('Markdown changed'); await expect(page.locator('#config-apply')).toBeDisabled();
});

test('keyboard tabs, focus and shared actions fit the minimum window in both themes', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    await open();
    await page.keyboard.press('ArrowLeft'); await expect(tab('Dates')).toBeFocused();
    await page.keyboard.press('ArrowRight'); await expect(tab('Discover IDs')).toBeFocused();
    await page.keyboard.press('End'); await expect(tab('Dates')).toBeFocused();
    await page.keyboard.press('Home'); await expect(tab('Discover IDs')).toBeFocused();
    await page.keyboard.press('ArrowRight'); await expect(tab('Categories')).toBeFocused();
    await expect(tab('Categories')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[role=tab][tabindex="0"]')).toHaveCount(1);
    await page.keyboard.press('Tab'); await expect(page.getByRole('tabpanel', { name: 'Categories', exact: true })).toBeFocused();
    await page.keyboard.press('Tab'); await expect(page.getByRole('button', { name: 'Add category', exact: true })).toBeFocused();
    for (const name of ['Categories', 'Definition and status sites', 'Application modules', 'Application features', 'Authored statuses', 'Dates', 'Discover IDs']) {
      await tab(name).click();
      for (const selector of ['#project-configuration-dialog', '.config-tabs', '#config-preview', '#config-apply']) {
        expect(await page.locator(selector).evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight; })).toBe(true);
      }
      expect(await dialog().evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: `test-results/configuration-tabs-${theme}.png` });
    await page.keyboard.press('Escape'); await expect(dialog()).not.toBeVisible();
  }
});
