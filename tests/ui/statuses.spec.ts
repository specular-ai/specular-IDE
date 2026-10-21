import { failAutosave } from './autosave-fixture';
import { expandConfigurationEntries } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1, categories: [{ key: 'requirements', name: 'Requirements', role: 'requirement', colors: { dark: '#ffcc00' } }], rules: [{ key: 'req', category: 'requirements', prefix: 'REQ' }], modules: [{ key: 'gui', name: 'GUI' }], moduleRules: [{ key: 'all', path: '.', scope: 'folder', modules: ['gui'] }] };
const source = '# REQ-1 Login\nStatus: Confirmed\n\n# REQ-2 Second\nStatus: confirmed\n\n| ID | Status | Description |\n| --- | --- | --- |\n| REQ-3 | Draft | Third |\n';
const card = (id: string) => page.locator(`#lens-results .lens-card[data-id="${id}"]`).first();
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow(); await expect(card('REQ-1')).toBeVisible();
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
async function open() { await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click(); await page.getByRole('button', { name: 'Rescan statuses', exact: true }).click(); await expect(page.locator('#config-statuses')).toContainText('Found 2 authored status values'); await expandConfigurationEntries(page); }
async function apply() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); }
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/statuses-')); project = path.join(root, 'project'); await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config)); await writeFile(path.join(project, 'a.md'), source); await launch();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); if (app) await close().catch(() => {}); });
test('scan case variants, add future status, customize both themes, preview, apply and restart', async () => {
  await open(); await expect(page.locator('.status-row')).toHaveCount(2);
  const first = page.locator('.status-row').first(); await first.getByLabel('dark status hex').fill('#ff0000'); await first.getByLabel('light status hex').fill('#00ff00');
  await expect(first.locator('[data-status-mode=dark] .status-badge')).toHaveCSS('border-color', 'rgb(255, 0, 0)');
  await page.getByRole('button', { name: 'Add status', exact: true }).click(); await page.locator('.status-row').last().getByLabel('Status name').fill('Released');
  await page.screenshot({ path: 'test-results/status-configuration.png' }); await apply();
  await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveCSS('border-color', 'rgb(255, 0, 0)'); await expect(card('REQ-1').locator('.module-badge')).toHaveText('GUI'); await expect(card('REQ-1')).toHaveCSS('border-left-color', 'rgb(255, 204, 0)');
  await page.locator('#theme-switch').click(); await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveCSS('border-color', 'rgb(0, 255, 0)');
  await card('REQ-1').locator('.status-evidence summary').click(); await card('REQ-1').locator('.status-evidence button').click(); await expect(page.locator('#document-path')).toHaveText('a.md');
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(source);
  await close(); await launch(); await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveCSS('border-color', 'rgb(0, 255, 0)');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')); expect(saved.statuses.map((s: any) => s.name)).toContain('Released'); expect(saved.categories).toEqual(config.categories);
});
test('invalid and duplicate names block Apply; cancellation and rescanning preserve colors', async () => {
  await open(); const first = page.locator('.status-row').first(); await first.getByLabel('dark status hex').fill('bad'); await expect(page.locator('#config-error')).toContainText('six-digit'); await expect(page.locator('#config-apply')).toBeDisabled();
  await first.getByRole('button', { name: 'Reset dark status color' }).click(); await first.getByLabel('dark status hex').fill('#123456');
  await page.getByRole('button', { name: 'Rescan statuses' }).click(); await expect(page.locator('#config-statuses')).toContainText('added 0'); await expect(first.getByLabel('dark status hex')).toHaveValue('#123456');
  await page.locator('.status-row').last().getByLabel('Status name').fill(' CONFIRMED '); await expect(page.locator('#config-error')).toContainText('unique'); await page.keyboard.press('Escape');
  expect(JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'))).toEqual(config);
});
test('new authored values appear without palette, conflicts retain evidence and edits remove stale status', async () => {
  await writeFile(path.join(project, 'a.md'), '# REQ-1 Login\nStatus: Reviewed\n\nStatus: Rejected\n'); await page.locator('#refresh').click();
  await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveText('Status conflict'); await card('REQ-1').locator('.status-evidence summary').click(); await expect(card('REQ-1').locator('.status-evidence')).toContainText('Reviewed'); await expect(card('REQ-1').locator('.status-evidence')).toContainText('Rejected');
  const old = await card('REQ-1').locator('.status-evidence button').first().elementHandle();
  await writeFile(path.join(project, 'a.md'), '# REQ-1 Login\n'); await page.locator('#refresh').click(); await expect(card('REQ-1').locator('.status-badge')).toHaveCount(0); await old!.evaluate(b => (b as HTMLButtonElement).click()); await expect(page.locator('#document-path')).toHaveText('a.md');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720)); await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click(); await page.getByRole('button', { name: 'Rescan statuses', exact: true }).click(); await expect(page.locator('#config-statuses')).toContainText('Found 0');
  expect(await page.locator('#project-configuration-dialog').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
});
test('rename display text, broaden rules, preview mappings and preserve source across restart', async () => {
  const text = '# REQ-1 Login\nStatus: Implemented in increment 40 on 2026-09-16. Related: REQ-172; DD-044, DD-045.\n\n# REQ-2 Second\nStatus: Implemented in increment 41.\n';
  await writeFile(path.join(project, 'a.md'), text); await page.locator('#refresh').click(); await open();
  const first = page.locator('.status-row').first();
  await first.getByLabel('Status name').fill('Implemented');
  await expect(first.getByLabel('Status matching text')).toHaveValue('Implemented in increment 40 on 2026-09-16. Related: REQ-172; DD-044, DD-045.');
  await first.getByLabel('Status matching mode').selectOption('startsWith'); await first.getByLabel('Status matching text').fill('Implemented');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-error')).toContainText('Ambiguous status mapping'); await expect(page.locator('#config-apply')).toBeDisabled();
  await page.locator('.status-row').last().getByRole('button', { name: 'Remove status', exact: true }).click();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await expect(page.locator('#config-results')).toContainText('Implemented in increment 41.');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  await expect(card('REQ-2').locator('.lens-row > .status-badge')).toHaveText('Implemented');
  await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click(); await page.getByRole('button', { name: 'Rescan statuses', exact: true }).click(); await expect(page.locator('#config-statuses')).toContainText('added 0'); await expect(page.locator('.status-row')).toHaveCount(1); await expandConfigurationEntries(page);
  await first.getByLabel('Status matching mode').selectOption('regex'); await expect(first.getByLabel('Status matching text')).toHaveValue('^Implemented.*$');
  await first.getByLabel('Status matching text').fill('^implemented\\b.*$'); await apply();
  await close(); await launch(); await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveText('Implemented'); expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(text);
});
test('invalid and pathological status regexes cannot be applied and can be repaired', async () => {
  await writeFile(path.join(project, 'a.md'), '# REQ-1 Login\nStatus: ' + 'a'.repeat(40) + '!\n\n# REQ-2 Second\nStatus: Draft\n'); await page.locator('#refresh').click(); await open();
  const row = page.locator('.status-row').first(); await row.getByLabel('Status name').fill('Implemented'); await row.getByLabel('Status matching mode').selectOption('regex');
  await row.getByLabel('Status matching text').fill('('); await expect(page.locator('#config-error')).toContainText('Invalid status regular expression'); await expect(page.locator('#config-apply')).toBeDisabled();
  await row.getByLabel('Status matching text').fill('(a+)+$'); await page.locator('#config-preview').click(); await expect(page.locator('#config-error')).toContainText('was stopped', { timeout: 15000 }); await expect(page.locator('#config-apply')).toBeDisabled();
  await row.getByLabel('Status matching text').fill('^a+!$'); await apply(); await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveText('Implemented');
});
test('numbered entries collapse to names, support keyboard editing and retain state through rescan', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  await page.locator('#project-config-open').click();
  await expect(page.locator('.config-category').first().getByLabel('Name', { exact: true })).toBeHidden();
  await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click(); await page.getByRole('button', { name: 'Rescan statuses', exact: true }).click(); await expect(page.locator('#config-statuses')).toContainText('Found 2');
  const found = page.locator('.status-found'), foundTitle = found.locator(':scope > summary'), foundTexts = found.locator(':scope > div');
  await expect(foundTitle).toHaveText('Show found authored texts (2)'); await expect(foundTexts).toBeHidden();
  await foundTitle.click(); await expect(foundTitle).toHaveText('Hide found authored texts (2)'); await expect(foundTexts).toBeVisible();
  await expect(foundTexts).toContainText('confirmed'); await expect(foundTexts).toContainText('Draft');
  await foundTitle.click(); await expect(foundTitle).toHaveText('Show found authored texts (2)'); await expect(foundTexts).toBeHidden();
  await foundTitle.focus(); await page.keyboard.press('Enter'); await expect(foundTexts).toBeVisible();
  const entries = page.locator('.status-list > .config-entry');
  await expect(entries.first().locator(':scope > summary')).toHaveText('1. confirmed');
  await expect(entries.last().locator(':scope > summary')).toHaveText('2. Draft');
  await expect(entries.first().getByLabel('Status name')).toBeHidden();
  await entries.last().locator(':scope > summary').focus(); await page.keyboard.press('Enter');
  await entries.last().getByLabel('Status name').fill('confirmed');
  await expect(entries.last().locator(':scope > summary')).toHaveText('2. confirmed');
  await expect(page.locator('#config-error')).toContainText('entry 1 "confirmed" and entry 2 "confirmed"');
  await entries.last().getByLabel('Status name').fill('Proposed');
  await entries.last().locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Rescan statuses' }).click(); await expect(page.locator('#config-statuses')).toContainText('added 0');
  await expect(foundTitle).toHaveText('Hide found authored texts (2)'); await expect(foundTexts).toBeVisible();
  await foundTitle.focus(); await page.keyboard.press('Space'); await expect(foundTexts).toBeHidden(); await expect(foundTitle).toHaveText('Show found authored texts (2)');
  await expect(entries.last().getByLabel('Status name')).toBeHidden();
  await page.screenshot({ path: 'test-results/configuration-collapsed.png' });
  await entries.first().locator(':scope > summary').click();
  await page.getByRole('button', { name: 'Add status', exact: true }).click();
  await expect(entries.last().getByLabel('Status name')).toBeFocused();
  await entries.last().getByLabel('Status name').fill('Released');
  await expect(entries.first().getByLabel('Status name')).toBeVisible();
  await apply();
});


