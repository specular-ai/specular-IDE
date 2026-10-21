import { failAutosave } from './autosave-fixture';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

let app: ElectronApplication, page: Page, project: string, second: string, userData: string;
const markdown = '# Comfortable reading\n\n## A heading\n\nA paragraph with **bold text**, `inline code`, and REQ-173.\n\n- First item\n- Second item\n\n| Name | Value |\n| --- | --- |\n| Size | Adjustable |\n\n~~~typescript\nconst size = 13;\n~~~\n';
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', `--project=${project}`], env: { ...env, SPECULAR_USER_DATA: userData } });
  page = await app.firstWindow(); await failAutosave(app);
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#source-font-reset')).toBeEnabled();
}
async function closeNormally() {
  const closed = app.waitForEvent('close');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await closed;
}
async function sizes(source: number, preview: number) {
  await expect(page.locator('#source-font-size')).toHaveText(`${source} px`);
  await expect(page.locator('#preview-font-size')).toHaveText(`${preview} px`);
  await expect(page.locator('#editor .cm-editor')).toHaveCSS('font-size', `${source}px`);
  await expect(page.locator('#preview')).toHaveCSS('font-size', `${preview}px`);
}
async function selectParagraph() {
  const paragraph = page.locator('#preview p').first();
  await paragraph.scrollIntoViewIfNeeded();
  await paragraph.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
  });
  return paragraph.textContent();
}

test.beforeEach(async () => {
  const base = path.resolve('.cache/font-size-ui-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-'));
  project = path.join(root, 'project'); second = path.join(root, 'second'); userData = path.join(root, 'user-data');
  await mkdir(project); await mkdir(second); await mkdir(userData);
  await writeFile(path.join(project, 'README.md'), markdown);
  await writeFile(path.join(project, 'notes.md'), '# Another document\n');
  await writeFile(path.join(second, 'README.md'), '# Another project\n');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => undefined);
  if (app) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => undefined);
    await app.close().catch(() => undefined);
  }
});

test('independent pointer and keyboard controls preserve unsaved source and preview selections', async () => {
  await launch(); await sizes(13, 13);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nUnsaved selection'); await page.keyboard.press('Control+Shift+ArrowLeft');
  await expect(page.locator('#preview')).toContainText('Unsaved selection');
  const cursor = await page.locator('#cursor-status').textContent();
  const selectedTokens = await page.locator('#token-status').textContent();
  expect(selectedTokens).toContain('selected');
  await page.getByRole('button', { name: 'Increase Source font size', exact: true }).click();
  await sizes(14, 13);
  await expect(page.locator('#cursor-status')).toHaveText(cursor!);
  await expect(page.locator('#token-status')).toHaveText(selectedTokens!);
  await page.locator('#source-font-decrease').focus(); await page.keyboard.press('Enter');
  await sizes(13, 13);
  const selected = await selectParagraph();
  await page.locator('#preview-font-increase').click(); await sizes(13, 14);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await page.locator('#source-font-increase').click(); await sizes(14, 14);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await page.locator('#preview-font-decrease').focus(); await page.keyboard.press('Space');
  await sizes(14, 13);
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  await expect(page.locator('#token-status')).toHaveText(selectedTokens!);
  await page.locator('#source-font-reset').click(); await sizes(13, 13);
  await page.locator('.cm-content').focus(); await page.keyboard.insertText('replacement');
  await expect(page.locator('.cm-content')).toContainText('Unsaved replacement');
  expect(await readFile(path.join(project, 'README.md'), 'utf8')).toBe(markdown);
});

test('bounds scale mixed Markdown, retain navigation, and reset each pane independently', async () => {
  await launch();
  for (let i = 13; i < 32; i++) {
    await page.locator('#source-font-increase').click(); await page.locator('#preview-font-increase').click();
  }
  await sizes(32, 32);
  await expect(page.locator('#source-font-increase')).toBeDisabled();
  await expect(page.locator('#preview-font-increase')).toBeDisabled();
  const large = await page.locator('#preview').evaluate(element => {
    const size = (selector: string) => parseFloat(getComputedStyle(element.querySelector(selector)!).fontSize);
    return { heading: size('h1'), paragraph: size('p'), code: size('pre code'), table: size('table'), list: size('li') };
  });
  expect(large.paragraph).toBe(32); expect(large.list).toBe(32);
  expect(large.heading).toBeCloseTo(32 * 25 / 13, 2);
  expect(large.code).toBeCloseTo(32 * 11 / 13, 2); expect(large.table).toBeCloseTo(large.code, 2);
  await page.screenshot({ path: 'test-results/font-sizes-large.png' });
  await selectParagraph(); await page.locator('#show-in-source').click();
  await page.locator('#show-in-preview').click();
  await expect(page.locator('#preview p').first()).toBeInViewport();
  for (let i = 32; i > 10; i--) {
    await page.locator('#source-font-decrease').click(); await page.locator('#preview-font-decrease').click();
  }
  await sizes(10, 10);
  await expect(page.locator('#source-font-decrease')).toBeDisabled();
  await expect(page.locator('#preview-font-decrease')).toBeDisabled();
  await page.locator('#preview').evaluate(element => { element.scrollTop = 0; });
  await page.screenshot({ path: 'test-results/font-sizes-small.png' });
  await page.locator('#source-font-reset').focus(); await page.keyboard.press('Enter'); await sizes(13, 10);
  await page.locator('#preview-font-reset').focus(); await page.keyboard.press('Enter'); await sizes(13, 13);
});

test('preferences survive file/project switches, hidden Source, and normal restart', async () => {
  await launch();
  await page.locator('#source-font-increase').click(); await page.locator('#preview-font-decrease').click();
  await sizes(14, 12);
  await page.locator('[data-file="notes.md"]').click(); await sizes(14, 12);
  await page.locator('#toggle-source').click();
  await expect(page.locator('#source-panel')).toBeHidden();
  await page.locator('#preview-font-increase').click();
  await page.locator('#toggle-source').click(); await sizes(14, 13);
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, second);
  await page.locator('#open-project').click();
  await expect(page.locator('#project-heading')).toHaveAttribute('title', second); await sizes(14, 13);
  await closeNormally();
  const saved = JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8'));
  expect(saved.fontSizes).toEqual({ source: 14, preview: 13 });
  expect(saved.lastProject).toBe(second);
  await launch(); await sizes(14, 13);
});

test('invalid stored values recover independently and write failures keep session sizing usable', async () => {
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ version: 1, fontSizes: { source: 99, preview: 18 }, unrelated: 'keep' }));
  await launch(); await sizes(13, 18); await closeNormally();
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ version: 99, unrelated: 'keep' }));
  await launch(); await sizes(13, 13);
  await page.locator('#preview-font-increase').click(); await sizes(13, 14);
  await expect(page.locator('#toast')).toContainText('apply for this session but could not be saved');
  await page.locator('#source-font-increase').click(); await sizes(14, 14);
  await expect(page.locator('#preview')).toContainText('Comfortable reading');
  expect(JSON.parse(await readFile(path.join(userData, 'settings.json'), 'utf8'))).toEqual({ version: 99, unrelated: 'keep' });
});
