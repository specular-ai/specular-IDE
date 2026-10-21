import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failAutosave } from './autosave-fixture';
let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1, categories: [{ key: 'req', name: 'Requirements', role: 'requirement' }, { key: 'dd', name: 'Design', role: 'design' }],
  rules: [{ key: 'req', category: 'req', prefix: 'REQ' }, { key: 'dd', category: 'dd', prefix: 'DD' }],
  modules: [{ key: 'gui', name: 'GUI' }], moduleRules: [{ key: 'all', path: '.', scope: 'folder', modules: ['gui'] }], statuses: [{ name: 'Ready', rules: [{ mode: 'startsWith', value: 'Approved' }], colors: { dark: '#123456', light: '#123456' } }] };
const source = '# REQ-1 Legacy\nStatus: Confirmed\n\nDD-1\n\n## Login (REQ-2) [Approved]\nState: Approved today\n\n### Notes\nState: Ignored\n\n| Key | Progress | Description |\n| --- | --- | --- |\n| DD-1 | Approved | REQ-2 |\n';
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
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/status-sites-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config)); await writeFile(path.join(project, 'a.md'), source); await launch(); await expect(card('REQ-1')).toBeVisible();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); if (app) await close().catch(() => {}); });


const statusSites = () => page.locator('#config-status-sites');
async function configure() {
  await configureAnywhere();
  await statusSites().getByLabel('Paragraph field label', { exact: true }).fill('State:');
  await statusSites().getByLabel('Status column name', { exact: true }).fill('Progress');
  await statusSites().getByLabel('Enable heading statuses').check();
}
async function statusPreview() { await preview(); await page.locator('#config-filter').selectOption('statuses'); }

test('status sites preview raw/mapped values and source evidence, apply with modules/colors and survive restart', async () => {
  await open(); await configure(); await statusPreview();
  await expect(page.locator('#config-changes')).toContainText('3 IDs with changed status assignments');
  await expect(page.locator('#config-changes')).toContainText('0 status conflicts');
  await expect(page.locator('#config-results')).toContainText('No authored status');
  const row = page.locator('.config-status-result').filter({ has: page.locator('button.config-result', { hasText: 'REQ-2' }) });
  await expect(row).toContainText('headings: Approved -> Ready');
  await expect(row).toContainText('paragraphs: Approved today -> Ready');
  await row.locator('summary').click(); await row.getByRole('button', { name: 'a.md:7', exact: true }).click();
  await expect(page.locator('#cursor-status')).toContainText('Ln 7');
  await page.locator('#project-config-open').click(); await apply();
  await expect(card('REQ-2').locator('.status-badge').first()).toHaveText('Ready');
  await expect(card('DD-1').locator('.status-badge').first()).toHaveCSS('border-color', 'rgb(18, 52, 86)');
  await expect(card('DD-1').locator('.module-badge')).toHaveText('GUI');
  await expect(card('REQ-1').locator('.status-badge')).toHaveCount(0);
  const stored = await saved(); expect(stored.statusSites.paragraphs.label).toBe('State:'); expect(stored.statusSites.headings.enabled).toBe(true);
  await close(); await launch(); await expect(card('REQ-2').locator('.status-badge').first()).toHaveText('Ready'); await open();
  await expect(statusSites().getByLabel('Paragraph field label', { exact: true })).toHaveValue('State:');
  await expect(statusSites().getByLabel('Enable heading statuses')).toBeChecked();
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(source);
});

