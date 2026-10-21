import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failAutosave } from './autosave-fixture';

let application: ElectronApplication;
let page: Page;
let root: string;
let userData: string;
let first: string;
let second: string;
async function launch(restored = false) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  env.SPECULAR_USER_DATA = userData;
  application = await electron.launch({ args: ['.'], env, cwd: process.cwd() });
  page = await application.firstWindow();
  await expect(page.locator(restored ? '#workspace' : '#welcome')).toBeVisible();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert', '');
}
async function stop() {
  await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
  await application.close();
}
async function choose(folder: string, canceled = false, recovery?: 'cancel' | 'discard') {
  await application.evaluate(({ dialog }, { folder, canceled }) => {
    dialog.showOpenDialog = async () => ({ canceled, filePaths: canceled ? [] : [folder] });
  }, { folder, canceled });
  await page.locator('#open-project').click();
  if (recovery) await page.locator(`#close-tab-${recovery}`).click();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert', '');
}
async function menuOpen(folder: string, recovery?: 'cancel' | 'discard') {
  await application.evaluate(({ Menu }, folder) => {
    const file = Menu.getApplicationMenu()!.items.find(item => item.label === 'File')!;
    const recent = file.submenu!.items.find(item => item.label === 'Open recent')!;
    recent.submenu!.items.find(item => item.label.endsWith(folder.replace(/&/g, '&&')))!.click();
  }, folder);
  if (recovery) await page.locator(`#close-tab-${recovery}`).click();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert', '');
}
const history = async () => JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8')).recentProjects;
test.beforeEach(async () => {
  const base = path.resolve('.cache/recent-ui-tests'); await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, 'run-')); userData = path.join(root, 'user-data');
  first = path.join(root, 'one', 'shared'); second = path.join(root, 'two', 'shared');
  for (const folder of [userData, first, second]) await mkdir(folder, { recursive: true });
  await writeFile(path.join(first, 'README.md'), '# First project\n');
  await writeFile(path.join(second, 'README.md'), '# Second project\n');
});
test.afterEach(async ({}, info) => {
  if (application) {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => undefined);
    await stop().catch(() => undefined);
  }
});

test('persists recent projects across restarts, deduplicates canonical folders, and removes history without deleting files', async () => {
  await launch();
  await expect(page.locator('#welcome-recent')).toContainText('No recent projects');
  await choose(first); await expect(page.locator('#preview')).toContainText('First project');
  await choose(second); await expect(page.locator('#preview')).toContainText('Second project');
  const alias = path.join(root, 'alias');
  await symlink(first, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await choose(alias); await expect(page.locator('#project-heading')).toHaveAttribute('title', first);
  expect((await history()).map((entry: any) => entry.path)).toEqual([first, second]);
  await stop(); await launch(true);
  await expect(page.locator('#project-heading')).toHaveAttribute('title', first);
  await page.locator('#show-recent').click();
  const cards = page.locator('#recent-projects-dialog .recent-open');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText(first); await expect(cards.nth(1)).toContainText(second);
  await page.screenshot({ path: 'test-results/recent-projects-welcome.png' });
  await cards.nth(1).click(); await expect(page.locator('#preview')).toContainText('Second project');
  await menuOpen(first); await expect(page.locator('#preview')).toContainText('First project');
  await page.locator('#show-recent').click();
  await page.locator('#recent-projects-dialog').getByRole('button', { name: `Remove ${first} from recent projects`, exact: true }).click();
  await expect(page.locator('#recent-projects-dialog .recent-open')).toHaveCount(1);
  expect(await readFile(path.join(first, 'README.md'), 'utf8')).toContain('First project');
  await stop(); await launch(true);
  await page.locator('#show-recent').click();
  await expect(page.locator('#recent-projects-dialog .recent-open')).toHaveCount(1);
  await page.locator('#recent-projects-dialog .recent-clear').click();
  await expect(page.locator('#recent-projects-dialog .recent-open')).toHaveCount(0);
  expect(await readFile(path.join(second, 'README.md'), 'utf8')).toContain('Second project');
  await stop(); await launch(true);
  await page.locator('#show-recent').click();
  await expect(page.locator('#recent-projects-dialog .recent-open')).toHaveCount(0);
});

test('cancelled and failed recent-project switches preserve unsaved edits, current project, and history', async () => {
  await launch(); await choose(first); await choose(second);
  await failAutosave(application);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nUnsaved work');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed');
  const before = await history();
  await menuOpen(first, 'cancel');
  await expect(page.locator('.cm-content')).toContainText('Unsaved work');
  expect(await history()).toEqual(before);
  await choose(first, true, 'discard');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed');
  expect(await history()).toEqual(before);
  await rename(first, first + '-moved');
  await menuOpen(first, 'discard');
  await expect(page.locator('#toast')).toContainText('Could not open the project folder');
  await expect(page.locator('#project-heading')).toHaveAttribute('title', second);
  await expect(page.locator('.cm-content')).toContainText('Unsaved work');
  expect(await history()).toEqual(before);
  await page.locator('#show-recent').click();
  await page.locator('#recent-projects-dialog .recent-open').filter({ hasText: first }).click();
  await page.locator('#close-tab-discard').click();
  await expect(page.locator('#recent-projects-dialog .recent-warning')).toContainText('Could not open');
  await page.locator('#recent-projects-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await rename(first + '-moved', first);
  await menuOpen(first, 'discard'); await expect(page.locator('#preview')).toContainText('First project');
  expect((await history())[0].path).toBe(first);
  expect(await readFile(path.join(second, 'README.md'), 'utf8')).not.toContain('Unsaved work');
});

test('malformed settings do not block startup and are backed up before recent history is saved', async () => {
  await writeFile(path.join(userData, 'settings.json'), '{broken');
  await launch();
  await expect(page.locator('#welcome-recent .recent-warning')).toContainText('invalid JSON');
  await choose(first); await expect(page.locator('#preview')).toContainText('First project');
  expect((await history())[0].path).toBe(first);
  const backup = (await readdir(userData)).find(name => name.endsWith('.bak'))!;
  expect(await readFile(path.join(userData, backup), 'utf8')).toBe('{broken');
  await stop(); await launch(true);
  await page.locator('#show-recent').click();
  await expect(page.locator('#recent-projects-dialog .recent-open')).toHaveCount(1);
  await expect(page.locator('#recent-projects-dialog .recent-warning')).toHaveCount(0);
});


test('source visibility resets on project switches and app restarts', async () => {
  await launch(); await choose(first);
  await page.locator('#toggle-source').click();
  await expect(page.locator('#source-panel')).toBeHidden();
  await choose(second);
  await expect(page.locator('#source-panel')).toBeVisible();
  await page.locator('#toggle-source').click();
  await expect(page.locator('#source-panel')).toBeHidden();
  await stop(); await launch(true);
  await expect(page.locator('#source-panel')).toBeVisible();
  await expect(page.locator('#toggle-source')).toHaveText('Hide source');
});
