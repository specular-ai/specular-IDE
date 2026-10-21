import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failAutosave } from './autosave-fixture';
let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1, categories: [{ key: 'req', name: 'Requirements', role: 'requirement' }, { key: 'dd', name: 'Design', role: 'design' }],
  rules: [{ key: 'req', category: 'req', prefix: 'REQ' }, { key: 'dd', category: 'dd', prefix: 'DD' }],
  modules: [{ key: 'gui', name: 'GUI' }], moduleRules: [{ key: 'all', path: '.', scope: 'folder', modules: ['gui'] }], statuses: [{ name: 'Confirmed', rules: [{ mode: 'exact', value: 'Confirmed' }], colors: { dark: '#123456' } }] };
const source = '# REQ-1 Legacy\nStatus: Confirmed\nDD-1\n\n## Login (REQ-2)\nStatus: Draft\n\n| Key | Status | Description |\n| --- | --- | --- |\n| DD-1 | Confirmed | REQ-2 |\n';
const card = (id: string) => page.locator(`#lens-results .lens-card[data-id="${id}"]`).first();
const sites = () => page.locator('#config-definition-sites');
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#project-heading')).toHaveText('project');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
async function open() { await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Definition and status sites', exact: true }).click(); await expect(sites().getByLabel('Enable heading definitions')).toBeVisible(); }
async function preview() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); }
async function apply() { await preview(); await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); }
async function saved() { return JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')); }
async function configureAnywhere() { await sites().getByLabel('ID position in heading', { exact: true }).selectOption('anywhere'); await sites().getByLabel('ID column name', { exact: true }).fill('Key'); }
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/definition-sites-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config)); await writeFile(path.join(project, 'a.md'), source); await launch(); await expect(card('REQ-1')).toBeVisible();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); if (app) await close().catch(() => {}); });

test('site controls preview definition transitions, retain module/status ownership, navigate and persist after restart', async () => {
  await open(); await configureAnywhere(); await preview();
  await expect(page.locator('#config-summary')).toContainText('3 definitions'); await expect(page.locator('#config-changes')).toContainText('2 references become definitions');
  await page.locator('#config-filter').selectOption('transitions'); await expect(page.locator('#config-results button')).toHaveCount(2);
  await expect(page.locator('#config-results')).toContainText('REQ-2'); await expect(page.locator('#config-results')).toContainText('DD-1');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  await expect(card('REQ-2').locator('.module-badge')).toHaveText('GUI'); await expect(card('REQ-2').locator('.status-badge').first()).toHaveText('Draft');
  await expect(card('DD-1').locator('.status-badge').first()).toHaveCSS('border-color', 'rgb(18, 52, 86)');
  await card('REQ-2').locator('.lens-row').click(); await expect(page.locator('#document-path')).toHaveText('a.md');
  await expect(page.locator('#cursor-status')).toContainText('Ln 5');
  await card('REQ-2').getByRole('button', { name: 'Relationships for REQ-2', exact: true }).click(); await expect(page.locator('#references-results')).toContainText('DD-1');
  const stored = await saved(); expect({ ...stored, idDefinitionSites: undefined }).toEqual({ ...config, idDefinitionSites: undefined });
  await close(); await launch(); await expect(page.locator('#metric-ids')).toHaveText('3'); await open();
  await expect(sites().getByLabel('ID column name', { exact: true })).toHaveValue('Key'); await expect(sites().getByLabel('ID position in heading', { exact: true })).toHaveValue('anywhere');
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(source);
});

