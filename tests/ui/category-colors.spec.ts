import { expandConfigurationEntries } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
let app: ElectronApplication, page: Page, root: string, project: string;
const initial = { version: 1, categories: [{ key: 'needs', name: 'Business needs', role: 'requirement' }, { key: 'design', name: 'Design', role: 'design' }], rules: [{ key: 'ref', category: 'needs', prefix: 'REF' }, { key: 'dec', category: 'design', prefix: 'DEC' }] };
const category = () => page.locator('.config-category').first();
const card = () => page.locator('#lens-results .lens-card[data-id="REF-01"]').first();
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(card()).toBeVisible();
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); }
async function open() { await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Categories', exact: true }).click(); await expandConfigurationEntries(page); await category().locator('summary').filter({ hasText: /^Card colors$/ }).click(); }
async function apply() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); }
const accent = () => card().evaluate(element => getComputedStyle(element).borderLeftColor);
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/colors-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(initial));
  await writeFile(path.join(project, 'a.md'), '# REF-01 First\nDEC-1 REF-404\n'); await writeFile(path.join(project, 'b.md'), '# DEC-1 Design\nREF-01\n'); await launch();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); if (app) await close().catch(() => {}); });
test('preview chosen colors, apply, switch themes, navigate Relationships and restore after restart', async () => {
  const before = await accent(); await open();
  await category().getByLabel('Dark mode hex', { exact: true }).fill('#ffcc00');
  const darkPreview = category().locator('[data-color-mode="dark"]');
  await expect(darkPreview).toHaveCSS('border-left-color', 'rgb(255, 204, 0)'); expect(await accent()).toBe(before);
  await category().getByLabel('Light mode color', { exact: true }).fill('#ffee00');
  await expect(category().getByLabel('Light mode hex', { exact: true })).toHaveValue('#ffee00');
  await expect(category().locator('[data-color-mode="light"]')).toHaveCSS('border-left-color', 'rgb(255, 238, 0)');
  await darkPreview.scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/category-colors-editor.png' });
  const previewBackground = await darkPreview.evaluate(element => getComputedStyle(element).backgroundColor);
  await apply(); await expect(card()).toHaveCSS('border-left-color', 'rgb(255, 204, 0)'); await expect(card()).toHaveCSS('background-color', previewBackground);
  await expect(card().locator('.lens-category')).toHaveText('Business needs');
  await card().locator('.lens-row').focus(); await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab'); await expect(card().locator('.lens-row')).toHaveCSS('outline-style', 'solid');
  await page.screenshot({ path: 'test-results/category-colors-dark.png' });
  await page.locator('#theme-switch').click(); await expect(card()).toHaveCSS('border-left-color', 'rgb(255, 238, 0)');
  await page.screenshot({ path: 'test-results/category-colors-light.png' });
  await page.getByRole('button', { name: 'Explore map for REF-01', exact: true }).click(); const frame = await pluginFrame(app);
  await expect(frame.locator('.map-node[data-id="DEC-1"]')).toBeVisible();
  await frame.getByRole('button', { name: 'Open REF-01 definition', exact: true }).click(); await expect(page.locator('#document-path')).toHaveText('a.md');
  await close(); await launch(); await expect(card()).toHaveCSS('border-left-color', 'rgb(255, 238, 0)');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')); expect(saved.categories[0].colors).toEqual({ dark: '#ffcc00', light: '#ffee00' });
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe('# REF-01 First\nDEC-1 REF-404\n');
});
test('invalid input blocks Apply, cancellation preserves saved colors, and reset removes overrides', async () => {
  const before = await accent(); await open();
  await category().getByLabel('Role (optional)', { exact: true }).selectOption('task');
  await expect(category().getByLabel('Dark mode hex', { exact: true })).toHaveValue('#8eb9ed');
  await expect(category().getByLabel('Dark mode color', { exact: true })).toHaveValue('#8eb9ed');
  await category().getByLabel('Role (optional)', { exact: true }).selectOption('requirement');
  await category().getByLabel('Dark mode hex', { exact: true }).fill('#bad');
  await expect(page.locator('#config-error')).toContainText('six-digit hex'); await expect(page.locator('#config-apply')).toBeDisabled();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-apply')).toBeDisabled();
  await category().getByLabel('Dark mode hex', { exact: true }).fill('#000000'); await page.keyboard.press('Escape'); expect(await accent()).toBe(before);
  expect(JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'))).toEqual(initial);
  await open(); await category().getByLabel('Dark mode hex', { exact: true }).fill('#000000'); await category().getByLabel('Light mode hex', { exact: true }).fill('#ffffff'); await apply();
  await expect(card()).toHaveCSS('border-left-color', 'rgb(0, 0, 0)');
  await open(); await category().getByRole('button', { name: 'Reset dark color', exact: true }).click(); await category().getByRole('button', { name: 'Reset light color', exact: true }).click(); await apply();
  await expect.poll(accent).toBe(before); expect(JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')).categories[0].colors).toBeUndefined();
});
test('colors stay project-specific and diagnostics retain separate labels at minimum window size', async () => {
  await open(); await category().getByLabel('Dark mode hex', { exact: true }).fill('#ffcc00'); await apply();
  await writeFile(path.join(project, 'b.md'), '# DEC-1 Design\nREF-01\n# REF-01 Duplicate\n'); await page.locator('#refresh').click();
  await expect(page.locator('#metric-ids')).toHaveText('3'); await page.locator('#pending-tab').click();
  await expect(page.locator('#lens-results')).toContainText('Duplicate ID'); await expect(page.locator('#lens-results')).toContainText('Unresolved ID');
  await expect(page.locator('#lens-results .category-card')).toHaveCount(0); await page.locator('#index-tab').click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720)); await page.locator('#theme-switch').click(); await open();
  await category().getByLabel('Light mode hex', { exact: true }).focus(); await page.keyboard.press('Control+a'); await page.keyboard.type('#ffffff');
  await expect(category().locator('[data-color-mode="light"]')).toHaveCSS('border-left-color', 'rgb(255, 255, 255)');
  const fits = await page.locator('#project-configuration-dialog').evaluate(element => { const rect = element.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight; }); expect(fits).toBe(true);
  await category().locator('[data-color-mode="light"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/category-colors-minimum.png' }); await page.keyboard.press('Escape');
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-01 Another project\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other); await page.locator('#open-project').click();
  await expect(page.locator('#project-heading')).toHaveText('other'); await expect(page.locator('.lens-card[data-id="REQ-01"]')).not.toHaveCSS('border-left-color', 'rgb(255, 204, 0)');
});
