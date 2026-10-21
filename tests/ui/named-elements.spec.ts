import { failAutosave } from './autosave-fixture';
import { selectConfigurationTab } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

// Increment 85a: keyword headings, a parent category, a capture scope, and derived elements, configured in the dialog.
let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1, categories: [{ key: 'requirement', name: 'Requirement', role: 'requirement' }, { key: 'scenario', name: 'Scenario' }, { key: 'capability', name: 'Capability' }], rules: [] };
const spec = '# auth Specification\n\n## Requirements\n\n### Requirement: User login\n\n#### Scenario: Valid credentials\n\n### Requirement: Logout\n\n#### Scenario: Valid credentials\n';
const dialog = () => page.locator('#project-configuration-dialog');
const category = (n: number) => page.locator('.config-category').nth(n);
async function preview() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); }
async function keywordSites(n: number, keyword: string) {
  await selectConfigurationTab(page, 'categories');
  const sites = category(n).locator('.config-category-definition-sites');
  await sites.locator(':scope > summary').click();
  await sites.getByLabel('Category definition sites', { exact: true }).selectOption('override');
  await sites.getByLabel('ID position in heading', { exact: true }).selectOption('keyword');
  await expect(sites.getByLabel('Heading keyword', { exact: true })).toHaveValue(keyword);
}
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/named-elements-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await mkdir(path.join(project, 'openspec/specs/auth'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config)); await writeFile(path.join(project, 'openspec/specs/auth/spec.md'), spec);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#metric-ids')).toHaveText('0'); await failAutosave(app);
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('keyword headings with a parent category, a capture scope, and derived capabilities are configured, previewed, and applied', async () => {
  await page.locator('#project-config-open').click(); await expect(dialog()).toBeVisible();
  await keywordSites(0, 'Requirement');
  await keywordSites(1, 'Scenario');
  await selectConfigurationTab(page, 'categories');
  await category(1).getByLabel('Parent category (optional)', { exact: true }).selectOption('requirement');
  await selectConfigurationTab(page, 'categories');
  await category(2).getByLabel('Derive elements from files (optional)', { exact: true }).fill('openspec/specs/{capability}/spec.md');
  // A capture scope for requirements: the capability folder becomes the scope.
  await selectConfigurationTab(page, 'categories');
  await category(0).getByRole('button', { name: 'Add scope pattern', exact: true }).click();
  await category(0).getByLabel('Scope pattern', { exact: true }).last().fill('openspec/specs/{capability}/spec.md');
  await preview();
  // Two requirements, two scenarios with the same name under different requirements, and one capability: no duplicates.
  await expect(page.locator('#config-summary')).toContainText('5 definitions · 0 references · 0 unresolved references · 0 duplicate definitions');
  await page.locator('#config-filter').selectOption('definitions');
  await expect(page.locator('#config-results')).toContainText('User login · capability:auth');
  await expect(page.locator('#config-results')).toContainText('Logout / Valid credentials');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('5');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories[0].idDefinitionSites.headings).toMatchObject({ mode: 'keyword', keyword: 'Requirement' });
  expect(saved.categories[1]).toMatchObject({ parent: 'requirement' });
  expect(saved.categories[2].derive).toEqual({ pattern: 'openspec/specs/{capability}/spec.md' });
  expect(saved.categories[0].idScopes).toEqual([{ pattern: 'openspec/specs/{capability}/spec.md' }]);
  expect(await readFile(path.join(project, 'openspec/specs/auth/spec.md'), 'utf8')).toBe(spec);
});
