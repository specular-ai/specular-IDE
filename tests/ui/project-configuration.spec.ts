import { selectConfigurationTab, expectInternalKeysHidden } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failAutosave } from './autosave-fixture';
import { LEGACY_ID_CONFIGURATION, type IdConfiguration } from '../../src/core/id-configuration';

let app: ElectronApplication, page: Page, root: string, project: string;
const dialog = () => page.locator('#project-configuration-dialog');
async function launch(expectedIds = '1') {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#metric-ids')).toHaveText(expectedIds);
}
async function open() { await page.locator('#project-config-open').click(); await expect(dialog()).toBeVisible(); await selectConfigurationTab(page, 'categories'); }
async function addRef() {
  await selectConfigurationTab(page, 'categories'); await page.locator('#config-add-category').click(); const category = page.locator('.config-category').last();
  await selectConfigurationTab(page, 'categories'); await category.getByLabel('Name', { exact: true }).fill('Business requirements');
  await selectConfigurationTab(page, 'categories'); await category.getByLabel('Role (optional)', { exact: true }).selectOption('requirement');
  await selectConfigurationTab(page, 'categories'); await page.locator('.config-category').last().getByRole('button', { name: 'Add rule', exact: true }).click(); const rule = page.locator('.config-rule').last();
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Prefix', { exact: true }).fill('REF');
}
async function preview() {
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await expect(page.locator('#config-apply')).toBeEnabled();
}
async function closeApp() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
test.beforeEach(async () => {
  await mkdir('.cache/configuration-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/configuration-tests/run-'));
  project = path.join(root, 'project'); await mkdir(project);
  await writeFile(path.join(project, 'a.md'), '# REF-01 First\n\nREF-01 and REF-404.\n');
  await writeFile(path.join(project, 'b.md'), '# REQ-01 Existing\n'); await launch();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    console.log('Configuration diagnostics:', await page?.locator('#config-status').textContent(), await page?.locator('#config-error').textContent());
    await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  }
  if (app) await closeApp().catch(() => {});
});
test('create categories and rules, preview definitions and unresolved references, apply and restore after restart', async () => {
  await open(); await addRef(); await preview();
  await expect(page.locator('#config-summary')).toContainText('2 definitions · 2 references · 1 unresolved references');
  await expect(page.locator('#config-changes')).toContainText('2 new IDs · 0 removed IDs');
  await expect(page.locator('#metric-ids')).toHaveText('1');
  await page.locator('#config-filter').selectOption('issues'); await expect(page.locator('#config-results')).toContainText('No definition found for REF-404');
  await page.screenshot({ path: 'test-results/project-configuration-dark.png' });
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('2');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.at(-1)).toEqual({ key: expect.any(String), name: 'Business requirements', role: 'requirement' });
  expect(saved.rules.at(-1)).toEqual({ key: expect.any(String), category: saved.categories.at(-1).key, prefix: 'REF' });
  await closeApp();
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#metric-ids')).toHaveText('2');
  await expect(page.locator('#preview [data-id="REF-01"]')).toHaveCount(2);
});
test('cancel and Escape discard drafts; removing rules previews lost IDs; reset requires preview and Apply', async () => {
  await open(); await addRef(); await preview(); await page.keyboard.press('Escape');
  await expect(dialog()).not.toBeVisible(); await expect(page.locator('#metric-ids')).toHaveText('1');
  await expect(readFile(path.join(project, '.specular/project.json'))).rejects.toThrow();
  await open(); await expect(page.locator('.config-rule')).toHaveCount(11);
  await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Remove rule 1', exact: true }).click(); await preview();
  await expect(page.locator('#config-changes')).toContainText('1 removed IDs');
  await page.locator('#config-filter').selectOption('removed'); await expect(page.locator('#config-results')).toContainText('REQ-01');
  await page.locator('#config-reset').click(); await expect(page.locator('#config-apply')).toBeDisabled();
  await preview(); await expect(page.locator('#config-summary')).toContainText('1 definitions');
  await page.locator('#config-cancel').click(); await expect(readFile(path.join(project, '.specular/project.json'))).rejects.toThrow();
});
test('advanced patterns, invalid schemas, overlapping and slow regexes cannot be applied', async () => {
  await open(); await addRef(); const rule = page.locator('.config-rule').last();
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('pattern');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Regex pattern', { exact: true }).fill('(');
  await expect(page.locator('#config-error')).toContainText('invalid Unicode'); await expect(page.locator('#config-apply')).toBeDisabled();
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Regex pattern', { exact: true }).fill('REQ-\\d+');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-error')).toContainText('overlap'); await expect(page.locator('#config-apply')).toBeDisabled();
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Regex pattern', { exact: true }).fill('REF-\\d+'); await preview();
  await selectConfigurationTab(page, 'categories'); await page.locator('.config-category').last().getByLabel('Name', { exact: true }).fill('');
  await expect(page.locator('#config-error')).toContainText('name'); await expect(page.locator('#config-apply')).toBeDisabled();
  await selectConfigurationTab(page, 'categories'); await page.locator('.config-category').last().getByLabel('Name', { exact: true }).fill('Business requirements');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Regex pattern', { exact: true }).fill('a*'); await page.locator('#config-preview').click();
  await expect(page.locator('#config-error')).toContainText('empty');
  await page.locator('#config-cancel').click(); await writeFile(path.join(project, 'a.md'), '# REF-01\n\n' + 'a'.repeat(15000) + '!\n');
  await page.locator('#refresh').click(); await open(); await addRef();
  await selectConfigurationTab(page, 'categories'); await page.locator('.config-rule').last().getByLabel('Format', { exact: true }).selectOption('pattern');
  await selectConfigurationTab(page, 'categories'); await page.locator('.config-rule').last().getByLabel('Regex pattern', { exact: true }).fill('(a+)+$');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-error')).toContainText('was stopped', { timeout: 15000 });
  await expect(page.locator('#config-apply')).toBeDisabled(); await expect(page.locator('#metric-ids')).toHaveText('1');
});
test('source navigation retains the draft, and unsaved changes invalidate the preview without losing editor undo', async () => {
  await failAutosave(app); await open(); await addRef(); await preview();
  await page.locator('#config-results').getByRole('button', { name: /^REF-01 · definition/ }).click();
  await expect(dialog()).not.toBeVisible(); expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('REF-01');
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n# REF-02 Unsaved\n');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed');
  await open(); await expect(page.locator('.config-rule').last().getByLabel('Prefix', { exact: true })).toHaveValue('REF');
  await expect(page.locator('#config-apply')).toBeDisabled(); await preview();
  await expect(page.locator('#config-summary')).toContainText('3 definitions');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#editor .cm-content')).toContainText('REF-02 Unsaved');
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).not.toContain('REF-02');
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+z'); await expect(page.locator('#metric-ids')).toHaveText('2');
});
test('changed Markdown and external configuration are rechecked and cannot silently overwrite a draft', async () => {
  await open(); await addRef(); await preview();
  await writeFile(path.join(project, 'a.md'), '# REF-01 Changed\n\nREF-02\n');
  await expect(page.locator('#config-status')).toContainText('Markdown changed'); await expect(page.locator('#config-apply')).toBeDisabled();
  await preview(); await mkdir(path.join(project, '.specular')); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(LEGACY_ID_CONFIGURATION));
  await expect(page.locator('#config-error')).toContainText('configuration changed on disk');
  await expect(page.locator('.config-rule').last().getByLabel('Prefix', { exact: true })).toHaveValue('REF');
  await expect(page.locator('#config-apply')).toBeDisabled();
  await page.locator('#config-reload').click(); await expect(page.locator('.config-rule')).toHaveCount(11); await preview();
});
test('save failures preserve the draft for a validated retry', async () => {
  await open(); await addRef(); await preview();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let first = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (first) { first = false; return { ok: false, message: 'Simulated configuration write failure' }; }
      return original(event, ...args);
    });
  });
  await page.locator('#config-apply').click(); await expect(page.locator('#config-error')).toContainText('write failure');
  await expect(dialog()).toBeVisible(); await expect(page.locator('#metric-ids')).toHaveText('1');
  await expect(page.locator('.config-rule').last().getByLabel('Prefix', { exact: true })).toHaveValue('REF');
  await preview(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible(); await expect(page.locator('#metric-ids')).toHaveText('2');
});
test('a suspended draft cannot leak across projects or save into a different project', async () => {
  await open(); await addRef(); await preview();
  await page.locator('#config-results').getByRole('button', { name: /^REF-01 · definition/ }).click();
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-02 Other\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other'); await open();
  await expect(page.locator('.config-rule')).toHaveCount(11); await expect(page.locator('#config-apply')).toBeDisabled();
  const result = await page.evaluate(async root => window.specular.saveProjectConfiguration(root, { version: 1, categories: [], rules: [] }, 'absent', {}), project);
  expect(result.ok).toBe(false); expect(result.message).toContain('active project changed');
  await expect(readFile(path.join(other, '.specular/project.json'))).rejects.toThrow();
});
test('dialog fits a small light-mode window and supports keyboard input and cancellation', async () => {
  await page.locator('#theme-switch').click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720)); await open();
  await addRef(); await preview();
  const fits = await dialog().evaluate(element => { const bounds = element.getBoundingClientRect(); return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight; });
  expect(fits).toBe(true);
  await page.screenshot({ path: 'test-results/project-configuration-light.png' });
  await selectConfigurationTab(page, 'categories'); await page.locator('.config-rule').last().getByLabel('Prefix', { exact: true }).focus(); await page.keyboard.press('Control+a'); await page.keyboard.type('NEED');
  await expect(page.locator('#config-apply')).toBeDisabled(); await page.keyboard.press('Escape'); await expect(dialog()).not.toBeVisible();
});
test('an unusable existing regex can be repaired without executing it again for comparison', async () => {
  await mkdir(path.join(project, '.specular'));
  await writeFile(path.join(project, 'a.md'), '# REF-01\n\n' + 'a'.repeat(15000) + '!\n');
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify({ version: 1, categories: [{ key: 'requirements', name: 'Requirements' }], rules: [{ key: 'broken', category: 'requirements', pattern: '(a+)+$' }] }));
  await page.locator('#refresh').click(); await expect(page.locator('#warnings')).toContainText('was stopped', { timeout: 15000 });
  await open(); await selectConfigurationTab(page, 'categories'); await page.locator('.config-rule').getByLabel('Regex pattern', { exact: true }).fill('REF-\\d+');
  await preview(); await expect(page.locator('#config-changes')).toContainText('counts are unavailable');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('1'); await expect(page.locator('#warnings')).toBeHidden();
});