test('category and individual-status overrides preview, persist, restart and restore inheritance', async () => {
  const localSource = ['# REQ-1', 'State: Draft', '', 'Outcome: Approved locally', '', '# DD-1', 'Status: Draft', '', 'Outcome: Approved design', ''].join('\n');
  await writeFile(path.join(project, 'a.md'), localSource); await page.locator('#refresh').click();
  await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const requirement = page.locator('#config-categories > details').filter({ has: page.locator(':scope > summary').filter({ hasText: 'Requirements' }) });
  await requirement.locator(':scope > summary').click();
  const categorySites = requirement.locator('.config-category-status-sites'); await categorySites.locator(':scope > summary').click();
  await categorySites.getByLabel('Category status sites', { exact: true }).selectOption('override');
  await categorySites.getByLabel('Paragraph field label', { exact: true }).fill('State:');
  await expect(categorySites.getByLabel('Enable paragraph statuses')).toHaveCSS('width', '16px');

  await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click();
  const ready = page.locator('#config-statuses .config-entry').filter({ has: page.locator(':scope > summary').filter({ hasText: 'Ready' }) });
  await ready.locator(':scope > summary').click();
  const localStatusSites = ready.locator('.config-status-local-sites'); await localStatusSites.locator(':scope > summary').click();
  await localStatusSites.getByLabel('Status-specific extraction sites', { exact: true }).selectOption('override');
  await localStatusSites.getByLabel('Paragraph field label', { exact: true }).fill('Outcome:');
  await statusPreview(); await expect(page.locator('#config-changes')).toContainText('2 status conflicts');
  await expect(page.locator('#config-results')).toContainText('Approved locally -> Ready');
  await page.locator('#config-apply').click();
  await expect(card('REQ-1').locator('.status-badge').first()).toHaveText('Status conflict');
  let stored = await saved(); expect(stored.categories[0].statusSites.paragraphs.label).toBe('State:'); expect(stored.statuses[0].statusSites.paragraphs.label).toBe('Outcome:');

  await close(); await launch(); await expect(card('DD-1').locator('.status-badge').first()).toHaveText('Status conflict');
  await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const reopenedCategory = page.locator('#config-categories > details').filter({ has: page.locator(':scope > summary').filter({ hasText: 'Requirements' }) });
  await reopenedCategory.locator(':scope > summary').click(); const reopenedCategorySites = reopenedCategory.locator('.config-category-status-sites'); await reopenedCategorySites.locator(':scope > summary').click();
  await expect(reopenedCategorySites.getByLabel('Paragraph field label', { exact: true })).toHaveValue('State:'); await reopenedCategorySites.getByRole('button', { name: 'Restore inheritance' }).click();
  await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click();
  const reopenedReady = page.locator('#config-statuses .config-entry').filter({ has: page.locator(':scope > summary').filter({ hasText: 'Ready' }) });
  await reopenedReady.locator(':scope > summary').click(); const reopenedStatusSites = reopenedReady.locator('.config-status-local-sites'); await reopenedStatusSites.locator(':scope > summary').click();
  await expect(reopenedStatusSites.getByLabel('Paragraph field label', { exact: true })).toHaveValue('Outcome:'); await reopenedStatusSites.getByRole('button', { name: 'Restore inheritance' }).click();
  await apply(); stored = await saved(); expect(stored.categories[0].statusSites).toBeUndefined(); expect(stored.statuses[0].statusSites).toBeUndefined();
  await expect(card('REQ-1').locator('.status-badge')).toHaveCount(0); await expect(card('DD-1').locator('.status-badge').first()).toHaveText('Draft');
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(localSource);
});
test('disabled status sites persist separately from empty palettes; Cancel/defaults/rescan preserve ID settings', async () => {
  await open(); await configure(); await apply();
  await open(); await statusSites().getByLabel('Enable heading statuses').uncheck(); await page.keyboard.press('Escape');
  expect((await saved()).statusSites.headings.enabled).toBe(true);
  await open(); await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click();
  await page.getByRole('button', { name: 'Delete all statuses', exact: true }).click(); await apply();
  expect((await saved()).statuses).toEqual([]); await expect(card('REQ-2').locator('.status-badge').first()).toHaveText('Status conflict');
  await open();
  for (const kind of ['paragraph', 'table', 'heading']) await statusSites().getByLabel('Enable ' + kind + ' statuses').uncheck();
  await statusPreview(); await expect(page.locator('#config-results')).toContainText('Previously:');
  await expect(page.locator('#config-results .status-badge')).toHaveCount(0); await page.locator('#config-apply').click();
  await expect(page.locator('#lens-results .status-badge')).toHaveCount(0);
  await close(); await launch(); await open();
  for (const kind of ['paragraph', 'table', 'heading']) await expect(statusSites().getByLabel('Enable ' + kind + ' statuses')).not.toBeChecked();
  await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click();
  await page.getByRole('button', { name: 'Rescan statuses', exact: true }).click(); await expect(page.locator('#config-statuses')).toContainText('Found 0 authored status values; added 0.');
  expect((await saved()).statuses).toEqual([]);
  await page.getByRole('tab', { name: 'Definition and status sites', exact: true }).click();
  await statusSites().getByRole('button', { name: 'Restore status site defaults', exact: true }).click(); await apply();
  const stored = await saved(); expect(stored.statusSites).toBeUndefined(); expect(stored.statuses).toEqual([]); expect(stored.idDefinitionSites.headings.mode).toBe('anywhere');
  await expect(card('REQ-1').locator('.status-badge').first()).toHaveText('Confirmed');
});

