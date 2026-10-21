import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failAutosave, restoreAutosave } from './autosave-fixture';

let app: ElectronApplication, page: Page, project: string, second: string, userData: string;
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', `--project=${project}`], env: { ...env, SPECULAR_USER_DATA: userData } });
  page = await app.firstWindow(); await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#workspace')).not.toHaveAttribute('inert', '');
}
async function edit(text: string) { await page.locator('.cm-content').focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText(text); }
const disk = (file = 'README.md') => readFile(path.join(project, file), 'utf8');
const status = () => page.locator('#dirty-indicator');
async function closeNormally() { const closed = app.waitForEvent('close'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed; }
test.beforeEach(async () => {
  const base = path.resolve('.cache/autosave-ui'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-')); project = path.join(root, 'project'); second = path.join(root, 'second'); userData = path.join(root, 'user-data');
  await mkdir(project); await mkdir(second);
  await writeFile(path.join(project, 'README.md'), '\uFEFF# Autosave\r\n');
  await writeFile(path.join(project, 'notes.markdown'), '# Notes\n');
  await writeFile(path.join(project, 'code.ts'), 'const value = 1;');
  await writeFile(path.join(second, 'README.md'), '# Second\n'); await launch();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => undefined);
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined); await app.close().catch(() => undefined); }
});
test('autosaves edits, undo/redo, inactive Markdown and encoding while retaining selections', async () => {
  await expect(status()).toHaveText('Saved'); await expect(page.locator('#save')).toHaveCount(0);
  expect(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(item => item.label === 'File')!.submenu!.items.some(item => item.label === 'Save'))).toBe(false);
  await edit('\nCafé 🧭 selection'); await page.keyboard.press('Control+Shift+ArrowLeft');
  const cursor = await page.locator('#cursor-status').textContent();
  await expect(status()).toHaveText('Saved'); await expect(page.locator('#cursor-status')).toHaveText(cursor!);
  await expect.poll(disk).toBe('\uFEFF# Autosave\r\nCafé 🧭 selection');
  await page.keyboard.insertText('replacement'); await expect(status()).toHaveText('Saved');
  await expect.poll(disk).toContain('replacement'); await page.keyboard.press('Control+z');
  await expect(status()).toHaveText('Saved'); await expect.poll(disk).toContain('selection');
  await page.keyboard.press('Control+y'); await expect(status()).toHaveText('Saved'); await expect.poll(disk).toContain('replacement');
  await edit('\nInactive edit'); await page.locator('[data-file="notes.markdown"]').click(); await edit('\nOther buffer');
  await expect.poll(disk).toContain('Inactive edit'); await expect.poll(() => disk('notes.markdown')).toContain('Other buffer');
  await page.locator('[data-file="code.ts"]').click(); await edit('not editable');
  expect(await disk('code.ts')).toBe('const value = 1;'); await expect(status()).toHaveText('');
});
test('delayed writes save newer edits with the next version and close only after both complete', async () => {
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('document:save'); let first = true;
    ipcMain.removeHandler('document:save'); ipcMain.handle('document:save', (event, ...args) => {
      if (!first) return original(event, ...args); first = false;
      return new Promise(resolve => { (globalThis as any).releaseSave = async () => resolve(await original(event, ...args)); });
    });
  });
  await edit('\nFirst'); await expect(status()).toHaveText('Saving');
  await edit('\nNewer'); await page.getByRole('button', { name: 'Close README.md', exact: true }).click();
  await expect(page.locator('#workspace')).toHaveAttribute('inert', '');
  await app.evaluate(async () => { await (globalThis as any).releaseSave(); });
  await expect(page.locator('#document-empty')).toBeVisible(); expect(await disk()).toContain('First\r\nNewer');
  await expect(page.locator('#close-tab-dialog')).toBeHidden();
});
test('flushes on project switching and immediate normal close, restoring the latest saved text', async () => {
  await edit('\nBefore switching');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, second);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveAttribute('title', second);
  expect(await disk()).toContain('Before switching');
  expect(await readFile(path.join(second, 'README.md'), 'utf8')).toBe('# Second\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, project);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveAttribute('title', project);
  await edit('\nBefore close'); await closeNormally(); await launch();
  await expect(page.locator('.cm-content')).toContainText('Before close'); await expect(status()).toHaveText('Saved');
});
test('save failure retains buffers and blocks tab/project/window departure until retry or explicit discard', async () => {
  await failAutosave(app); await edit('\nKeep pending'); await expect(status()).toHaveText('Save failed');
  await page.screenshot({ path: 'test-results/autosave-failure.png' });
  await page.getByRole('button', { name: 'Close README.md', exact: true }).click();
  await expect(page.locator('#close-tab-error')).toContainText('Test save failure'); await page.locator('#close-tab-cancel').click();
  await page.locator('#open-project').click(); await expect(page.locator('#close-tab-dialog')).toBeVisible();
  await page.locator('#close-tab-cancel').click(); await expect(page.locator('#project-heading')).toHaveAttribute('title', project);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.locator('#close-tab-dialog')).toBeVisible(); await page.locator('#close-tab-cancel').click();
  await expect(page.locator('#workspace')).not.toHaveAttribute('inert', ''); expect(await disk()).not.toContain('Keep pending');
  await restoreAutosave(app); await page.locator('#retry-save').click(); await expect(status()).toHaveText('Saved');
  expect(await disk()).toContain('Keep pending');
  await failAutosave(app); await edit('\nDiscard this'); await expect(status()).toHaveText('Save failed');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await expect(page.locator('#close-tab-dialog')).toBeVisible();
  const closed = app.waitForEvent('close'); await page.locator('#close-tab-discard').click(); await closed;
  expect(await disk()).not.toContain('Discard this'); await launch(); await expect(page.locator('.cm-content')).not.toContainText('Discard this');
});
test('external conflicts stop writes and reload discards pending text without resurrecting it', async () => {
  await edit('\nLocal edit'); await writeFile(path.join(project, 'README.md'), '# External replacement\n');
  await expect(status()).toHaveText('Conflict'); await expect(page.locator('.cm-content')).toContainText('Local edit');
  await page.getByRole('button', { name: 'Close README.md', exact: true }).click();
  await expect(page.locator('#close-tab-retry')).toBeDisabled(); await page.locator('#close-tab-cancel').click();
  await page.locator('#reload').click(); await page.locator('#confirm-accept').click();
  await expect(status()).toHaveText('Saved'); await expect(page.locator('.cm-content')).toContainText('External replacement');
  await edit('\nAfter recovery'); await expect(status()).toHaveText('Saved');
  expect(await disk()).toBe('# External replacement\nAfter recovery');
});
test('undoing pending conflict edits lets a clean disk refresh resume autosave', async () => {
  await edit('\nLocal edit'); await writeFile(path.join(project, 'README.md'), '# External replacement\n');
  await expect(status()).toHaveText('Conflict');
  await page.locator('.cm-content').press('Control+z'); await page.locator('#refresh').click();
  await expect(page.locator('.cm-content')).toContainText('External replacement'); await expect(status()).toHaveText('Saved');
  await edit('\nNew edit'); await expect(status()).toHaveText('Saved');
  expect(await disk()).toBe('# External replacement\nNew edit');
});

test('a cancelled project picker retains explicitly discarded-on-departure buffers and late cross-project saves are rejected', async () => {
  await failAutosave(app); await edit('\nKeep on cancellation'); await expect(status()).toHaveText('Save failed');
  await app.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await page.locator('#open-project').click(); await page.locator('#close-tab-discard').click();
  await expect(page.locator('#workspace')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.cm-content')).toContainText('Keep on cancellation'); await expect(status()).toHaveText('Save failed');
  await restoreAutosave(app);
  await expect(page.evaluate(() => window.specular.saveDocument('README.md', 'Wrong project', 'v1', 'C:/unrelated'))).rejects.toThrow('project changed');
  expect(await disk()).not.toContain('Wrong project');
});
