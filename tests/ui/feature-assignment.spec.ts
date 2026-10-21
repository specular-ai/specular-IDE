import { failAutosave } from './autosave-fixture';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
let app: ElectronApplication, page: Page, root: string, project: string;
const initial = { version: 1, categories: [{ key: 'needs', name: 'Requirements', role: 'requirement', colors: { dark: '#ffcc00' } }, { key: 'work', name: 'Tasks', role: 'task' }, { key: 'design', name: 'Design', role: 'design' }], rules: [{ key: 'ref', category: 'needs', prefix: 'REF' }, { key: 'work', category: 'work', prefix: 'WORK' }, { key: 'dec', category: 'design', prefix: 'DEC' }] };
const features = [{ key: 'gui', name: 'GUI' }, { key: 'backend', name: 'Backend' }];
const configured = { ...initial, features, featureRules: [{ key: 'gui-files', scope: 'folder', path: 'gui', features: ['gui'] }, { key: 'backend-files', scope: 'folder', path: 'backend', features: ['backend'] }] };
const card = (id: string) => page.locator(`.lens-card[data-id="${id}"]`).first();
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow(); await expect(page.locator('#metric-ids')).toHaveText('4');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); }
async function setConfig(value: unknown) { if (JSON.stringify(await savedConfiguration()) === JSON.stringify(value)) return; await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(value)); await page.locator('#refresh').click(); }
test.beforeEach(async ({}, info) => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/features-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await mkdir(path.join(project, 'gui')); await mkdir(path.join(project, 'backend'));
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(info.title.includes('empty-feature setup') ? initial : configured));
  await writeFile(path.join(project, 'gui/a.md'), '# REF-1 Need\nDEC-1\n# WORK-1 Task\nDEC-1\n'); await writeFile(path.join(project, 'backend/design.md'), '# DEC-1 Design\nREF-1 WORK-1\n'); await writeFile(path.join(project, 'notes.md'), '# REF-2 Plain\n'); await launch();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); if (app) await close().catch(() => {}); });
const assignmentDialog = () => page.locator('#feature-assignment-dialog');
async function editFeatures(id = 'REF-1') {
  // A fixture write can trigger a watcher refresh after the first card appears.
  // The UI asks users to reopen in that case; retry opening against the fresh card.
  await expect(async () => {
    if (!await assignmentDialog().isVisible()) await card(id).getByRole('button', { name: `Edit features for ${id}`, exact: true }).click();
    await expect(assignmentDialog()).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 10_000 });
}
async function saveFeatures() {
  await page.locator('#feature-assignment-apply').click(); await expect(assignmentDialog()).not.toBeVisible();
}
async function savedConfiguration() { return JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')); }

test('card editing resolves duplicate membership conflicts explicitly and reset restores their evidence', async () => {
  await setConfig(configured); await writeFile(path.join(project, 'backend/duplicate.md'), '# REF-1 Duplicate\n'); await page.locator('#refresh').click();
  await expect(card('REF-1').locator('.feature-badge')).toHaveText('Feature conflict'); await editFeatures();
  await expect(page.locator('#feature-assignment-evidence')).toContainText('backend/duplicate.md');
  await expect(page.locator('#feature-assignment-evidence')).toContainText('gui/a.md');
  await expect(page.locator('#feature-assignment-apply')).toBeDisabled();
  await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check(); await saveFeatures();
  await expect(page.locator('.lens-card[data-id="REF-1"] .feature-badge')).toHaveText(['Backend', 'Backend']);
  await page.locator('#pending-tab').click(); await expect(page.locator('#lens-results')).toContainText('Duplicate ID');
  await expect(page.locator('#lens-results')).not.toContainText('Feature conflict'); await page.locator('#index-tab').click();
  await editFeatures(); await page.locator('#feature-assignment-inherit').click(); await saveFeatures();
  await expect(page.locator('.lens-card[data-id="REF-1"] .feature-badge')).toHaveText(['Feature conflict', 'Feature conflict']);
});

test('card editor preserves selections on failed saves and recovers from external conflicts', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.feature-badge')).toHaveText('GUI'); await editFeatures();
  await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let first = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (first) { first = false; return { ok: false, message: 'Simulated feature write failure' }; }
      return original(event, ...args);
    });
  });
  await page.locator('#feature-assignment-apply').click(); await expect(page.locator('#feature-assignment-error')).toContainText('write failure');
  await expect(assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true })).toBeChecked();
  expect(await savedConfiguration()).toEqual(configured); await expect(card('REF-1').locator('.feature-badge')).toHaveText('GUI'); await saveFeatures();
  await expect(card('REF-1').locator('.feature-badge')).toHaveText(['Backend', 'GUI']); await editFeatures();
  const external = { ...configured, features: [{ key: 'gui', name: 'New GUI' }, features[1]] };
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(external));
  await expect(page.locator('#feature-assignment-error')).toContainText('configuration changed'); await expect(page.locator('#feature-assignment-apply')).toBeDisabled();
  expect(await savedConfiguration()).toEqual(external); await page.locator('#feature-assignment-reload').click();
  await expect(assignmentDialog().getByRole('checkbox', { name: '1. New GUI', exact: true })).toBeChecked();
  await page.locator('#feature-assignment-none').click(); await saveFeatures();
  expect(await savedConfiguration()).toEqual({ ...external, featureOverrides: [{ id: 'REF-1', features: [] }] });
});