test('internal category keys stay stable across renames and simple formats prefill editable regexes', async () => {
  await open(); await selectConfigurationTab(page, 'categories'); await page.locator('#config-add-category').click();
  const category = page.locator('.config-category').last();
  await expect(category.getByLabel('Category key', { exact: true })).toHaveCount(0);
  await selectConfigurationTab(page, 'categories'); await category.getByLabel('Name', { exact: true }).fill('Business requirements');
  await selectConfigurationTab(page, 'categories'); await page.locator('.config-category').last().getByRole('button', { name: 'Add rule', exact: true }).click(); const rule = page.locator('.config-rule').last();
  await expect(rule.getByLabel('Category', { exact: true })).toHaveCount(0);
  await selectConfigurationTab(page, 'categories'); await category.getByLabel('Name', { exact: true }).fill('Renamed draft');
  await expect(category.locator('.config-rule')).toHaveCount(1);
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('pattern');
  await expect(rule.getByLabel('Regex pattern', { exact: true })).toHaveValue('\\bID-\\d+\\b');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('prefix');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Prefix', { exact: true }).fill('REF');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Separator', { exact: true }).selectOption('_');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('pattern');
  await expect(rule.getByLabel('Regex pattern', { exact: true })).toHaveValue('\\bREF_\\d+\\b');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Regex pattern', { exact: true }).fill('\\bREF[-_]?\\d+\\b');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('prefix');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('pattern');
  await expect(rule.getByLabel('Regex pattern', { exact: true })).toHaveValue('\\bREF[-_]?\\d+\\b');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('prefix');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Separator', { exact: true }).selectOption('');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('pattern');
  await expect(rule.getByLabel('Regex pattern', { exact: true })).toHaveValue('\\bREF\\d+\\b');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('prefix');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Separator', { exact: true }).selectOption('-');
  await preview(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  const categoryKey = (JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'))).categories.at(-1).key;
  await open(); await selectConfigurationTab(page, 'categories'); await category.getByLabel('Name', { exact: true }).fill('Product requirements');
  await expect(category.locator('.config-rule')).toHaveCount(1);
  await preview(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.at(-1)).toEqual({ key: categoryKey, name: 'Product requirements' });
  expect(saved.rules.at(-1)).toMatchObject({ category: categoryKey, prefix: 'REF', separator: '-' });
});

test('existing keys stay hidden in controls, errors and previews; duplicate names keep their own rules', async () => {
  const config = { version: 1, categories: [{ key: 'privateCategory', name: 'Same name' }, { key: 'privateOther', name: 'Same name' }], rules: [{ key: 'privateRule', category: 'privateOther', prefix: 'REF' }] };
  await mkdir(path.join(project, '.specular')); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config));
  await page.locator('#refresh').click(); await expect(page.locator('#metric-ids')).toHaveText('1'); await open();
  const keys = ['privateCategory', 'privateOther', 'privateRule'];
  await expectInternalKeysHidden(page, keys);
  const rule = page.locator('.config-rule').first();
  await expect(page.locator('.config-category').nth(0).locator('.config-rule')).toHaveCount(0);
  await expect(page.locator('.config-category').nth(1).locator('.config-rule')).toHaveCount(1);
  await expect(rule.getByLabel('Category', { exact: true })).toHaveCount(0);
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('pattern'); await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Regex pattern', { exact: true }).fill('(');
  await expect(page.locator('#config-error')).toContainText('Rule 1 has an invalid'); await expectInternalKeysHidden(page, keys);
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Regex pattern', { exact: true }).fill('REF-\\d+');
  await selectConfigurationTab(page, 'categories'); await page.locator('#config-add-category').click(); await selectConfigurationTab(page, 'categories'); await page.locator('.config-category').last().getByLabel('Name', { exact: true }).fill('Same name');
  await selectConfigurationTab(page, 'categories'); await page.locator('#config-add-category').click(); await selectConfigurationTab(page, 'categories'); await page.locator('.config-category').last().getByLabel('Name', { exact: true }).fill('Same name');
  await preview(); await expectInternalKeysHidden(page, keys); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.slice(0, 2)).toEqual(config.categories); expect(new Set(saved.categories.map((c: any) => c.key)).size).toBe(4);
  expect(saved.rules[0]).toMatchObject({ key: 'privateRule', category: 'privateOther' });
  await open(); await expectInternalKeysHidden(page, keys);
  await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Remove category 2', exact: true }).click();
  await expect(page.locator('.config-rule')).toHaveCount(0);
  await expect(page.locator('#config-error')).toBeHidden();
  await expectInternalKeysHidden(page, keys); await page.locator('#config-cancel').click();
});

