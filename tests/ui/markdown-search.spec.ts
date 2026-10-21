import { failAutosave } from './autosave-fixture';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';

let app: ElectronApplication, page: Page, project: string, second: string;
const nested = 'specifications/a-long-folder-name-for-readable-search-results/design.markdown';
const original = '# REQ-175 — Search\r\n\r\nNeedle needle [a+b]. 🧭 CAFÉ\r\n\r\n~~~ts\r\nNeedle\r\n~~~\r\n';
const results = () => page.locator('.markdown-search-result');
const query = () => page.locator('#markdown-search-query');
async function find(text: string) { await query().fill(text); }
async function selected() { return page.evaluate(() => window.getSelection()?.toString()); }

test.beforeEach(async () => {
  const base = path.resolve('.cache/markdown-search-ui'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-')); project = path.join(root, 'project'); second = path.join(root, 'second');
  await mkdir(path.dirname(path.join(project, nested)), { recursive: true });
  await mkdir(path.join(project, 'node_modules')); await mkdir(second);
  await writeFile(path.join(project, 'README.md'), original);
  await writeFile(path.join(project, nested), '# Design\r\n\r\nNested needle with a matching passage.\r\n');
  await writeFile(path.join(project, 'notes.md'), '# Notes\n\nNo matching passage here.\n');
  await writeFile(path.join(project, 'code.ts'), 'const needle = true;');
  await writeFile(path.join(project, 'node_modules/ignored.md'), 'needle');
  await writeFile(path.join(second, 'README.md'), '# Second project\n\nDifferent needle here.\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', `--project=${project}`], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await failAutosave(app);
  await expect(page.locator('#document-path')).toHaveText('README.md');
  await expect(page.locator('#workspace')).not.toHaveAttribute('inert', '');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => undefined);
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
    await app.close().catch(() => undefined);
  }
});

test('current-file and project shortcuts find literal text, case variants and unopened Markdown, with exact source navigation', async () => {
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+f');
  await expect(query()).toBeFocused(); await expect(page.locator('#markdown-search-scope')).toHaveValue('current');
  await find('needle'); await expect(results()).toHaveCount(3);
  await page.locator('#markdown-search-case').check(); await expect(results()).toHaveCount(1);
  await page.locator('#markdown-search-case').uncheck();
  await find('[a+b].'); await expect(results()).toHaveCount(1);
  await query().press('Enter'); await expect(results().first()).toBeFocused(); await page.keyboard.press('Enter');
  await expect.poll(selected).toBe('[a+b].');
  await expect(page.locator('#cursor-status')).toHaveText('Ln 3, Col 21');
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('#markdown-search-scope')).toHaveValue('project');
  await find('needle'); await expect(results()).toHaveCount(4);
  await expect(page.locator('.markdown-search-group h3')).toHaveText(['README.md', nested]);
  await page.screenshot({ path: 'test-results/markdown-search-project.png' });
  await page.locator('#toggle-source').click(); await expect(page.locator('#source-panel')).toBeHidden();
  await results().last().click();
  await expect(page.locator('#document-path')).toHaveText(nested);
  await expect(page.locator('#source-panel')).toBeVisible(); await expect.poll(selected).toBe('needle');
  await expect(page.locator('#cursor-status')).toHaveText('Ln 3, Col 14');
  expect(await readFile(path.join(project, 'README.md'), 'utf8')).toBe(original);
});

test('results follow unsaved edits and the active Markdown file without saving; empty and non-Markdown scopes explain their state', async () => {
  await page.locator('#markdown-search-open').click();
  await expect(page.locator('#markdown-search-status')).toHaveText('Enter text to search.');
  await find('unsavedMarker'); await expect(page.locator('#markdown-search-status')).toContainText('No matches');
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nunsavedMarker');
  await expect(results()).toHaveCount(1); await results().first().click(); await expect.poll(selected).toBe('unsavedMarker');
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  await page.keyboard.insertText('replacement'); await expect(results()).toHaveCount(0);
  await find('replacement'); await expect(results()).toHaveCount(1);
  await page.locator('#markdown-search-scope').selectOption('current');
  await page.locator('#markdown-search-close').click(); await page.locator('[data-file="notes.md"]').click();
  await page.locator('.cm-content').focus(); await page.keyboard.press('Control+f');
  await expect(page.locator('#markdown-search-status')).toContainText('No matches in notes.md');
  await page.locator('#markdown-search-close').click(); await page.locator('[data-file="code.ts"]').click();
  await page.locator('#markdown-search-open').click(); await page.locator('#markdown-search-scope').selectOption('current');
  await expect(page.locator('#markdown-search-status')).toContainText('Open a Markdown document');
  await page.getByRole('tab', { name: 'README.md ●', exact: true }).click();
  await expect(results()).toHaveCount(1);
  await find(''); await expect(results()).toHaveCount(0);
  await query().press('Escape'); await expect(page.locator('#markdown-search-panel')).toBeHidden();
  await expect(page.locator('#markdown-search-open')).toBeFocused();
  expect(await readFile(path.join(project, 'README.md'), 'utf8')).toBe(original);
});

