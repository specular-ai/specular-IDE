import { test, expect, _electron as electron, type ElectronApplication, type Page, type Frame } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';

let app: ElectronApplication, page: Page, root: string, project: string, userData: string;
const markdown = '# REQ-001 - Readable workspace\n\nText with **bold**, *emphasis*, `code`, and [a link](#req-001---readable-workspace).\n\n| Name | Value |\n| --- | --- |\n| Mode | Light and dark |\n\n- 2026-09-16: Added REQ-001.\n\n## DD-001 - Appearance\n\nImplements REQ-001.\n\n```mermaid\ngraph LR\n A[Readable text] --> B[Both modes]\n```\n';
async function launch(open = true) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', ...(open ? ['--project=' + project] : [])], env: { ...env, SPECULAR_USER_DATA: userData } });
  page = await app.firstWindow(); await expect(page.locator('#theme-switch')).toBeEnabled();
  if (open) await expect(page.locator('#preview')).toContainText('Readable workspace');
}
async function close() {
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close()); await closed;
}
async function mode(value: 'light' | 'dark') {
  const control = page.getByRole('switch', { name: 'Dark mode' });
  if ((await control.getAttribute('aria-checked')) !== String(value === 'dark')) await control.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', value);
  await expect(control).toHaveAttribute('aria-checked', String(value === 'dark'));
}
test.beforeEach(async () => {
  await mkdir('.cache/appearance-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/appearance-tests/run-'));
  project = path.join(root, 'project'); userData = path.join(root, 'user-data'); await mkdir(project); await mkdir(userData);
  await writeFile(path.join(project, 'README.md'), markdown); await writeFile(path.join(project, 'notes.md'), '# Other document\n');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('upper-right switch preserves editing, preview selection, Mermaid, and saved preference', async () => {
  await launch(); await expect(page.locator('#theme-switch')).toHaveAttribute('aria-checked', 'true');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nNew text');
  await page.keyboard.press('Control+Shift+ArrowLeft');
  const cursor = await page.locator('#cursor-status').textContent();
  await expect(page.locator('#preview')).toContainText('New text');
  await page.locator('#preview p').first().evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(range); });
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  await mode('light');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await expect(page.locator('#cursor-status')).toHaveText(cursor!);
  await expect(page.locator('#editor .cm-editor')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(page.locator('#preview [data-theme="light"] svg')).toBeVisible();
  await page.screenshot({ path: 'test-results/appearance-light.png' });
  await page.locator('.cm-content').focus(); await page.keyboard.insertText('replacement');
  await expect(page.locator('.cm-content')).toContainText('New replacement');
  await page.keyboard.press('Control+z'); await expect(page.locator('.cm-content')).toContainText('New text');
  await expect.poll(async () => readFile(path.join(project, 'README.md'), 'utf8')).toContain('New text');
  await page.locator('#theme-switch').focus(); await page.keyboard.press('Space');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#preview [data-theme="dark"] svg')).toBeVisible();
  await page.screenshot({ path: 'test-results/appearance-dark.png' });
  await page.locator('#theme-switch').evaluate(button => { for (let i = 0; i < 7; i++) (button as HTMLButtonElement).click(); });
  await expect(page.locator('#preview [data-theme="light"] svg')).toBeVisible();
  await page.locator('#diagrams-tab').click();
  await expect(page.locator('#preview [data-theme="light"] svg')).toBeVisible();
  await page.locator('#preview-tab').click();
  await mode('light'); await close(); await launch();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(async () => JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8')).theme).toBe('light');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 680));
  const bounds = await page.locator('#theme-switch').boundingBox(); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(980);
  await page.screenshot({ path: 'test-results/appearance-minimum.png' });
});

test('empty workspace, invalid preference and failed save remain usable', async () => {
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ version: 1, theme: 'invalid', fontSizes: { source: 17, preview: 19 } }));
  await launch(false); await expect(page.locator('#welcome')).toBeVisible(); await mode('dark');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('appearance:save-theme'); ipcMain.handle('appearance:save-theme', () => ({ ok: false, message: 'Appearance applies for this session but could not be saved.' })); });
  await mode('light'); await expect(page.locator('#toast')).toContainText('could not be saved');
  expect(JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8')).theme).toBe('invalid');
  await page.screenshot({ path: 'test-results/appearance-welcome.png' });
});