test('category-owned rules preserve interleaved storage, add multiple formats, remove only the chosen rule, and survive restart', async () => {
  const configuration = {
    version: 1, categories: [{ key: 'first', name: 'Shared name' }, { key: 'second', name: 'Shared name' }],
    rules: [{ key: 'other', category: 'second', prefix: 'REQ' }, { key: 'ref', category: 'first', prefix: 'REF' }, { key: 'feature', category: 'first', pattern: 'feature/[a-z]+' }],
    modules: [{ key: 'gui', name: 'GUI' }], statuses: [],
  };
  await mkdir(path.join(project, '.specular')); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration));
  await writeFile(path.join(project, 'a.md'), '# REF-01 First\n\n# NEED-1 New need\n\n# ALT-1 Alternative\n');
  await page.locator('#refresh').click(); await expect(page.locator('#metric-ids')).toHaveText('2'); await open();
  const first = page.locator('.config-category').nth(0), second = page.locator('.config-category').nth(1);
  await expect(dialog().getByRole('tab')).toHaveCount(7);
  await expect(page.getByRole('tab', { name: 'ID recognition rules', exact: true })).toHaveCount(0);
  await expect(first.locator('.config-rule')).toHaveCount(2); await expect(second.locator('.config-rule')).toHaveCount(1);
  await expect(first.getByLabel('Prefix', { exact: true })).toHaveValue('REF');
  await expect(second.getByLabel('Prefix', { exact: true })).toHaveValue('REQ');
  await expect(page.locator('.config-rule').getByLabel('Category', { exact: true })).toHaveCount(0);
  await first.getByLabel('Name', { exact: true }).fill('Product requirements');
  await first.getByRole('button', { name: 'Add rule', exact: true }).click();
  await expect(first.locator('.config-rule').last().getByLabel('Prefix', { exact: true })).toBeFocused();
  await first.locator('.config-rule').last().getByLabel('Prefix', { exact: true }).fill('NEED');
  await first.locator('.config-rule').last().getByLabel('Format', { exact: true }).selectOption('pattern');
  await expect(first.locator('.config-rule').last().getByLabel('Format', { exact: true })).toBeFocused();
  await first.locator('.config-rule').last().getByLabel('Regex pattern', { exact: true }).fill('NEED-\\d+');
  await first.getByRole('button', { name: 'Add rule', exact: true }).click();
  await first.locator('.config-rule').last().getByLabel('Prefix', { exact: true }).fill('ALT');
  await selectConfigurationTab(page, 'discovery'); await selectConfigurationTab(page, 'categories');
  await expect(first.locator('.config-rule')).toHaveCount(4); await expect(second.locator('.config-rule')).toHaveCount(1);
  await first.getByRole('button', { name: 'Remove rule 2', exact: true }).click();
  await expect(first.getByRole('button', { name: 'Add rule', exact: true })).toBeFocused();
  await expect(first.locator('.config-rule')).toHaveCount(3); await expect(second.getByLabel('Prefix', { exact: true })).toHaveValue('REQ');
  await preview(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  const saved = await savedConfiguration();
  expect(saved.rules.slice(0, 2)).toEqual([configuration.rules[0], configuration.rules[2]]);
  expect(saved.rules.slice(2)).toEqual([
    { key: expect.any(String), category: 'first', pattern: 'NEED-\\d+' },
    { key: expect.any(String), category: 'first', prefix: 'ALT' },
  ]);
  expect(saved.modules).toEqual(configuration.modules); expect(saved.statuses).toEqual([]);
  expect(saved.categories).toEqual([{ key: 'first', name: 'Product requirements' }, configuration.categories[1]]);
  await closeApp(); await launch('3'); await open();
  const restoredFirst = page.locator('.config-category').nth(0), restoredSecond = page.locator('.config-category').nth(1);
  await expect(restoredFirst.locator('.config-rule')).toHaveCount(3); await expect(restoredSecond.locator('.config-rule')).toHaveCount(1);
  await restoredFirst.getByRole('button', { name: 'Remove rule 2', exact: true }).click(); await page.locator('#config-cancel').click();
  expect(await savedConfiguration()).toEqual(saved);
});