test('heading levels, disabled sites, Cancel and Restore defaults preserve unrelated settings', async () => {
  await open(); await configureAnywhere(); await sites().getByLabel('H1', { exact: true }).uncheck(); await preview();
  await expect(page.locator('#config-summary')).toContainText('2 definitions'); await expect(page.locator('#config-changes')).toContainText('1 definitions become references');
  await page.keyboard.press('Escape'); expect(await saved()).toEqual(config);
  await open(); await sites().getByLabel('Enable heading definitions').uncheck(); await sites().getByLabel('Enable table definitions').uncheck(); await apply();
  await expect(page.locator('#metric-ids')).toHaveText('0'); await close(); await launch();
  await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Definition and status sites', exact: true }).click();
  await expect(sites().getByLabel('Enable heading definitions')).not.toBeChecked(); await expect(sites().getByLabel('Enable table definitions')).not.toBeChecked();
  await sites().getByRole('button', { name: 'Restore ID site defaults', exact: true }).click(); await expect(page.locator('#config-apply')).toBeDisabled();
  await apply(); expect(await saved()).toEqual(config); await expect(page.locator('#metric-ids')).toHaveText('1');
});

test('category definition sites override the complete project block, persist, rename and restore inheritance', async () => {
  const categorySource = '## REQ-1 heading\n## DD-1 heading\n\n| Requirement | Text |\n| --- | --- |\n| REQ-2 | DD-1 |\n';
  await writeFile(path.join(project, 'a.md'), categorySource); await page.locator('#refresh').click();
  await open(); await sites().getByLabel('Enable table definitions').uncheck();
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const requirement = page.locator('#config-categories > details').filter({ has: page.locator(':scope > summary').filter({ hasText: 'Requirements' }) });
  await requirement.locator(':scope > summary').click();
  const local = requirement.locator('.config-category-definition-sites'); await local.locator(':scope > summary').click();
  await local.getByLabel('Category definition sites', { exact: true }).selectOption('override');
  await expect(local.getByLabel('Enable heading definitions')).toHaveCSS('width', '16px');
  await expect(local.getByLabel('Enable heading definitions')).toHaveCSS('height', '16px');
  await local.getByLabel('Enable heading definitions').uncheck(); await local.getByLabel('Enable table definitions').check();
  await local.getByLabel('ID column name', { exact: true }).fill('Requirement');
  await preview(); await expect(page.locator('#config-summary')).toContainText('2 definitions');
  await expect(page.locator('#config-changes')).toContainText('1 definitions become references');
  await expect(page.locator('#config-changes')).toContainText('1 references become definitions');
  await page.locator('#config-apply').click(); await expect(card('REQ-2')).toBeVisible(); await expect(card('REQ-1')).toHaveCount(0);
  let stored = await saved(); expect(stored.categories[0].idDefinitionSites.headings.enabled).toBe(false); expect(stored.categories[0].idDefinitionSites.tables.column).toBe('Requirement');

  await close(); await launch(); await open(); await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const reopened = page.locator('#config-categories > details').filter({ has: page.locator(':scope > summary').filter({ hasText: 'Requirements' }) });
  await reopened.locator(':scope > summary').click(); const reopenedLocal = reopened.locator('.config-category-definition-sites'); await reopenedLocal.locator(':scope > summary').click();
  await expect(reopenedLocal.getByLabel('Category definition sites', { exact: true })).toHaveValue('override');
  await expect(reopenedLocal.getByLabel('Enable heading definitions')).not.toBeChecked(); await expect(reopenedLocal.getByLabel('ID column name', { exact: true })).toHaveValue('Requirement');
  await reopened.getByLabel('Name', { exact: true }).fill('Renamed requirements'); await reopenedLocal.getByRole('button', { name: 'Restore inheritance', exact: true }).click();
  await expect(reopenedLocal.getByLabel('Category definition sites', { exact: true })).toHaveValue('inherit'); await apply();
  stored = await saved(); expect(stored.categories[0].name).toBe('Renamed requirements'); expect(stored.categories[0].idDefinitionSites).toBeUndefined();
  await expect(card('REQ-1')).toBeVisible(); await expect(card('REQ-2')).toHaveCount(0); expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(categorySource);
});
test('list definition sites preview exact category transitions, persist types and restore inheritance', async () => {
  const listSource = ['- **REQ-1**: first requirement references DD-1', '', '1. REQ-2: numbered requirement', '', '- DD-1: design record', ''].join(String.fromCharCode(10));
  await writeFile(path.join(project, 'a.md'), listSource); await page.locator('#refresh').click(); await open();
  await sites().getByLabel('Enable list definitions').check(); await sites().getByLabel('Numbered lists').uncheck();
  await preview(); await expect(page.locator('#config-summary')).toContainText('2 definitions');
  await expect(page.locator('#config-changes')).toContainText('2 references become definitions'); await page.locator('#config-apply').click();
  await expect(card('REQ-1')).toBeVisible(); await expect(card('DD-1')).toBeVisible(); await expect(card('REQ-2')).toHaveCount(0);
  await card('REQ-1').locator('.lens-row').click(); await expect(page.locator('#cursor-status')).toContainText('Ln 1');
  let stored = await saved(); expect(stored.idDefinitionSites.lists).toEqual({ enabled: true, types: ['unordered'], mode: 'start' });

  await close(); await launch(); await open(); await expect(sites().getByLabel('Enable list definitions')).toBeChecked(); await expect(sites().getByLabel('Numbered lists')).not.toBeChecked();
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const requirement = page.locator('#config-categories > details').filter({ has: page.locator(':scope > summary').filter({ hasText: 'Requirements' }) });
  await requirement.locator(':scope > summary').click(); const local = requirement.locator('.config-category-definition-sites'); await local.locator(':scope > summary').click();
  await local.getByLabel('Category definition sites', { exact: true }).selectOption('override'); await local.getByLabel('Enable list definitions').uncheck();
  await expect(local.getByLabel('Enable list definitions')).toHaveCSS('width', '16px'); await apply(); await expect(card('REQ-1')).toHaveCount(0); await expect(card('DD-1')).toBeVisible();
  await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const reopened = page.locator('#config-categories > details').filter({ has: page.locator(':scope > summary').filter({ hasText: 'Requirements' }) });
  await reopened.locator(':scope > summary').click(); const reopenedLocal = reopened.locator('.config-category-definition-sites'); await reopenedLocal.locator(':scope > summary').click();
  await reopenedLocal.getByRole('button', { name: 'Restore inheritance' }).click(); await apply(); await expect(card('REQ-1')).toBeVisible();
  stored = await saved(); expect(stored.categories[0].idDefinitionSites).toBeUndefined(); expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(listSource);
});test('advanced heading/cell captures keep exact definitions and statuses and validate named captures', async () => {
  await writeFile(path.join(project, 'a.md'), source.replace('| DD-1 |', '| (**DD-1**) |')); await page.locator('#refresh').click();
  await open(); await sites().getByLabel('ID position in heading', { exact: true }).selectOption('regex');
  await sites().getByLabel('Heading ID pattern', { exact: true }).fill('('); await expect(page.locator('#config-error')).toContainText('regular expression');
  await sites().getByLabel('Heading ID pattern', { exact: true }).fill('REQ-[0-9]+'); await expect(page.locator('#config-error')).toContainText('named');
  await sites().getByLabel('Heading ID pattern', { exact: true }).fill('\\((?<id>REQ-\\d+)\\)');
  await sites().getByLabel('ID column name', { exact: true }).fill('Key'); await sites().getByLabel('ID cell content', { exact: true }).selectOption('regex');
  await sites().getByLabel('Table ID pattern', { exact: true }).fill('\\((?<id>DD-\\d+)\\)'); await apply();
  await expect(page.locator('#metric-ids')).toHaveText('2'); await expect(card('REQ-2').locator('.status-badge').first()).toHaveText('Draft');
  await expect(card('DD-1').locator('.status-badge').first()).toHaveText('Confirmed');
  await card('DD-1').locator('.lens-row').click(); await expect(page.locator('#cursor-status')).toContainText('Ln 10');
});