test('advanced captures validate syntax, missing/empty values, source spans, length and worker time limits', async () => {
  await writeFile(path.join(project, 'a.md'), '# REQ-1\nState: Approved\n\n# REQ-9\n' + 'a'.repeat(40) + '!\n');
  await page.locator('#refresh').click(); await open();
  await statusSites().getByLabel('Paragraph status format', { exact: true }).selectOption('regex');
  const pattern = statusSites().getByLabel('Paragraph status pattern', { exact: true });
  await pattern.fill('('); await expect(page.locator('#config-error')).toContainText('regular expression');
  await pattern.fill('State: .+'); await expect(page.locator('#config-error')).toContainText('named');
  for (const invalid of ['(?<status>)', '(?<status>Draft)?Approved']) {
    await pattern.fill(invalid); await page.locator('#config-preview').click(); await expect(page.locator('#config-error')).toContainText('empty or missing');
    await expect(page.locator('#config-apply')).toBeDisabled();
  }
  await pattern.fill('(?<status>(a+)+)$'); await page.locator('#config-preview').click();
  await expect(page.locator('#config-error')).toContainText('was stopped', { timeout: 15000 }); await expect(page.locator('#config-apply')).toBeDisabled();
  await pattern.fill('^state: (?<status>.+)$'); await statusSites().getByLabel('Ignore case in paragraph status pattern').check(); await apply();
  await expect(card('REQ-1').locator('.status-badge').first()).toHaveText('Ready');
  await writeFile(path.join(project, 'a.md'), '# REQ-1\nState: Appr&#111;ved\n'); await page.locator('#refresh').click(); await open(); await page.locator('#config-preview').click();
  await expect(page.locator('#config-error')).toContainText('literal source span'); await expect(page.locator('#config-apply')).toBeDisabled();
  await page.locator('#config-cancel').click();
  await writeFile(path.join(project, 'a.md'), '# REQ-1\nState: ' + 'x'.repeat(4097)); await page.locator('#refresh').click(); await open(); await page.locator('#config-preview').click();
  await expect(page.locator('#config-error')).toContainText('1-4096'); await expect(page.locator('#config-apply')).toBeDisabled();
});

test('status-site drafts survive failed saves and external conflicts with reload recovery', async () => {
  await open(); await configure(); await preview();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let first = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (first) { first = false; return { ok: false, message: 'Simulated status-site write failure' }; } return original(event, ...args);
    });
  });
  await page.locator('#config-apply').click(); await expect(page.locator('#config-error')).toContainText('write failure'); expect(await saved()).toEqual(config);
  await expect(statusSites().getByLabel('Paragraph field label', { exact: true })).toHaveValue('State:'); await apply();
  await open(); await statusSites().getByLabel('Paragraph field label', { exact: true }).fill('Stage:');
  const external = { ...await saved(), modules: [{ key: 'gui', name: 'External GUI' }] }; await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(external));
  await expect(page.locator('#config-error')).toContainText('configuration changed on disk'); await expect(page.locator('#config-apply')).toBeDisabled();
  await expect(statusSites().getByLabel('Paragraph field label', { exact: true })).toHaveValue('Stage:'); expect(await saved()).toEqual(external);
  await page.locator('#config-reload').click(); await page.getByRole('tab', { name: 'Definition and status sites', exact: true }).click();
  await expect(statusSites().getByLabel('Paragraph field label', { exact: true })).toHaveValue('State:');
});

test('status preview uses unsaved buffers, reports conflicts and preserves undo across Apply and project switches', async () => {
  await card('REQ-1').locator('.lens-row').click(); await failAutosave(app); await page.locator('#editor .cm-content').click();
  await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n## Unsaved (REQ-3) [Draft]\nState: Approved\n');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed'); await open(); await configure(); await statusPreview();
  await expect(page.locator('#config-changes')).toContainText('1 status conflicts'); await expect(page.locator('#config-results')).toContainText('Status conflict');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  await expect(card('REQ-3').locator('.status-badge').first()).toHaveText('Status conflict'); expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(source);
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+z'); await expect(card('REQ-3')).toHaveCount(0);
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-9 [Draft]\nStatus: Confirmed\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other'); await expect(card('REQ-9').locator('.status-badge').first()).toHaveText('Confirmed');
});