test('category Add rule controls share the project limit and nested editors fit both themes with keyboard focus', async () => {
  const configuration = {
    version: 1, categories: [{ key: 'one', name: 'Many rules' }, { key: 'two', name: 'Empty category' }],
    rules: Array.from({ length: 64 }, (_, i) => ({ key: `r${i}`, category: 'one', prefix: `R${String.fromCharCode(65 + i % 26)}${String.fromCharCode(65 + Math.floor(i / 26))}` })),
  };
  await mkdir(path.join(project, '.specular')); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration));
  await page.locator('#refresh').click(); await expect(page.locator('#metric-ids')).toHaveText('0');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Categories', exact: true }).click();
    const firstEntry = page.locator('#config-categories > .config-entry').first();
    await firstEntry.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
    await firstEntry.locator('.config-category-rules > summary').click();
    const firstRule = firstEntry.locator('.config-category-rule-list > .config-entry').first();
    await firstRule.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
    await expect(page.locator('.config-add-rule').first()).toBeDisabled(); await expect(page.locator('.config-add-rule').last()).toBeDisabled();
    await firstRule.getByRole('button', { name: 'Remove rule 1', exact: true }).click();
    await expect(page.locator('.config-add-rule').first()).toBeFocused(); await expect(page.locator('.config-add-rule').last()).toBeEnabled();
    const secondEntry = page.locator('#config-categories > .config-entry').last();
    await secondEntry.locator(':scope > summary').click(); await secondEntry.locator('.config-category-rules > summary').click(); await expect(secondEntry.locator('.config-category-rules-empty')).toBeVisible();
    await secondEntry.getByRole('button', { name: 'Add rule', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(secondEntry.getByLabel('Prefix', { exact: true })).toBeFocused(); await secondEntry.getByLabel('Prefix', { exact: true }).fill('REF');
    await expect(secondEntry.locator('.config-category-rules-empty')).toBeHidden();
    await expect(page.locator('.config-add-rule').first()).toBeDisabled(); await expect(page.locator('.config-add-rule').last()).toBeDisabled();
    expect(await dialog().evaluate(element => { const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && element.scrollWidth <= element.clientWidth; })).toBe(true);
    await page.screenshot({ path: `test-results/category-rules-${theme}.png` });
    await page.locator('#config-cancel').click(); expect(await savedConfiguration()).toEqual(configuration);
  }
});

