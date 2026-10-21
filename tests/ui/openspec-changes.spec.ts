import { failAutosave } from './autosave-fixture';
import { selectConfigurationTab } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

// Increment 85b: change records, name references, and change elements, enabled in Project configuration.
let app: ElectronApplication, page: Page, root: string, project: string;
const keyword = (word: string, level: number) => ({ headings: { enabled: true, levels: [level], mode: 'keyword', keyword: word }, tables: { enabled: false, column: 'ID', mode: 'exact' } });
const scopes = [{ pattern: 'openspec/specs/{capability}/spec.md' }, { pattern: 'openspec/changes/**/specs/{capability}/spec.md' }];
const config = { version: 1, rules: [], categories: [
  { key: 'requirement', name: 'Requirement', role: 'requirement', idScopes: scopes, idDefinitionSites: keyword('Requirement', 3) },
  { key: 'capability', name: 'Capability', derive: { pattern: 'openspec/specs/{capability}/spec.md' } },
  { key: 'change', name: 'Change', derive: { pattern: 'openspec/changes/**/{change}/proposal.md' } },
] };
const files: Record<string, string> = {
  'openspec/specs/identity/spec.md': '# identity Specification\n\n### Requirement: Users and workspaces\n\nSee the `users and workspaces` requirement.\n',
  'openspec/changes/add-realms/proposal.md': '# Change: Add realms\n\n### Modified Capabilities\n\n- `identity`: realm-scoped users.\n- `billing`: not touched.\n',
  'openspec/changes/add-realms/specs/identity/spec.md': '## MODIFIED Requirements\n\n### Requirement: Users and workspaces\n\n## ADDED Requirements\n\n### Requirement: Realm isolation\n',
};
const dialog = () => page.locator('#project-configuration-dialog');
const category = (n: number) => page.locator('.config-category').nth(n);
const changes = (n: number) => category(n).locator('.config-category-changes');
async function preview() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); }
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/openspec-changes-')); project = path.join(root, 'project');
  for (const [file, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  await mkdir(path.join(project, '.specular'), { recursive: true }); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  // Without change records, the change's restated requirement is a second definition.
  await expect(page.locator('#metric-ids')).toHaveText('5'); await failAutosave(app);
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('change records, name references, and changes with declared capabilities are enabled, previewed, and applied', async () => {
  await page.locator('#project-config-open').click(); await expect(dialog()).toBeVisible();
  await selectConfigurationTab(page, 'categories');
  await changes(0).locator(':scope > summary').click();
  await changes(0).getByRole('checkbox', { name: 'Record change deltas', exact: true }).check();
  await changes(0).getByRole('checkbox', { name: 'Link backticked names', exact: true }).check();
  await selectConfigurationTab(page, 'categories');
  await changes(2).locator(':scope > summary').click();
  await expect(changes(2).getByLabel('Archive folder name', { exact: true })).toBeHidden();
  await changes(2).getByRole('checkbox', { name: 'Derived elements are changes', exact: true }).check();
  await changes(2).getByLabel('Capability category of declarations', { exact: true }).selectOption('capability');
  await preview();
  // Definitions: the requirement, the proposed Realm isolation, the capability, and the change; the MODIFIED record and the name are references.
  await expect(page.locator('#config-summary')).toContainText('4 definitions · 4 references · 1 unresolved references · 0 duplicate definitions · 1 consistency findings');
  await page.locator('#config-filter').selectOption('issues');
  await expect(page.locator('#config-results')).toContainText('add-realms declares capability billing');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('4');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories[0]).toMatchObject({ deltas: true, nameReferences: true });
  expect(saved.categories[2].changes).toEqual({ capabilities: 'capability' });
  for (const [file, text] of Object.entries(files)) expect(await readFile(path.join(project, file), 'utf8')).toBe(text);
});