test('status controls support keyboard, both themes and the minimum window size', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720)); await open();
  const enabled = statusSites().getByLabel('Enable heading statuses'); await enabled.focus(); await page.keyboard.press('Space'); await expect(enabled).toBeChecked();
  await statusSites().getByLabel('Heading status pattern', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/status-sites-dark.png' });
  expect(await page.locator('#project-configuration-dialog').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await expect(page.locator('#config-preview')).toBeVisible(); await expect(page.locator('#config-apply')).toBeVisible();
  await page.locator('#config-cancel').click(); await page.locator('#theme-switch').click(); await open();
  await statusSites().getByLabel('Heading status pattern', { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/status-sites-light.png' });
  await page.keyboard.press('Escape'); expect(await saved()).toEqual(config);
});

test('advanced paragraph/table formats work with heading captures and preserve all agreeing evidence', async () => {
  await writeFile(path.join(project, 'a.md'), source.replace('| DD-1 | Approved |', '| DD-1 | (Approved) |')); await page.locator('#refresh').click();
  await open(); await configure();
  await statusSites().getByLabel('Paragraph status format', { exact: true }).selectOption('regex');
  await statusSites().getByLabel('Paragraph status pattern', { exact: true }).fill('^state: (?<status>.+)$');
  await statusSites().getByLabel('Ignore case in paragraph status pattern').check();
  await statusSites().getByLabel('Status cell content', { exact: true }).selectOption('regex');
  await statusSites().getByLabel('Table status pattern', { exact: true }).fill('\\((?<status>[^)]+)\\)');
  await statusPreview(); await expect(page.locator('#config-results')).toContainText('tables: Approved -> Ready'); await apply();
  await expect(card('DD-1').locator('.status-badge').first()).toHaveText('Ready');
  await expect(card('REQ-2').locator('.status-evidence p')).toHaveCount(2);
  const stored = await saved(); expect(stored.statusSites.tables.mode).toBe('regex'); expect(stored.statusSites.paragraphs.ignoreCase).toBe(true);
});

test('Preview and Apply survive an active refresh; a queued Apply rejects source changes before saving', async () => {
  await open(); await configure();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:refresh');
    (globalThis as any).statusSiteGate = { armed: false, started: false };
    ipcMain.removeHandler('workspace:refresh');
    ipcMain.handle('workspace:refresh', async (event, ...args) => {
      const gate = (globalThis as any).statusSiteGate;
      if (gate.armed) { gate.armed = false; gate.started = true; await new Promise<void>(resolve => { gate.release = resolve; }); }
      return original(event, ...args);
    });
  });
  const hold = async () => {
    await app.evaluate(() => { const gate = (globalThis as any).statusSiteGate; gate.armed = true; gate.started = false; });
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#refresh')!.click());
    await expect.poll(() => app.evaluate(() => (globalThis as any).statusSiteGate.started)).toBe(true);
  };
  const release = () => app.evaluate(() => (globalThis as any).statusSiteGate.release());
  await hold(); await page.locator('#config-preview').click();
  await expect(page.locator('#config-status')).toContainText('Waiting for the current project refresh before previewing');
  await release(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await hold(); await page.locator('#config-apply').click();
  await expect(page.locator('#config-status')).toContainText('Waiting for the current project refresh before applying');
  expect(await saved()).toEqual(config);
  await writeFile(path.join(project, 'a.md'), source.replace('[Approved]', '[Draft]')); await release();
  await expect(page.locator('#config-status')).toContainText('Markdown changed');
  await expect(page.locator('#config-apply')).toBeDisabled(); expect(await saved()).toEqual(config);
  await preview(); await hold(); await page.locator('#config-apply').click();
  await expect(page.locator('#config-status')).toContainText('Waiting for the current project refresh before applying');
  await release(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  expect((await saved()).statusSites.headings.enabled).toBe(true); await expect(card('REQ-2').locator('.status-badge').first()).toHaveText('Status conflict');
});