const deletionConfiguration: IdConfiguration = {
  version: 1,
  categories: [{ key: 'needs', name: 'Shared name', role: 'requirement' }, { key: 'retained', name: 'Shared name' }, { key: 'unused', name: 'No rules' }],
  rules: [{ key: 'prefix', category: 'needs', prefix: 'REF' }, { key: 'named', category: 'needs', pattern: 'feature/[a-z]+' }, { key: 'needs', category: 'retained', prefix: 'REQ' }],
  modules: [{ key: 'gui', name: 'GUI' }], moduleRules: [{ key: 'files', path: '.', scope: 'folder', modules: ['gui'] }],
  moduleOverrides: [
    { id: 'REF-01', modules: ['gui'] }, { id: 'REF-999', modules: [] },
    { id: 'feature/login', modules: ['gui'] }, { id: 'feature/signup', modules: ['gui'] },
    { id: 'REQ-01', modules: ['gui'] }, { id: 'FUTURE-1', modules: ['gui'] },
  ],
  statuses: [{ name: 'Confirmed', rules: [{ mode: 'exact', value: 'Confirmed' }], colors: { dark: '#abcdef' } }],
};
const deletionSource = '# REF-01 First\n\nREF-01 and REF-404.\n\n# feature/login Named\n';
async function prepareCategoryDeletion() {
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, 'a.md'), deletionSource);
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(deletionConfiguration));
  await page.locator('#refresh').click(); await expect(page.locator('#metric-ids')).toHaveText('3'); await open();
}
async function removeFirstCategory() {
  await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Remove category 1', exact: true }).click();
  await expect(page.locator('.config-category')).toHaveCount(2);
  await expect(page.locator('.config-rule')).toHaveCount(1);
  await expect(page.locator('.module-id-override')).toHaveCount(2);
  await expect(page.locator('.config-rule').getByLabel('Prefix', { exact: true })).toHaveValue('REQ');
  await expect(page.locator('#config-error')).toBeHidden(); await expect(page.locator('#config-apply')).toBeDisabled();
}
async function savedConfiguration() { return JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')); }
const deletedConfiguration = () => ({ ...deletionConfiguration, categories: deletionConfiguration.categories.slice(1), rules: deletionConfiguration.rules.slice(2), moduleOverrides: deletionConfiguration.moduleOverrides!.slice(4) });
const emptyDeletionConfiguration = () => ({ ...deletionConfiguration, categories: [], rules: [], moduleOverrides: deletionConfiguration.moduleOverrides!.slice(5) });

test('override cleanup uses edited draft rules and refuses invalid recognition without partial deletion', async () => {
  await prepareCategoryDeletion();
  const namedRule = page.locator('.config-rule').nth(1).getByLabel('Regex pattern', { exact: true });
  await selectConfigurationTab(page, 'categories'); await namedRule.fill('(');
  await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Remove category 1', exact: true }).click();
  await expect(page.locator('#config-status')).toContainText('Nothing was deleted');
  await expect(page.locator('.config-category')).toHaveCount(3); await expect(page.locator('.config-rule')).toHaveCount(3);
  await expect(page.locator('.module-id-override')).toHaveCount(6);
  await selectConfigurationTab(page, 'categories'); await namedRule.fill('feature/[a-z]+');
  await selectConfigurationTab(page, 'categories'); await page.locator('.config-rule').first().getByLabel('Prefix', { exact: true }).fill('FUTURE');
  await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Remove category 1', exact: true }).click();
  await expect(page.locator('.config-category')).toHaveCount(2); await expect(page.locator('.module-id-override')).toHaveCount(3);
  await preview(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  expect((await savedConfiguration()).moduleOverrides.map((override: { id: string }) => override.id)).toEqual(['REF-01', 'REF-999', 'REQ-01']);
});

test('slow override recognition can be cancelled and times out without deleting any draft entries', async () => {
  await prepareCategoryDeletion(); await page.locator('#config-cancel').click();
  const configuration = { ...deletionConfiguration, moduleOverrides: [{ id: 'a'.repeat(40) + '!', modules: ['gui'] }] };
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration));
  await page.locator('#refresh').click(); await open();
  const startRemoval = async () => {
    await selectConfigurationTab(page, 'categories'); await page.locator('.config-rule').nth(1).getByLabel('Regex pattern', { exact: true }).fill('(a+)+$');
    await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Delete all categories', exact: true }).click();
    await expect(page.locator('#config-status')).toContainText('Checking exact-ID overrides');
    await expect(page.locator('#config-preview')).toBeDisabled();
  };
  await startRemoval(); await page.locator('#config-cancel').click(); await expect(dialog()).not.toBeVisible();
  expect(await savedConfiguration()).toEqual(configuration);
  await open(); await startRemoval();
  await expect(page.locator('#config-error')).toContainText('was stopped', { timeout: 10000 });
  await expect(page.locator('#config-status')).toContainText('Nothing was deleted');
  await expect(page.locator('.config-category')).toHaveCount(3); await expect(page.locator('.config-rule')).toHaveCount(3);
  await expect(page.locator('.module-id-override')).toHaveCount(1); await expect(page.locator('#config-delete-categories')).toBeEnabled();
  await page.locator('#config-cancel').click(); expect(await savedConfiguration()).toEqual(configuration);
});