test('card editor protects suspended configuration drafts and supports empty-feature setup', async () => {
  await editFeatures(); await expect(page.locator('#feature-assignment-options')).toContainText('No features configured');
  await page.locator('#feature-assignment-configure').click(); await expect(page.getByRole('tab', { name: 'Discover IDs', exact: true })).toHaveAttribute('aria-selected', 'true'); await page.getByRole('tab', { name: 'Application features', exact: true }).click();
  await page.getByRole('button', { name: 'Add feature', exact: true }).click(); await page.locator('.feature-row').getByLabel('Feature name', { exact: true }).fill('Draft feature');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-results button').first().click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  await editFeatures(); await expect(page.locator('#feature-assignment-error')).toContainText('existing Project configuration draft');
  await expect(page.locator('#feature-assignment-apply')).toBeDisabled(); await page.locator('#feature-assignment-configure').click();
  await expect(page.locator('.feature-row').getByLabel('Feature name', { exact: true })).toHaveValue('Draft feature');
  await page.locator('#config-cancel').click(); expect(await savedConfiguration()).toEqual(initial);
  await editFeatures(); await page.locator('#feature-assignment-none').click(); await saveFeatures();
  expect((await savedConfiguration()).featureOverrides).toEqual([{ id: 'REF-1', features: [] }]);
});

test('card editing preserves unsaved Markdown and undo; stale card callbacks cannot edit another project', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.feature-badge')).toHaveText('GUI');
  await card('REF-1').locator('.lens-row').click(); await failAutosave(app);
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nUnsaved note\n');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed'); await editFeatures();
  await page.locator('#feature-assignment-none').click(); await saveFeatures(); await expect(card('REF-1').locator('.feature-badge')).toHaveCount(0);
  await expect(page.locator('#editor .cm-content')).toContainText('Unsaved note');
  expect(await readFile(path.join(project, 'gui/a.md'), 'utf8')).not.toContain('Unsaved note');
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+z'); await expect(page.locator('#editor .cm-content')).not.toContainText('Unsaved note');
  const stale = await card('REF-1').getByRole('button', { name: 'Edit features for REF-1', exact: true }).elementHandle();
  await page.locator('#refresh').click(); await expect(card('REF-1').locator('.feature-badge')).toHaveCount(0);
  await stale!.evaluate(button => (button as HTMLButtonElement).click()); await expect(assignmentDialog()).not.toBeVisible();
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-1 Other\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other');
  await stale!.evaluate(button => (button as HTMLButtonElement).click()); await expect(assignmentDialog()).not.toBeVisible();
  await expect(readFile(path.join(other, '.specular/project.json'))).rejects.toThrow();
});

test('card feature editor supports keyboard and both themes at minimum size', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.feature-badge')).toHaveText('GUI');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  await card('REF-1').getByRole('button', { name: 'Edit features for REF-1', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(assignmentDialog()).toBeVisible(); const backend = assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true });
  await backend.focus(); await page.keyboard.press('Space'); await expect(backend).toBeChecked();
  expect(await assignmentDialog().evaluate(e => e.getBoundingClientRect().bottom <= innerHeight && e.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/card-features-dark.png' }); await page.locator('#feature-assignment-cancel').click();
  await page.locator('#theme-switch').click(); await editFeatures(); await page.screenshot({ path: 'test-results/card-features-light.png' });
  await page.locator('#feature-assignment-cancel').click(); expect(await savedConfiguration()).toEqual(configured);
});


test('card save serializes Apply, retains old badges until persistence, and returns keyboard focus', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.feature-badge')).toHaveText('GUI'); await editFeatures();
  await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration');
    (globalThis as any).featureSaveCalls = 0;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', async (event, ...args) => {
      (globalThis as any).featureSaveCalls++;
      await new Promise<void>(resolve => { (globalThis as any).releaseFeatureSave = resolve; });
      return original(event, ...args);
    });
  });
  await page.locator('#feature-assignment-apply').click(); await expect(page.locator('#feature-assignment-apply')).toBeDisabled();
  await expect(page.locator('#feature-assignment-cancel')).toBeDisabled(); await expect(assignmentDialog().getByRole('checkbox').first()).toBeDisabled();
  await page.locator('#feature-assignment-apply').evaluate(button => (button as HTMLButtonElement).click()); await page.keyboard.press('Escape');
  await expect(assignmentDialog()).toBeVisible(); await expect(card('REF-1').locator('.feature-badge')).toHaveText('GUI'); expect(await savedConfiguration()).toEqual(configured);
  expect(await app.evaluate(() => (globalThis as any).featureSaveCalls)).toBe(1);
  await app.evaluate(() => (globalThis as any).releaseFeatureSave()); await expect(assignmentDialog()).not.toBeVisible();
  await expect(card('REF-1').locator('.feature-badge')).toHaveText(['Backend', 'GUI']);
  await expect(card('REF-1').getByRole('button', { name: 'Edit features for REF-1', exact: true })).toBeFocused();
});

test('changed Markdown invalidates an open card edit and an active project switch closes it', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.feature-badge')).toHaveText('GUI'); await editFeatures();
  await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check();
  await writeFile(path.join(project, 'notes.md'), '# REF-2 Changed\n');
  await expect(page.locator('#feature-assignment-error')).toContainText('Markdown changed'); await expect(page.locator('#feature-assignment-apply')).toBeDisabled();
  await expect(assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true })).toBeChecked();
  await page.locator('#feature-assignment-reload').click(); await expect(page.locator('#feature-assignment-apply')).toBeEnabled();
  await expect(assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true })).not.toBeChecked();
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-1 Other\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('#project-heading')).toHaveText('other'); await expect(assignmentDialog()).not.toBeVisible();
  expect(await savedConfiguration()).toEqual(configured); await expect(readFile(path.join(other, '.specular/project.json'))).rejects.toThrow();
});