test('workspace refresh updates deleted/changed passages and reports incomplete coverage and the result limit', async () => {
  await writeFile(path.join(project, 'many.md'), 'limitneedle\n'.repeat(501));
  await writeFile(path.join(project, 'broken.md'), Buffer.from([0, 1, 2]));
  await page.locator('#refresh').click(); await page.locator('#markdown-search-open').click();
  await find('limitneedle'); await expect(results()).toHaveCount(500);
  await expect(page.locator('#markdown-search-status')).toContainText('More matches exist');
  await expect(page.locator('#markdown-search-notice')).toContainText('broken.md');
  await unlink(path.join(project, 'many.md')); await page.locator('#refresh').click();
  await expect(results()).toHaveCount(0); await expect(page.locator('#markdown-search-status')).toContainText('No matches');
  await find('needle'); await expect(results()).toHaveCount(4);
  await writeFile(path.join(project, nested), '# Changed\nThe passage was removed.\n'); await page.locator('#refresh').click();
  await expect(results()).toHaveCount(3);
});

test('a file changed between search and read refreshes results without opening an outdated match', async () => {
  await page.locator('#markdown-search-open').click(); await find('Nested'); await expect(results()).toHaveCount(1);
  await app.evaluate(({ ipcMain }, file) => {
    const original = (ipcMain as any)._invokeHandlers.get('document:read');
    ipcMain.removeHandler('document:read');
    ipcMain.handle('document:read', async (event, requested) => requested === file
      ? { path: file, text: '# Fresh content\n\nNested moved to a different position.\n', version: 'changed' } : original(event, requested));
  }, nested);
  await results().first().click();
  await expect(page.locator('#toast')).toContainText('file changed since searching');
  await expect(page.locator('#document-path')).toHaveText('README.md');
  await expect(results()).toHaveCount(1); await expect(results().first()).toContainText('moved to a different position');
  await results().first().click(); await expect(page.locator('#document-path')).toHaveText(nested);
  await expect.poll(selected).toBe('Nested');
});

test('a pending navigation is discarded when the query or project changes', async () => {
  await page.locator('#markdown-search-open').click(); await find('Nested'); await expect(results()).toHaveCount(1);
  await app.evaluate(({ ipcMain }, file) => {
    const original = (ipcMain as any)._invokeHandlers.get('document:read');
    ipcMain.removeHandler('document:read');
    ipcMain.handle('document:read', async (event, requested) => {
      const document = await original(event, requested);
      if (requested !== file) return document;
      return new Promise(resolve => { (globalThis as any).releaseSearchRead = () => resolve(document); });
    });
  }, nested);
  await results().first().click();
  await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseSearchRead)).toBe('function');
  await find('absent'); await expect(results()).toHaveCount(0);
  await app.evaluate(async () => { await (globalThis as any).releaseSearchRead(); });
  await expect(page.locator('#document-path')).toHaveText('README.md');
  await find('Nested'); await expect(results()).toHaveCount(1); await results().first().click();
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, second);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveAttribute('title', second);
  await app.evaluate(async () => { await (globalThis as any).releaseSearchRead(); });
  await expect(page.locator('#document-path')).toHaveText('README.md');
  await expect(page.locator('#preview')).toContainText('Second project');
  await expect(results()).toHaveCount(0);
  await find('needle'); await expect(results()).toHaveCount(1); await expect(results().first()).toContainText('Different needle');
});

test('search shortcuts leave terminal input and ID lookup available', async () => {
  // Playwright keyboard events do not invoke native menu accelerators; exercise the existing menu action.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('app:action', 'search'));
  await expect(page.locator('#id-search')).toBeFocused();
  await page.locator('#id-search').fill('REQ-175'); await expect(page.locator('#lens-results .lens-row')).toHaveCount(1);
  await page.locator('#show-terminals').click(); await page.locator('[data-terminal-kind="cmd"]').click();
  const terminal = page.locator('.terminal-host:not([hidden]) .xterm-helper-textarea');
  await terminal.focus(); await page.keyboard.press('Control+f'); await page.keyboard.press('Control+Shift+f');
  await expect(page.locator('#markdown-search-panel')).toBeHidden(); await expect(terminal).toBeFocused();
});
