import { failAutosave } from './autosave-fixture';
import { expandDiscoveryMethods } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

// Increment 85c: Discover by patterns proposes OpenSpec conventions, which are reviewed, staged, and applied.
let app: ElectronApplication, page: Page, root: string, project: string;
const files: Record<string, string> = {
  'openspec/specs/identity/spec.md': '# identity Specification\n\n### Requirement: Users and workspaces\n\n#### Scenario: Create user\n\n### Requirement: Token verification\n\n#### Scenario: Valid token\n',
  'openspec/specs/billing/spec.md': '# billing Specification\n\n### Requirement: Invoices\n\n#### Scenario: Monthly invoice\n',
  'openspec/changes/add-realms/proposal.md': '# Change: Add realms\n\n### Modified Capabilities\n\n- `identity`: realm-scoped users.\n',
  'openspec/changes/add-realms/specs/identity/spec.md': '## MODIFIED Requirements\n\n### Requirement: Users and workspaces\n\n## ADDED Requirements\n\n### Requirement: Realm isolation\n',
  'openspec/changes/archive/2026-01-01-tokens/proposal.md': '# Change: Tokens\n',
};
const dialog = () => page.locator('#project-configuration-dialog');
const suggestion = (name: string) => page.locator('#discovery-review > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: `- ${name}` }) });
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/keyword-discovery-')); project = path.join(root, 'project');
  for (const [file, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#metric-ids')).toHaveText('0'); await failAutosave(app);
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('Discover by patterns proposes keyword headings, a parent, capabilities, and changes that apply as one configuration', async () => {
  await expect(async () => {
    if (!await dialog().isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover IDs', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Found 4 candidate groups');
  await suggestion('Scenario').locator(':scope > summary').click();
  await expect(suggestion('Scenario')).toContainText('Keyword heading: "Scenario: <name>" at level 4. Identified within its Requirement heading.');
  await expect(suggestion('Scenario').getByLabel('Suggested regex', { exact: true })).toHaveCount(0);
  await suggestion('Change').locator(':scope > summary').click();
  await expect(suggestion('Change')).toContainText('proposals declare Capability elements');
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  // 4 requirements (one proposed by the active change), 3 scenarios, 2 capabilities, and 2 changes; nothing duplicated or unresolved.
  await expect(page.locator('#config-summary')).toContainText('11 definitions');
  await expect(page.locator('#config-summary')).toContainText('0 unresolved references · 0 duplicate definitions');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  const named = (name: string) => saved.categories.find((item: { name: string }) => item.name === name);
  expect(named('Scenario').parent).toBe(named('Requirement').key);
  expect(named('Requirement')).toMatchObject({ deltas: true, idDefinitionSites: { headings: { mode: 'keyword', keyword: 'Requirement' } } });
  expect(named('Change').changes).toEqual({ capabilities: named('Capability').key });
  for (const [file, text] of Object.entries(files)) expect(await readFile(path.join(project, file), 'utf8')).toBe(text);
});
