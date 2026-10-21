import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failAutosave } from './autosave-fixture';

let app: ElectronApplication;
let page: Page;
let root: string;
let userData: string;
let first: string;
let second: string;
async function launch(project?: string, welcome = false) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  env.SPECULAR_USER_DATA = userData;
  app = await electron.launch({ args: ['.', ...(project ? [`--project=${project}`] : [])], env, cwd: process.cwd() });
  page = await app.firstWindow();
  await expect(page.locator(welcome ? '#welcome' : '#workspace')).toBeVisible();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert', '');
}
async function closeNormally() {
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await closed;
}
async function choose(folder: string) {
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder);
  await page.locator('#open-project').click();
  await expect(page.locator('#project-heading')).toHaveAttribute('title', folder);
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert', '');
}
const tabs = () => page.locator('#tabs [role="tab"]');
test.beforeEach(async () => {
  const base = path.resolve('.cache/restore-ui-tests'); await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, 'run-')); userData = path.join(root, 'user-data');
  first = path.join(root, 'first'); second = path.join(root, 'second');
  await mkdir(path.join(first, 'src'), { recursive: true }); await mkdir(second);
  await writeFile(path.join(first, 'README.md'), '# First project\n');
  await writeFile(path.join(first, 'notes.md'), '# Notes saved on disk\n');
  await writeFile(path.join(first, 'src/code.ts'), 'export const value = 1;\n');
  await writeFile(path.join(second, 'README.md'), '# Second project\n');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => undefined);
  if (app) {
    await app.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined);
    await app.close().catch(() => undefined);
  }
});

test('normal close restores saved Markdown and code tabs in order with the active tab and current disk content', async () => {
  await launch(first);
  await page.locator('[data-file="notes.md"]').click();
  await page.locator('[data-folder="src"]').click(); await page.locator('[data-file="src/code.ts"]').click();
  await page.getByRole('tab', { name: 'notes.md', exact: true }).click();
  await closeNormally();
  const saved = JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8'));
  expect(saved.lastProject).toBe(first);
  expect(saved.workspaceSessions[0]).toEqual({ root: first, files: ['README.md', 'notes.md', 'src/code.ts'], activeFile: 'notes.md' });
  await writeFile(path.join(first, 'notes.md'), '# Fresh disk content\n');
  await launch();
  await expect(tabs()).toHaveText(['README.md', 'notes.md', 'code.ts']);
  await expect(page.locator('#document-path')).toHaveText('notes.md');
  await expect(page.locator('#preview')).toContainText('Fresh disk content');
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  await page.getByRole('tab', { name: 'code.ts', exact: true }).click();
  await expect(page.locator('#save')).toHaveCount(0);
  await expect(page.locator('.cm-content')).toHaveAttribute('aria-readonly', 'true');
  const code = await page.locator('.cm-content').innerText();
  await page.locator('.cm-content').click(); await page.keyboard.insertText('Unexpected edit');
  await expect(page.locator('.cm-content')).toHaveText(code);
  await page.screenshot({ path: 'test-results/restored-workspace.png' });
});

test('project switches restore each tab set and an intentionally empty workspace survives restart', async () => {
  await launch(first); await page.locator('[data-file="notes.md"]').click();
  await page.getByRole('button', { name: 'Close README.md', exact: true }).click();
  await choose(second); await expect(tabs()).toHaveText(['README.md']);
  await choose(first); await expect(tabs()).toHaveText(['notes.md']);
  await page.getByRole('button', { name: 'Close notes.md', exact: true }).click();
  await expect(page.locator('#document-empty')).toBeVisible();
  await closeNormally(); await launch();
  await expect(page.locator('#project-heading')).toHaveAttribute('title', first);
  await expect(tabs()).toHaveCount(0);
  await expect(page.locator('#document-empty')).toBeVisible();
  await choose(second); await expect(tabs()).toHaveText(['README.md']);
});

test('missing and unreadable tabs are skipped and an unavailable last project falls back to welcome', async () => {
  await launch(first); await page.locator('[data-file="notes.md"]').click();
  await page.locator('[data-folder="src"]').click(); await page.locator('[data-file="src/code.ts"]').click();
  await closeNormally();
  await unlink(path.join(first, 'notes.md')); await writeFile(path.join(first, 'src/code.ts'), Buffer.from([0, 1]));
  await launch();
  await expect(tabs()).toHaveText(['README.md']);
  await expect(page.locator('#warnings')).toContainText('notes.md');
  await expect(page.locator('#warnings')).toContainText('src/code.ts');
  await closeNormally();
  await rename(first, first + '-moved');
  await launch(undefined, true);
  await expect(page.locator('#toast')).toContainText('Could not open the project folder');
  await expect(page.locator('#welcome-recent .recent-open')).toHaveCount(1);
  await choose(first + '-moved'); await expect(tabs()).toHaveText(['README.md']);
});

test('cancelled close retains unsaved text; accepted close restores only disk content and launch arguments override last project', async () => {
  await launch(first); await page.locator('[data-file="notes.md"]').click();
  await failAutosave(app);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nUnsaved secret text');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  await expect(page.locator('#close-tab-dialog')).toBeVisible(); await page.locator('#close-tab-cancel').click();
  await expect(page.locator('.cm-content')).toContainText('Unsaved secret text');
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  const closed = app.waitForEvent('close'); await page.locator('#close-tab-discard').click(); await closed;
  expect(await readFile(path.join(userData, 'settings.json'), 'utf8')).not.toContain('Unsaved secret text');
  await launch();
  await expect(page.locator('#document-path')).toHaveText('notes.md');
  await expect(page.locator('.cm-content')).not.toContainText('Unsaved secret text');
  await closeNormally(); await launch(second);
  await expect(page.locator('#project-heading')).toHaveAttribute('title', second);
  await expect(page.locator('#preview')).toContainText('Second project');
});