const deleteStatuses = () => page.getByRole('button', { name: 'Delete all statuses', exact: true });
async function expectEmptyStatuses() {
  await expect(page.locator('.status-row')).toHaveCount(0);
  await expect(deleteStatuses()).toBeDisabled();
  await expect(page.locator('.status-list')).toContainText('No statuses configured');
}
async function reopenEmptyStatuses() {
  await page.locator('#project-config-open').click();
  await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click();
  await expectEmptyStatuses();
}
async function savedStatusesConfiguration() { return JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')); }
async function prepareStatusDeletion() {
  await open();
  const first = page.locator('.status-row').first();
  await first.getByLabel('Status name').fill('Accepted');
  await first.getByLabel('dark status hex').fill('#123456');
  await first.getByLabel('light status hex').fill('#abcdef');
  await first.getByRole('button', { name: 'Add matching rule', exact: true }).click();
  await first.getByLabel('Status matching mode').last().selectOption('startsWith');
  await first.getByLabel('Status matching text').last().fill('Confirm');
  await first.getByRole('button', { name: 'Add matching rule', exact: true }).click();
  await first.getByLabel('Status matching mode').last().selectOption('regex');
  await first.getByLabel('Status matching text').last().fill('^confirmed$');
  await apply();
  await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveText('Accepted');
  const saved = await savedStatusesConfiguration(); await open(); return saved;
}

test('bulk status deletion cancels, persists an empty list across restart, and allows explicit rescan and add', async () => {
  const before = await prepareStatusDeletion();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await deleteStatuses().focus(); await page.keyboard.press('Enter'); await expectEmptyStatuses();
  await expect(page.locator('#config-apply')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add status', exact: true })).toBeFocused();
  await page.locator('#config-cancel').click(); expect(await savedStatusesConfiguration()).toEqual(before);
  await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveText('Accepted');
  await open(); await deleteStatuses().click(); await apply();
  expect(await savedStatusesConfiguration()).toEqual({ ...before, statuses: [] });
  await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveText(/confirmed/i);
  await expect(card('REQ-1').locator('.lens-row > .status-badge')).not.toHaveCSS('border-color', 'rgb(18, 52, 86)');
  await card('REQ-1').locator('.status-evidence summary').click(); await card('REQ-1').locator('.status-evidence button').click();
  await expect(page.locator('#document-path')).toHaveText('a.md');
  await reopenEmptyStatuses(); await page.getByRole('tab', { name: 'Discover IDs', exact: true }).click(); await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click(); await expectEmptyStatuses();
  await page.screenshot({ path: 'test-results/statuses-empty-dark.png' }); await page.locator('#config-cancel').click();
  await page.locator('#theme-switch').click(); await close(); await launch(); await reopenEmptyStatuses();
  await page.screenshot({ path: 'test-results/statuses-empty-light.png' });
  await page.getByRole('button', { name: 'Rescan statuses' }).click(); await expect(page.locator('#config-statuses')).toContainText('added 2');
  await apply(); const rescanned = await savedStatusesConfiguration(); expect(rescanned.statuses).toHaveLength(2);
  expect(rescanned.statuses.every((s: any) => !s.colors && s.rules.length === 1 && s.rules[0].mode === 'exact')).toBe(true);
  await open(); await deleteStatuses().click(); await page.getByRole('button', { name: 'Add status', exact: true }).click();
  await page.locator('.status-row').getByLabel('Status name').fill('Released'); await apply();
  expect((await savedStatusesConfiguration()).statuses.map((s: any) => s.name)).toEqual(['Released']);
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(source);
});

test('bulk status deletion rejects an in-flight scan result', async () => {
  await open();
  await page.evaluate(() => {
    const original = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message: any) {
      const receive = this.onmessage;
      this.onmessage = event => { (window as any).releaseStatusScan = () => receive?.call(this, event); };
      Worker.prototype.postMessage = original;
      original.call(this, message);
    };
  });
  await page.getByRole('button', { name: 'Rescan statuses' }).click();
  await page.waitForFunction(() => !!(window as any).releaseStatusScan);
  await deleteStatuses().click(); await expectEmptyStatuses();
  await page.evaluate(() => (window as any).releaseStatusScan()); await expectEmptyStatuses();
  await apply(); expect((await savedStatusesConfiguration()).statuses).toEqual([]);
});

test('bulk status deletion preserves the draft after save failure and external conflict', async () => {
  const before = await prepareStatusDeletion(); await deleteStatuses().click();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let first = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (first) { first = false; return { ok: false, message: 'Simulated status deletion write failure' }; }
      return original(event, ...args);
    });
  });
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#config-error')).toContainText('write failure');
  await expectEmptyStatuses(); expect(await savedStatusesConfiguration()).toEqual(before);
  await expect(card('REQ-1').locator('.lens-row > .status-badge')).toHaveText('Accepted');
  await apply(); expect((await savedStatusesConfiguration()).statuses).toEqual([]);
  await reopenEmptyStatuses(); await page.getByRole('button', { name: 'Rescan statuses' }).click();
  await expect(page.locator('#config-statuses')).toContainText('added 2'); await deleteStatuses().click();
  const external = { ...before, modules: [{ key: 'gui', name: 'External GUI' }] };
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(external));
  await expect(page.locator('#config-error')).toContainText('configuration changed on disk');
  await expect(page.locator('#config-apply')).toBeDisabled(); await expectEmptyStatuses();
  expect(await savedStatusesConfiguration()).toEqual(external);
  await page.locator('#config-reload').click(); await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click();
  await expect(page.locator('.status-row')).toHaveCount(2); await deleteStatuses().click(); await apply();
  expect(await savedStatusesConfiguration()).toEqual({ ...external, statuses: [] });
});

test('bulk status deletion leaves unsaved Markdown and undo intact', async () => {
  await prepareStatusDeletion(); await page.locator('#config-cancel').click();
  // This scenario tests buffer preservation; use the card's stable document action during refresh.
  await card('REQ-1').locator('.lens-row').click(); await expect(page.locator('#document-path')).toHaveText('a.md');
  await failAutosave(app); await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nUnsaved note\n'); await expect(page.locator('#dirty-indicator')).toHaveText('Save failed');
  await open(); await deleteStatuses().click(); await apply();
  await expect(page.locator('#editor .cm-content')).toContainText('Unsaved note');
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(source);
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+z');
  await expect(page.locator('#editor .cm-content')).not.toContainText('Unsaved note');
  expect((await savedStatusesConfiguration()).statuses).toEqual([]);
});