test('ambiguous sites, unrecognized captures, empty captures and slow patterns cannot be applied and can be repaired', async () => {
  await writeFile(path.join(project, 'a.md'), '# REQ-1 and REQ-2\n\n## ' + 'a'.repeat(40) + '!\n'); await page.locator('#refresh').click();
  await open(); await sites().getByLabel('ID position in heading', { exact: true }).selectOption('anywhere'); await page.locator('#config-preview').click();
  await expect(page.locator('#config-error')).toContainText('Ambiguous definition'); await expect(page.locator('#config-apply')).toBeDisabled();
  await sites().getByLabel('ID position in heading', { exact: true }).selectOption('regex');
  await sites().getByLabel('Heading ID pattern', { exact: true }).fill('(?<id>and)'); await page.locator('#config-preview').click(); await expect(page.locator('#config-error')).toContainText('recognition rule');
  await sites().getByLabel('Heading ID pattern', { exact: true }).fill('(?<id>)'); await page.locator('#config-preview').click(); await expect(page.locator('#config-error')).toContainText('empty');
  await sites().getByLabel('Heading ID pattern', { exact: true }).fill('(?<id>(a+)+)$'); await page.locator('#config-preview').click(); await expect(page.locator('#config-error')).toContainText('was stopped', { timeout: 15000 });
  await sites().getByLabel('Heading ID pattern', { exact: true }).fill('^(?<id>REQ-1)'); await apply(); await expect(page.locator('#metric-ids')).toHaveText('1');
});