test('category deletion removes all associated rules in one draft change, supports Cancel, and persists only on Apply', async () => {
  await prepareCategoryDeletion(); await preview(); await removeFirstCategory();
  await expect(page.locator('#config-results')).toBeEmpty(); await expect(page.locator('#metric-ids')).toHaveText('3');
  await preview(); await expect(page.locator('#config-changes')).toContainText('3 removed IDs');
  await page.locator('#config-filter').selectOption('removed');
  for (const id of ['REF-01', 'REF-404', 'feature/login']) await expect(page.locator('#config-results')).toContainText(id);
  await page.locator('#config-cancel').click(); expect(await savedConfiguration()).toEqual(deletionConfiguration);
  await expect(page.locator('#metric-ids')).toHaveText('3');
  await open(); await expect(page.locator('.config-rule')).toHaveCount(3); await removeFirstCategory(); await preview();
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible(); await expect(page.locator('#metric-ids')).toHaveText('1');
  expect(await savedConfiguration()).toEqual(deletedConfiguration());
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(deletionSource);
  expect(await readFile(path.join(project, 'b.md'), 'utf8')).toBe('# REQ-01 Existing\n');
  await closeApp(); await launch(); await open(); await expect(page.locator('.config-category')).toHaveCount(2); await expect(page.locator('.config-rule')).toHaveCount(1);
});

