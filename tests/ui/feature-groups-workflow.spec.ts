import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expandDiscoveryMethods } from './configuration-entries';

let app: ElectronApplication, page: Page, root: string, project: string;
const sources: Record<string, string> = {
  'README.md': '# REQ-1 Existing\n',
  'spec/loans/main.md': '# Functional Requirements\n- **FR-001**: Record a loan\n- **FR-002**: Return a loan\n- **FR-003**: Renew a loan\n',
  'spec/loans/nested/main.md': '- **FR-004**: Inspect loan history\n',
  'spec/payments/main.md': '- **FR-001**: Record a payment\n- **FR-002**: Refund a payment\n',
  'spec/overview.md': '- **FR-005**: Cross-project overview\n',
};
const configFile = () => path.join(project, '.specular/project.json');
const saved = async () => JSON.parse(await readFile(configFile(), 'utf8'));
const group = (label: string) => page.locator('.lens-group').filter({ has: page.locator(':scope > summary > span:first-child', { hasText: new RegExp(`^${label}$`) }) });
const card = (label: string) => page.locator('.lens-card').filter({ has: page.locator('.lens-row strong', { hasText: new RegExp(`^${label}$`) }) });
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#project-heading')).toHaveText('project'); await expect(card('REQ-1')).toBeVisible();
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
async function open() { await page.locator('#project-config-open').click(); await expect(page.locator('#project-configuration-dialog')).toBeVisible(); }
async function apply() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); }
async function update(target: 'features' | 'modules', add = false) {
  await page.locator(`#config-tab-${target}`).click(); const editor = page.locator(`#config-folder-${target}`);
  if (add) { await editor.getByRole('button', { name: 'Add folder pattern', exact: true }).click(); await editor.getByLabel('Folder pattern', { exact: true }).fill('spec/*'); }
  await editor.getByRole('button', { name: `Update ${target}`, exact: true }).click(); await expect(page.locator('#config-status')).toContainText('Folder updates staged');
}
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) await close().catch(() => {});
});

test('discover scoped FR lists, configure and apply folder memberships, browse features and reopen', async () => {
  test.setTimeout(90_000);
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/feature-workflow-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(configFile(), JSON.stringify({ version: 1, categories: [{ key: 'req', name: 'Existing requirements' }], rules: [{ key: 'req', category: 'req', prefix: 'REQ' }],
    features: [{ key: 'review', name: 'Review' }], featureRules: [{ key: 'review', scope: 'folder', path: 'spec/loans', features: ['review'] }] }));
  for (const [file, text] of Object.entries(sources)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  await launch(); await expect(page.locator('#metric-ids')).toHaveText('1');
  await open(); await expandDiscoveryMethods(page); await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click();
  await expect(page.locator('#discovery-remaining')).toHaveText('1 suggestions remaining');
  const candidate = page.locator('#discovery-review > .config-entry'); await candidate.locator(':scope > summary').click();
  await candidate.getByLabel('Category display name', { exact: true }).fill('Functional requirements');
  await candidate.getByText('ID definition sites', { exact: true }).click(); await candidate.getByLabel('Category definition sites', { exact: true }).selectOption('override');
  await candidate.getByLabel('Enable list definitions').check();
  await expect(candidate.getByRole('button', { name: 'FR-001 - spec/loans/main.md (list-item)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await page.locator('#config-tab-categories').click();
  const category = page.locator('#config-categories > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: 'Functional requirements' }) });
  await category.locator(':scope > summary').click(); await category.getByText('Scope patterns', { exact: true }).click();
  await category.getByRole('button', { name: 'Add scope pattern', exact: true }).click(); await category.getByLabel('Scope pattern', { exact: true }).fill('spec/*');
  await apply(); await expect(page.locator('#metric-ids')).toHaveText('8');
  expect((await saved()).categories.find((c: any) => c.name === 'Functional requirements').idDefinitionSites.lists.enabled).toBe(true);
  await page.getByLabel('Group definitions by').selectOption('feature'); await expect(group('Review').locator('.lens-group-count')).toHaveText('4 IDs'); await expect(group('No feature').locator('.lens-group-count')).toHaveText('4 IDs');
  const beforeGeneration = await saved(); await open(); await update('features', true); await update('modules', true); expect(await saved()).toEqual(beforeGeneration); await apply();
  await expect(group('loans').locator('.lens-group-count')).toHaveText('4 IDs'); await expect(group('payments').locator('.lens-group-count')).toHaveText('2 IDs'); await expect(group('No feature').locator('.lens-group-count')).toHaveText('2 IDs');
  await expect(page.locator('.lens-group-total')).toContainText('8 distinct IDs');
  await expect(card('FR-001 · spec/loans')).toHaveCount(2); await expect(card('FR-001 · spec/payments')).toHaveCount(1);
  await group('loans').locator('.lens-card').filter({ hasText: 'FR-004' }).locator('.lens-row').click(); await expect(page.locator('#document-path')).toHaveText('spec/loans/nested/main.md'); await expect(page.locator('#cursor-status')).toContainText('Ln 1');
  const generated = await saved(); expect(generated.generatedFolders).toHaveLength(4);
  const loansModule = generated.modules.find((m: any) => m.name === 'loans').key;
  await page.getByLabel('Filter by module', { exact: true }).selectOption(loansModule); await expect(page.locator('.lens-group-total')).toContainText('4 distinct IDs'); await expect(group('payments')).toHaveCount(0);
  await page.getByLabel('Filter by module', { exact: true }).selectOption('');
  await group('loans').getByRole('button', { name: 'Edit features for FR-001 · spec/loans', exact: true }).click();
  await page.locator('#feature-assignment-options').getByRole('checkbox', { name: /Review$/ }).uncheck(); await page.locator('#feature-assignment-apply').click();
  await expect(group('Review').locator('.lens-group-count')).toHaveText('3 IDs'); await expect(card('FR-001 · spec/loans')).toHaveCount(1);
  await mkdir(path.join(project, 'spec/returns')); await writeFile(path.join(project, 'spec/returns/main.md'), '- **FR-001**: Process a return\n'); await page.locator('#refresh').click();
  await expect(card('FR-001 · spec/returns')).toBeVisible(); await expect(group('returns')).toHaveCount(0); await expect(group('No feature').locator('.lens-group-count')).toHaveText('3 IDs');
  await open(); await update('features'); await apply(); await expect(group('returns').locator('.lens-group-count')).toHaveText('1 ID'); await expect(group('No feature').locator('.lens-group-count')).toHaveText('2 IDs');
  const final = await saved(); await close(); await launch();
  await expect(page.getByLabel('Group definitions by')).toHaveValue('none'); await page.getByLabel('Group definitions by').selectOption('feature');
  await expect(group('loans').locator('.lens-group-count')).toHaveText('4 IDs'); await expect(group('Review').locator('.lens-group-count')).toHaveText('3 IDs'); await expect(group('returns').locator('.lens-group-count')).toHaveText('1 ID'); expect(await saved()).toEqual(final);
  for (const [file, text] of Object.entries(sources)) expect(await readFile(path.join(project, file), 'utf8')).toBe(text);
});
