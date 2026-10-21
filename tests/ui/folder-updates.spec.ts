import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { expandConfigurationEntries } from './configuration-entries';
let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1, categories: [{ key: 'req', name: 'Requirements', idScopes: [{ pattern: 'specs/*' }] }], rules: [{ key: 'req', category: 'req', prefix: 'FR' }],
  features: [{ key: 'manual', name: 'Manual feature' }], modules: [{ key: 'manual', name: 'Manual module' }],
  featureRules: [{ key: 'manual', scope: 'folder', path: 'specs/authentication', features: ['manual'] }],
  moduleOverrides: [{ id: 'FR-001', scope: 'specs/authentication', modules: ['manual'] }] };
const sources = { 'specs/authentication/main.md': '# FR-001 Authentication\n', 'specs/authentication/nested/main.md': '# FR-002 Nested\n',
  'specs/reporting/main.md': '# FR-001 Reporting\nFR-999\n', 'specs/overview.md': '# FR-003 Overview\n' };
const file = () => path.join(project, '.specular/project.json');
const saved = async () => JSON.parse(await readFile(file(), 'utf8'));
const editor = (target = 'features') => page.locator(`#config-folder-${target}`);
const card = (name: string) => page.locator('.lens-card').filter({ has: page.locator('.lens-row').filter({ hasText: name }) }).first();
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#metric-ids')).not.toHaveText('0'); await expect(page.locator('#metric-ids')).not.toHaveText('—');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); }
async function open(target = 'features') { await page.locator('#project-config-open').click(); await page.locator(`#config-tab-${target}`).click(); }
async function update(target = 'features') {
  await editor(target).getByRole('button', { name: `Update ${target}`, exact: true }).click();
  await expect(page.locator('#config-status')).toContainText('Folder updates staged'); await expect(page.locator('#config-apply')).toBeDisabled();
  await expect(page.locator('#config-preview')).toBeFocused();
}
async function stage(target = 'features') { await editor(target).getByRole('button', { name: 'Add folder pattern', exact: true }).click(); await update(target); }
async function recognition() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await expect(page.locator('#config-apply')).toBeEnabled(); }
async function apply() { await recognition(); await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); }
async function stageBoth() { await open(); await stage(); await page.locator('#config-tab-modules').click(); await stage('modules'); }
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/folder-updates-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await writeFile(file(), JSON.stringify(config));
  for (const [file, text] of Object.entries(sources)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  await launch(); await expect(page.locator('#metric-ids')).toHaveText('4');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) await close().catch(() => {});
});

test('Update, Preview, Apply and restart persist independent mappings; repeated updates preserve keys and renamed entries', async () => {
  await stageBoth(); expect(await saved()).toEqual(config); await apply();
  await expect(card('Authentication').locator('.feature-badge')).toHaveText(['authentication', 'Manual feature']);
  await expect(card('Authentication').locator('.module-badge')).toHaveText(['Manual module']);
  await expect(card('Reporting').locator('.feature-badge')).toHaveText(['reporting']);
  await expect(card('Reporting').locator('.module-badge')).toHaveText(['reporting']);
  const first = await saved(); expect(first.generatedFolders).toHaveLength(4); expect(first.folderGenerators).toHaveLength(2);
  expect(first.featureRules).toEqual(config.featureRules); expect(first.moduleOverrides).toEqual(config.moduleOverrides);
  await close(); await launch(); await expect(card('Reporting').locator('.feature-badge')).toHaveText(['reporting']);
  await open(); await expect(editor().getByLabel('Folder pattern', { exact: true })).toHaveValue('specs/*'); await expandConfigurationEntries(page);
  await expect(page.locator('.feature-row').nth(1).getByRole('heading', { name: 'Generated folder mapping' })).toBeVisible();
  await expect(page.locator('.feature-row').nth(1).getByRole('button', { name: 'Add file rule' })).toHaveCount(0);
  await page.getByLabel('Feature name', { exact: true }).nth(1).fill('Sign in'); await update(); await apply();
  const renamed = await saved(); expect(renamed.generatedFolders).toEqual(first.generatedFolders);
  await expect(card('Authentication').locator('.feature-badge')).toHaveText(['Sign in', 'Manual feature']);
  await open(); await update(); await page.locator('#config-tab-modules').click(); await update('modules'); await apply(); expect(await saved()).toEqual(renamed);
  for (const [file, text] of Object.entries(sources)) expect(await readFile(path.join(project, file), 'utf8')).toBe(text);
});

test('new folders wait for explicit update, while saved-folder membership stays live; exclusions update only on request', async () => {
  await stageBoth(); await apply(); const before = await saved();
  await mkdir(path.join(project, 'specs/analytics')); await writeFile(path.join(project, 'specs/analytics/main.md'), '# FR-004 Analytics\n');
  await writeFile(path.join(project, 'specs/reporting/extra.md'), '# FR-005 Extra\n'); await expect(page.locator('#metric-ids')).toHaveText('6');
  await expect(card('Analytics').locator('.feature-badge')).toHaveCount(0); await expect(card('Extra').locator('.feature-badge')).toHaveText(['reporting']); expect(await saved()).toEqual(before);
  await open(); await update(); expect(await saved()).toEqual(before); await apply(); await expect(card('Analytics').locator('.feature-badge')).toHaveText(['analytics']);
  await expect(card('Analytics').locator('.module-badge')).toHaveText(['Unassigned']);
  await open(); await editor().getByLabel('Excluded folders (one per line)').fill('specs/authentication/nested'); await apply();
  await expect(card('Nested').locator('.feature-badge')).toHaveText(['authentication', 'Manual feature']);
  await open(); await update(); await apply(); await expect(card('Nested').locator('.feature-badge')).toHaveText(['Manual feature']);
});