test('deleting categories without rules and the last category preserves an explicitly empty configuration after restart', async () => {
  await prepareCategoryDeletion(); await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Remove category 3', exact: true }).click();
  await expect(page.locator('.config-rule')).toHaveCount(3); await preview(); await expect(page.locator('#config-changes')).toContainText('0 removed IDs');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  expect(await savedConfiguration()).toEqual({ ...deletionConfiguration, categories: deletionConfiguration.categories.slice(0, 2) });
  await open(); await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Remove category 1', exact: true }).click();
  await expect(page.locator('.config-rule')).toHaveCount(1);
  await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Remove category 1', exact: true }).click();
  await expect(page.locator('.config-category')).toHaveCount(0); await expect(page.locator('.config-rule')).toHaveCount(0);
  await preview(); await expect(page.locator('#config-summary')).toContainText('0 definitions');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible(); await expect(page.locator('#metric-ids')).toHaveText('0');
  expect(await savedConfiguration()).toEqual(emptyDeletionConfiguration());
  await closeApp(); await launch('0'); await open(); await expect(page.locator('.config-category')).toHaveCount(0); await expect(page.locator('.config-rule')).toHaveCount(0);
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(deletionSource);
});

test('failed category-deletion saves preserve the draft and active rules for a validated retry', async () => {
  await prepareCategoryDeletion(); await removeFirstCategory(); await preview();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let first = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (first) { first = false; return { ok: false, message: 'Simulated configuration write failure' }; }
      return original(event, ...args);
    });
  });
  await page.locator('#config-apply').click(); await expect(page.locator('#config-error')).toContainText('write failure');
  await expect(page.locator('.config-category')).toHaveCount(2); await expect(page.locator('.config-rule')).toHaveCount(1);
  await expect(page.locator('#metric-ids')).toHaveText('3'); expect(await savedConfiguration()).toEqual(deletionConfiguration);
  await preview(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('1'); expect(await savedConfiguration()).toEqual(deletedConfiguration());
});

test('external configuration conflicts keep category deletion in the draft without applying it', async () => {
  await prepareCategoryDeletion(); await removeFirstCategory(); await preview();
  const external = { ...deletionConfiguration, modules: [{ key: 'gui', name: 'Renamed externally' }] };
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(external));
  await expect(page.locator('#config-error')).toContainText('configuration changed on disk'); await expect(page.locator('#config-apply')).toBeDisabled();
  await expect(page.locator('.config-category')).toHaveCount(2); await expect(page.locator('.config-rule')).toHaveCount(1);
  await expect(page.locator('#metric-ids')).toHaveText('3'); expect(await savedConfiguration()).toEqual(external);
  await page.locator('#config-reload').click(); await expect(page.locator('.config-category')).toHaveCount(3); await expect(page.locator('.config-rule')).toHaveCount(3);
  await page.locator('#config-cancel').click(); expect(await savedConfiguration()).toEqual(external);
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(deletionSource);
});