test('bundled custom views switch live without losing selected ID or camera', async () => {
  await launch(); await page.locator('#dependency-overview-open').click();
  let frame = await pluginFrame(app); await expect(frame.locator('#dependency-overview')).toBeVisible();
  await frame.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const camera = await frame.locator('.dependency-graph-controls span').textContent();
  await mode('light'); await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(frame.locator('.dependency-graph-controls span')).toHaveText(camera!);
  await frame.page().screenshot({ path: 'test-results/appearance-relationships-light.png' });
  await mode('dark'); await expect(frame.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(frame.locator('.dependency-graph-controls span')).toHaveText(camera!);
  await frame.page().screenshot({ path: 'test-results/appearance-relationships-dark.png' });
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  // The previous Overview surface can still be visible while Focus is being created.
  await expect.poll(async () => {
    frame = await pluginFrame(app);
    return frame.locator('#relationship-focus').isVisible().catch(() => false);
  }).toBe(true);
  await mode('light'); await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(frame.locator('#relationship-focus')).toBeVisible();
});

test('all independently built examples inherit light/dark and preserve custom filters', async () => {
  await launch();
  // Custom surfaces keep their own filter control; a theme change must not rebuild the view.
  const filter = (frame: Frame, fixture: string) => fixture === 'custom-example'
    ? frame.getByRole('textbox', { name: 'Filter definitions' })
    : frame.getByRole('combobox', { name: 'Source file' });
  for (const [fixture, selector] of [['example', '.plugin-list-item'], ['headings-example', '.plugin-list-item'], ['timeline-example', '#project-timeline'], ['template-example', '.plugin-list-item'], ['custom-example', '#plugin-root main']] as const) {
    const directory = (await readFile(`.cache/plugin-sdk/${fixture}-path.txt`, 'utf8')).trim();
    await app.evaluate(({ dialog }, p) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] }); }, directory);
    await mode('light'); await page.locator('#plugin-view-open').click();
    let custom: Frame | undefined;
    if (selector.startsWith('#')) {
      custom = await pluginFrame(app, selector);
      await expect(custom.locator('html')).toHaveAttribute('data-theme', 'light');
      if (fixture === 'custom-example') await filter(custom, fixture).fill('REQ-001');
      else await filter(custom, fixture).selectOption('README.md');
    } else await expect(page.locator(selector).first()).toBeVisible();
    await page.screenshot({ path: `test-results/appearance-${fixture}-light.png` });
    await mode('dark');
    if (custom) {
      await expect(custom.locator('html')).toHaveAttribute('data-theme', 'dark');
      await expect(filter(custom, fixture)).toHaveValue(fixture === 'custom-example' ? 'REQ-001' : 'README.md');
      await custom.page().screenshot({ path: `test-results/appearance-${fixture}-custom-dark.png` });
      await mode('light'); await expect(custom.locator('html')).toHaveAttribute('data-theme', 'light');
      await custom.page().screenshot({ path: `test-results/appearance-${fixture}-custom-light.png` });
    }
    await page.keyboard.press('Control+w');
  }
});

test('switching preserves native terminal input and updates the active palette', async () => {
  await launch(); await page.locator('#show-terminals').click(); await page.locator('[data-terminal-kind="cmd"]').click();
  await expect(page.locator('#terminal-tabs [role="tab"]')).toHaveCount(1);
  const input = page.locator('.terminal-host:not([hidden]) .xterm-helper-textarea');
  await input.pressSequentially('echo preserved>theme-terminal.txt');
  await mode('light'); await expect(page.locator('.terminal-host:not([hidden]) .xterm-scrollable-element')).toHaveCSS('background-color', 'rgb(244, 247, 250)');
  await page.screenshot({ path: 'test-results/appearance-terminal-light.png' });
  await mode('dark'); await expect(page.locator('.terminal-host:not([hidden]) .xterm-scrollable-element')).toHaveCSS('background-color', 'rgb(16, 24, 32)');
  await input.focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => readFile(path.join(project, 'theme-terminal.txt'), 'utf8').catch(() => '')).toContain('preserved');
  await expect(page.locator('#terminal-tabs [role="tab"]')).toHaveCount(1);
  await input.pressSequentially('exit'); await input.press('Enter');
  await expect(page.locator('#terminal-scope')).toContainText('exited'); await page.locator('#terminal-close').click();
});

test('appearance persists through hidden Source, documents, projects, search and dialogs', async () => {
  await launch(); await mode('light');
  await page.locator('#toggle-source').click(); await expect(page.locator('#source-panel')).toBeHidden();
  await page.locator('.file-row').filter({ hasText: 'notes.md' }).click();
  await mode('dark'); await mode('light');
  await page.locator('#toggle-source').click(); await expect(page.locator('#source-panel')).toBeVisible();
  await expect(page.locator('#editor .cm-editor')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await page.locator('#markdown-search-open').click();
  await page.screenshot({ path: 'test-results/appearance-search-light.png' });
  await page.locator('#show-agent-setup').click(); await page.screenshot({ path: 'test-results/appearance-dialog-light.png' });
  await page.locator('#agent-setup-close').click();
  const second = path.join(root, 'second'); await mkdir(second); await writeFile(path.join(second, 'README.md'), '# Second project');
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, second);
  await page.locator('#open-project').click(); await expect(page.locator('#preview')).toContainText('Second project');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