test('collisions stage nothing and retained renamed-folder mappings can be explicitly removed', async () => {
  await open(); await expandConfigurationEntries(page); await page.getByLabel('Feature name', { exact: true }).fill('reporting');
  await editor().getByRole('button', { name: 'Add folder pattern' }).click(); await editor().getByRole('button', { name: 'Update features', exact: true }).click();
  await expect(page.locator('#config-status')).toContainText('Folder update blocked'); await expect(page.locator('.feature-row')).toHaveCount(1); expect(await saved()).toEqual(config);
  await page.getByLabel('Feature name', { exact: true }).fill('Manual feature'); await update(); await apply();
  const old = await saved(); await mkdir(path.join(project, 'specs/analytics')); await rename(path.join(project, 'specs/reporting/main.md'), path.join(project, 'specs/analytics/main.md'));
  await expect(card('Reporting').locator('.feature-badge')).toHaveCount(0);
  await open(); await update(); await expect(page.locator('.folder-preview-entry').filter({ hasText: 'reporting' })).toContainText('Removal / possible rename: retained'); await apply();
  const retained = await saved(); expect(retained.generatedFolders).toHaveLength(old.generatedFolders.length + 1);
  await open(); await editor().getByRole('button', { name: 'Remove folder pattern' }).click(); await update(); await expandConfigurationEntries(page);
  await page.locator('.feature-row').nth(2).getByRole('button', { name: 'Remove feature', exact: true }).click(); await apply();
  expect((await saved()).generatedFolders.some((item: any) => item.folder === 'specs/reporting')).toBe(false);
});

test('changed sources/settings after Update require another Update; cancellation and external conflicts preserve disk', async () => {
  await open(); await stage(); await writeFile(path.join(project, 'specs/authentication/main.md'), '# FR-006 Changed\n');
  await expect(page.locator('#config-status')).toContainText('Markdown changed'); await page.locator('#config-preview').click();
  await expect(page.locator('#config-error')).toContainText('Use Update features again'); await expect(page.locator('#config-apply')).toBeDisabled();
  await update(); await editor().getByLabel('Excluded folders (one per line)').fill('specs/authentication/nested'); await page.locator('#config-preview').click();
  await expect(page.locator('#config-error')).toContainText('Use Update features again'); await update(); await recognition();
  await page.locator('#config-cancel').click(); expect(await saved()).toEqual(config);
  await open(); await expect(editor().getByLabel('Folder pattern')).toHaveCount(0); await stage(); await recognition();
  await writeFile(file(), JSON.stringify({ ...config, features: [{ key: 'external', name: 'External' }] }));
  await expect(page.locator('#config-error')).toContainText('changed on disk'); await expect(page.locator('#config-apply')).toBeDisabled();
  await page.locator('#config-reload').click(); await expect(page.locator('.feature-row')).toHaveCount(1); await expect(editor().getByLabel('Folder pattern')).toHaveCount(0);
});

test('failed and repeated Apply preserve the full staged draft and serialize saves', async () => {
  await stageBoth();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); (ipcMain as any).folderSaveCalls = 0;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', async (event, ...args) => {
      (ipcMain as any).folderSaveCalls++;
      if ((ipcMain as any).folderSaveCalls === 1) return { ok: false, message: 'Simulated folder save failure' };
      return original(event, ...args);
    });
  });
  await recognition(); await page.locator('#config-apply').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator('#config-error')).toContainText('folder save failure'); expect(await saved()).toEqual(config);
  await expect(page.locator('.module-row')).toHaveCount(3); await expect(editor('modules').getByLabel('Folder pattern')).toHaveValue('specs/*');
  await recognition(); await page.locator('#config-apply').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); expect((await saved()).generatedFolders).toHaveLength(4);
  expect(await app.evaluate(({ ipcMain }) => (ipcMain as any).folderSaveCalls)).toBe(2);
});

test('staged generated controls fit both themes, and project switching cannot reuse the old draft', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    await open(); await stage(); await expandConfigurationEntries(page); await page.locator('.feature-row').nth(1).scrollIntoViewIfNeeded();
    expect(await page.locator('#project-configuration-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/folder-updates-${theme}.png` }); await page.locator('#config-cancel').click();
  }
  await open(); await stage(); await recognition(); await page.locator('#config-results button').first().click();
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'main.md'), '# REQ-1 Other\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other'); await open();
  await expect(editor().getByLabel('Folder pattern')).toHaveCount(0); await expect(page.locator('.feature-row')).toHaveCount(0); expect(await saved()).toEqual(config);
});