test('site draft survives failed writes and external conflicts with reload recovery', async () => {
  await open(); await configureAnywhere(); await preview();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let first = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (first) { first = false; return { ok: false, message: 'Simulated ID-site write failure' }; } return original(event, ...args);
    });
  });
  await page.locator('#config-apply').click(); await expect(page.locator('#config-error')).toContainText('write failure'); expect(await saved()).toEqual(config);
  await expect(sites().getByLabel('ID column name', { exact: true })).toHaveValue('Key'); await apply(); await expect(page.locator('#metric-ids')).toHaveText('3');
  await open(); await sites().getByLabel('ID column name', { exact: true }).fill('Other');
  const external = { ...await saved(), modules: [{ key: 'gui', name: 'External GUI' }] }; await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(external));
  await expect(page.locator('#config-error')).toContainText('configuration changed on disk'); await expect(page.locator('#config-apply')).toBeDisabled();
  await expect(sites().getByLabel('ID column name', { exact: true })).toHaveValue('Other'); expect(await saved()).toEqual(external);
  await page.locator('#config-reload').click(); await page.getByRole('tab', { name: 'Definition and status sites', exact: true }).click(); await expect(sites().getByLabel('ID column name', { exact: true })).toHaveValue('Key');
});

test('site preview uses unsaved buffers, preserves undo and isolates project switching', async () => {
  await card('REQ-1').locator('.lens-row').click(); await failAutosave(app); await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n## Unsaved (REQ-3)\n');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed'); await open(); await configureAnywhere(); await preview(); await expect(page.locator('#config-summary')).toContainText('4 definitions');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); await expect(card('REQ-3')).toBeVisible();
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(source); await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+z'); await expect(card('REQ-3')).toHaveCount(0);
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-9 Other\n## Login (REQ-8)\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other'); await expect(page.locator('#metric-ids')).toHaveText('1'); await expect(card('REQ-8')).toHaveCount(0);
});

test('site controls support keyboard, themes and minimum window', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720)); await open();
  const enabled = sites().getByLabel('Enable heading definitions'); await enabled.focus(); await page.keyboard.press('Space'); await expect(enabled).not.toBeChecked();
  await sites().getByLabel('ID position in heading', { exact: true }).selectOption('regex'); await sites().getByLabel('Heading ID pattern', { exact: true }).fill('(?<id>REQ-\\d+)');
  await sites().scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/definition-sites-dark.png' });
  expect(await page.locator('#project-configuration-dialog').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await page.locator('#config-cancel').click(); await page.locator('#theme-switch').click(); await open(); await sites().scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/definition-sites-light.png' });
  await page.keyboard.press('Escape'); expect(await saved()).toEqual(config);
});