async function expectEmptyCategories() {
  await selectConfigurationTab(page, 'categories');
  await expect(page.locator('.config-category')).toHaveCount(0); await expect(page.locator('.config-rule')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete all categories', exact: true })).toBeDisabled();
  await selectConfigurationTab(page, 'categories'); await expect(page.locator('#config-categories-empty')).toBeVisible();
  await selectConfigurationTab(page, 'categories');
  await expect(page.locator('#config-add-category')).toBeEnabled(); await expect(page.locator('.config-add-rule')).toHaveCount(0);
}
async function deleteAllCategories() { await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Delete all categories', exact: true }).click(); await expectEmptyCategories(); }

test('bulk category deletion supports Cancel, keyboard activation, empty restart and adding new conventions', async () => {
  await prepareCategoryDeletion(); await preview(); await deleteAllCategories();
  await expect(page.locator('#config-apply')).toBeDisabled(); await expect(page.locator('#config-results')).toBeEmpty();
  await expect(page.locator('#metric-ids')).toHaveText('3'); expect(await savedConfiguration()).toEqual(deletionConfiguration);
  await page.locator('#config-cancel').click(); await open();
  await expect(page.locator('.config-category')).toHaveCount(3); await expect(page.locator('.config-rule')).toHaveCount(3);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  await selectConfigurationTab(page, 'categories'); await page.getByRole('button', { name: 'Delete all categories', exact: true }).focus(); await page.keyboard.press('Enter'); await expectEmptyCategories();
  await page.locator('#config-categories-empty').scrollIntoViewIfNeeded();
  expect(await dialog().evaluate(e => e.getBoundingClientRect().right <= innerWidth && e.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await page.screenshot({ path: 'test-results/configuration-empty-categories.png' });
  await preview(); await expect(page.locator('#config-changes')).toContainText('4 removed IDs');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible(); await expect(page.locator('#metric-ids')).toHaveText('0');
  expect(await savedConfiguration()).toEqual(emptyDeletionConfiguration());
  await closeApp(); await launch('0'); await open(); await expectEmptyCategories();
  await selectConfigurationTab(page, 'categories'); await page.locator('#config-add-category').click(); await selectConfigurationTab(page, 'categories'); await page.locator('.config-category').getByLabel('Name', { exact: true }).fill('New requirements');
  await expect(page.locator('#config-categories-empty')).toBeHidden(); await expect(page.locator('.config-category').last().getByRole('button', { name: 'Add rule', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Delete all categories', exact: true })).toBeEnabled();
  await selectConfigurationTab(page, 'categories'); await page.locator('.config-category').last().getByRole('button', { name: 'Add rule', exact: true }).click(); await selectConfigurationTab(page, 'categories'); await page.locator('.config-rule').getByLabel('Prefix', { exact: true }).fill('REF');
  await expect(page.locator('.config-category-rules-empty')).toBeHidden(); await preview();
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible(); await expect(page.locator('#metric-ids')).toHaveText('1');
  const saved = await savedConfiguration(); expect(saved.categories).toHaveLength(1); expect(saved.rules).toHaveLength(1);
  expect(saved.rules[0]).toMatchObject({ category: saved.categories[0].key, prefix: 'REF' });
  expect({ ...saved, categories: [], rules: [] }).toEqual(emptyDeletionConfiguration());
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(deletionSource);
});

test('bulk deletion preserves the empty draft and active configuration after a failed save and can retry', async () => {
  await prepareCategoryDeletion(); await deleteAllCategories(); await preview();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let first = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (first) { first = false; return { ok: false, message: 'Simulated bulk deletion write failure' }; }
      return original(event, ...args);
    });
  });
  await page.locator('#config-apply').click(); await expect(page.locator('#config-error')).toContainText('write failure');
  await expectEmptyCategories(); await expect(page.locator('#metric-ids')).toHaveText('3'); expect(await savedConfiguration()).toEqual(deletionConfiguration);
  await preview(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('0'); expect(await savedConfiguration()).toEqual(emptyDeletionConfiguration());
});

test('external conflicts block bulk deletion without losing the empty draft or overwriting configuration', async () => {
  await prepareCategoryDeletion(); await deleteAllCategories(); await preview();
  const external = { ...deletionConfiguration, modules: [{ key: 'gui', name: 'External module' }] };
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(external));
  await expect(page.locator('#config-error')).toContainText('configuration changed on disk'); await expect(page.locator('#config-apply')).toBeDisabled();
  await expectEmptyCategories(); await expect(page.locator('#metric-ids')).toHaveText('3'); expect(await savedConfiguration()).toEqual(external);
  await page.locator('#config-cancel').click(); await open(); await expect(page.locator('.config-category')).toHaveCount(3); await expect(page.locator('.config-rule')).toHaveCount(3);
  expect(await savedConfiguration()).toEqual(external);
});

test('bulk deletion leaves unsaved Markdown and editor undo intact', async () => {
  await prepareCategoryDeletion(); await page.locator('#config-cancel').click(); await failAutosave(app);
  await expect(page.locator('#document-path')).toHaveText('a.md');
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\n# REF-02 Unsaved\n');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed'); await expect(page.locator('#metric-ids')).toHaveText('4');
  await open(); await deleteAllCategories(); await preview(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#editor .cm-content')).toContainText('REF-02 Unsaved'); await expect(page.locator('#metric-ids')).toHaveText('0');
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(deletionSource);
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+z'); await expect(page.locator('#editor .cm-content')).not.toContainText('REF-02');
  expect(await savedConfiguration()).toEqual(emptyDeletionConfiguration());
});
