import { failAutosave } from './autosave-fixture';
import { expandConfigurationEntries, expectInternalKeysHidden } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
let app: ElectronApplication, page: Page, root: string, project: string;
const initial = { version: 1, categories: [{ key: 'needs', name: 'Requirements', role: 'requirement', colors: { dark: '#ffcc00' } }, { key: 'work', name: 'Tasks', role: 'task' }, { key: 'design', name: 'Design', role: 'design' }], rules: [{ key: 'ref', category: 'needs', prefix: 'REF' }, { key: 'work', category: 'work', prefix: 'WORK' }, { key: 'dec', category: 'design', prefix: 'DEC' }] };
const modules = [{ key: 'gui', name: 'GUI' }, { key: 'backend', name: 'Backend' }];
const configured = { ...initial, modules, moduleRules: [{ key: 'gui-files', scope: 'folder', path: 'gui', modules: ['gui'] }, { key: 'backend-files', scope: 'folder', path: 'backend', modules: ['backend'] }] };
const card = (id: string) => page.locator(`.lens-card[data-id="${id}"]`).first();
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow(); await expect(page.locator('#metric-ids')).toHaveText('4');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); }
async function open() {
  await page.locator('#project-config-open').click();
  await expect(page.locator('#config-modules')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Add module', exact: true })).toBeHidden();
  await page.getByRole('tab', { name: 'Application modules', exact: true }).click(); await expandConfigurationEntries(page);
}
async function apply() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); }
async function setConfig(value: unknown) { await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(value)); await page.locator('#refresh').click(); }
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/modules-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await mkdir(path.join(project, 'gui')); await mkdir(path.join(project, 'backend'));
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(initial));
  await writeFile(path.join(project, 'gui/a.md'), '# REF-1 Need\nDEC-1\n# WORK-1 Task\nDEC-1\n'); await writeFile(path.join(project, 'backend/design.md'), '# DEC-1 Design\nREF-1 WORK-1\n'); await writeFile(path.join(project, 'notes.md'), '# REF-2 Plain\n'); await launch();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); if (app) await close().catch(() => {}); });
test('create modules, assign a GUI requirement and task, override the task, filter and restart', async () => {
  await open();
  for (const name of ['GUI', 'Backend']) { await page.getByRole('button', { name: 'Add module', exact: true }).click(); await page.locator('.module-row').last().getByLabel('Module name', { exact: true }).fill(name); }
  await page.locator('.module-row').first().getByRole('button', { name: 'Add file rule', exact: true }).click(); const rule = page.locator('.module-file-rule').last();
  await rule.getByLabel('Match', { exact: true }).selectOption('folder'); await rule.getByLabel('Project-relative path', { exact: true }).fill('gui');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-module-summary')).toContainText('2 definitions assigned');
  await expect(page.locator('#config-results')).toContainText('Modules: GUI'); await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI'); await expect(card('WORK-1').locator('.module-badge')).toHaveText('GUI');
  await expect(card('REF-1').locator('.lens-category')).toHaveText('Requirements'); await expect(card('WORK-1').locator('.lens-category')).toHaveText('Tasks');
  await expect(card('REF-1')).toHaveCSS('border-left-color', 'rgb(255, 204, 0)');
  await card('REF-1').locator('.module-evidence summary').click(); await expect(card('REF-1').locator('.module-evidence')).toContainText('File rule files: gui');
  await card('REF-1').locator('.module-evidence button').click(); await expect(page.locator('#document-path')).toHaveText('gui/a.md');
  await open(); await page.locator('.module-row').nth(1).getByRole('button', { name: 'Add ID override', exact: true }).click(); const override = page.locator('.module-id-override').last();
  await override.getByLabel('Exact ID', { exact: true }).fill('WORK-1'); await apply();
  await expect(card('WORK-1').locator('.module-badge')).toHaveText('Backend');
  await page.getByLabel('Filter by module', { exact: true }).selectOption({ label: 'GUI' }); await expect(page.locator('#lens-results .lens-card')).toHaveCount(1); await expect(card('REF-1')).toBeVisible();
  await page.getByLabel('Filter by module', { exact: true }).selectOption({ label: 'Backend' }); await expect(card('WORK-1')).toBeVisible(); await expect(card('REF-1')).toHaveCount(0);
  await page.getByLabel('Filter by module', { exact: true }).selectOption('@unassigned'); await expect(page.locator('#lens-results .lens-card')).toHaveCount(2);
  await page.getByLabel('Filter by module', { exact: true }).selectOption('');
  await page.getByRole('button', { name: 'Explore map for REF-1', exact: true }).click(); const frame = await pluginFrame(app); await expect(frame.locator('.map-node[data-id="DEC-1"]')).toBeVisible();
  await close(); await launch(); await expect(card('WORK-1').locator('.module-badge')).toHaveText('Backend');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')); expect(saved.moduleOverrides).toEqual([{ id: 'WORK-1', modules: [saved.modules.find((m: any) => m.name === 'Backend').key] }]);
  expect(saved.categories).toEqual(initial.categories);
});
test('overlapping rules combine modules, empty overrides unassign, and cancellation preserves configuration', async () => {
  await setConfig({ ...configured, moduleRules: [...configured.moduleRules, { key: 'shared', scope: 'file', path: 'gui/a.md', modules: ['backend'] }], moduleOverrides: [{ id: 'WORK-1', modules: [] }] });
  await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend', 'GUI']); await expect(card('WORK-1').locator('.module-badge')).toHaveText('Unassigned');
  const before = await readFile(path.join(project, '.specular/project.json'), 'utf8'); await open();
  await page.locator('.module-file-rule').first().getByLabel('Project-relative path', { exact: true }).fill('../outside'); await expect(page.locator('#config-error')).toContainText('project-relative'); await expect(page.locator('#config-apply')).toBeDisabled();
  await page.keyboard.press('Escape'); expect(await readFile(path.join(project, '.specular/project.json'), 'utf8')).toBe(before);
  await card('WORK-1').locator('.module-evidence summary').click(); await expect(card('WORK-1').locator('.module-evidence')).toContainText('Exact-ID override: WORK-1 \u2192 Unassigned');
});
test('duplicate conflicts remain explicit, an override resolves membership, and source moves invalidate old evidence', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI');
  await writeFile(path.join(project, 'backend/duplicate.md'), '# REF-1 Duplicate\n'); await page.locator('#refresh').click();
  await expect(card('REF-1').locator('.module-badge')).toHaveText('Module conflict'); await page.getByLabel('Filter by module', { exact: true }).selectOption('@conflict'); await expect(page.locator('.lens-card')).toHaveCount(2);
  await card('REF-1').locator('.module-evidence summary').click(); await expect(card('REF-1').locator('.module-evidence')).toContainText('backend-files'); await expect(card('REF-1').locator('.module-evidence')).toContainText('gui-files');
  await page.locator('#pending-tab').click(); await expect(page.locator('#lens-results')).toContainText('Module conflict'); await expect(page.locator('#lens-results')).toContainText('Duplicate ID');
  await page.locator('#index-tab').click(); await setConfig({ ...configured, moduleOverrides: [{ id: 'REF-1', modules: ['backend'] }] }); await expect(page.locator('#lens-results')).toContainText('No matching items');
  await page.getByLabel('Filter by module', { exact: true }).selectOption(''); await expect(card('REF-1').locator('.module-badge')).toHaveText('Backend');
  await card('WORK-1').locator('.module-evidence summary').click(); const oldSource = await card('WORK-1').locator('.module-evidence button').elementHandle(); const current = await page.locator('#document-path').textContent();
  await rename(path.join(project, 'gui/a.md'), path.join(project, 'backend/moved.md')); await page.locator('#refresh').click();
  await expect(card('WORK-1').locator('.module-badge')).toHaveText('Backend'); await oldSource!.evaluate(button => (button as HTMLButtonElement).click()); await expect(page.locator('#document-path')).toHaveText(current!);
});
test('module setup fits the minimum window and assignments do not leak to another project', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720)); await open(); await page.locator('#config-modules').scrollIntoViewIfNeeded();
  expect(await page.locator('#project-configuration-dialog').evaluate(element => element.getBoundingClientRect().right <= innerWidth && element.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
  await page.screenshot({ path: 'test-results/module-configuration.png' }); await page.keyboard.press('Escape');
  await expect(async () => { await card('REF-1').scrollIntoViewIfNeeded(); }).toPass(); await page.screenshot({ path: 'test-results/modules-dark.png' }); await page.locator('#theme-switch').click(); await page.screenshot({ path: 'test-results/modules-light.png' });
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-1 Other project\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other); await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other');
  await expect(page.locator('#module-filter-row')).toBeHidden(); await expect(page.locator('.module-badge')).toHaveCount(0);
});

test('module keys and file-rule keys stay internal while duplicate names and renames preserve assignments', async () => {
  const config = { ...initial, modules: [{ key: 'privateModule', name: 'Same name' }, { key: 'privateOtherModule', name: 'Same name' }], moduleRules: [{ key: 'privateFileRule', scope: 'folder', path: 'gui', modules: ['privateModule'] }], moduleOverrides: [{ id: 'WORK-1', modules: ['privateOtherModule'] }] };
  await setConfig(config); await expect(card('REF-1').locator('.module-badge')).toHaveText('Same name'); await open();
  const keys = ['privateModule', 'privateOtherModule', 'privateFileRule']; await expectInternalKeysHidden(page, keys);
  const rule = page.locator('.module-row').first().locator('.module-file-rule'); await expect(rule).toHaveCount(1);
  await expect(rule.locator('.module-members')).toHaveCount(0); await expect(page.locator('.module-row').nth(1).locator('.module-file-rule')).toHaveCount(0);
  await page.locator('.module-row').first().getByLabel('Module name', { exact: true }).fill('Renamed GUI');
  await expect(rule.getByLabel('Project-relative path', { exact: true })).toHaveValue('gui');
  for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'Add module', exact: true }).click(); await page.locator('.module-row').last().getByLabel('Module name', { exact: true }).fill('Same name'); }
  await apply();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.modules[0]).toEqual({ key: 'privateModule', name: 'Renamed GUI' }); expect(new Set(saved.modules.map((m: any) => m.key)).size).toBe(4);
  expect(saved.moduleRules).toEqual(config.moduleRules); expect(saved.moduleOverrides).toEqual(config.moduleOverrides);
  await close(); await launch(); await expect(card('REF-1').locator('.module-badge')).toHaveText('Renamed GUI'); await open(); await expectInternalKeysHidden(page, keys);
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await expectInternalKeysHidden(page, keys);
});


test('module-owned rules preserve shared targets until editing, remove independently, and persist multiple rules through save recovery and restart', async () => {
  const config = { ...initial, modules, moduleRules: [
    { key: 'shared', scope: 'folder', path: 'gui', modules: ['gui', 'backend'] },
    { key: 'notes', scope: 'file', path: 'notes.md', modules: ['gui', 'backend'] },
  ], moduleOverrides: [{ id: 'WORK-1', modules: ['backend'] }, { id: 'REF-2', modules: [] }] };
  const source = await readFile(path.join(project, 'gui/a.md'), 'utf8');
  await setConfig(config); await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend', 'GUI']); await open();
  const gui = () => page.locator('.module-row').first(), backend = () => page.locator('.module-row').nth(1);
  await expect(gui().locator('.module-file-rule')).toHaveCount(2); await expect(backend().locator('.module-file-rule')).toHaveCount(2);
  await gui().getByLabel('Module name', { exact: true }).fill('Renamed GUI'); await apply();
  expect((await savedConfiguration()).moduleRules).toEqual(config.moduleRules);
  await open(); await gui().getByLabel('Project-relative path', { exact: true }).first().fill('backend/design.md');
  await gui().getByLabel('Match', { exact: true }).first().selectOption('file');
  await expect(backend().getByLabel('Project-relative path', { exact: true }).first()).toHaveValue('gui');
  await page.locator('#config-cancel').click(); expect((await savedConfiguration()).moduleRules).toEqual(config.moduleRules);
  await open(); await gui().getByLabel('Project-relative path', { exact: true }).first().fill('backend/design.md');
  await gui().getByLabel('Match', { exact: true }).first().selectOption('file');
  // Detaching the GUI rule moves it to the end of storage, but not the mounted editor.
  await gui().getByRole('button', { name: 'Remove file rule', exact: true }).nth(1).click();
  await expect(gui().getByRole('button', { name: 'Add file rule', exact: true })).toBeFocused();
  await expect(backend().getByLabel('Project-relative path', { exact: true }).nth(1)).toHaveValue('notes.md');
  for (const value of ['gui/a.md', 'notes.md']) {
    await gui().getByRole('button', { name: 'Add file rule', exact: true }).click();
    const input = gui().getByLabel('Project-relative path', { exact: true }).last(); await expect(input).toBeFocused(); await input.fill(value);
  }
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let fail = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (fail) { fail = false; return { ok: false, message: 'Simulated nested module save failure' }; } return original(event, ...args);
    });
  });
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await page.locator('#config-apply').click();
  await expect(page.locator('#config-error')).toContainText('nested module save failure');
  await expect(gui().locator('.module-file-rule')).toHaveCount(3); expect((await savedConfiguration()).moduleRules).toEqual(config.moduleRules);
  await apply(); const saved = await savedConfiguration();
  expect(saved.moduleRules.slice(0, 2)).toEqual(config.moduleRules.map(rule => ({ ...rule, modules: ['backend'] })));
  expect(saved.moduleRules.slice(2).map((rule: any) => [rule.path, rule.scope, rule.modules])).toEqual([
    ['backend/design.md', 'file', ['gui']], ['gui/a.md', 'file', ['gui']], ['notes.md', 'file', ['gui']],
  ]);
  expect(saved.moduleOverrides).toEqual(config.moduleOverrides); expect(saved.categories).toEqual(initial.categories); expect(saved.rules).toEqual(initial.rules);
  await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend', 'Renamed GUI']); await expect(card('WORK-1').locator('.module-badge')).toHaveText('Backend');
  await expect(card('REF-2').locator('.module-badge')).toHaveText('Unassigned'); await expect(card('DEC-1').locator('.module-badge')).toHaveText('Renamed GUI');
  await card('REF-1').locator('.module-evidence summary').click(); await expect(card('REF-1').locator('.module-evidence')).toContainText('File rule shared: gui');
  await close(); await launch(); await open(); await expect(gui().locator('.module-file-rule')).toHaveCount(3); await expect(backend().locator('.module-file-rule')).toHaveCount(2);
  expect(await savedConfiguration()).toEqual(saved); expect(await readFile(path.join(project, 'gui/a.md'), 'utf8')).toBe(source);
});

test('removing a module cleans its nested rules and override targets while retaining explicit unassignment', async () => {
  await setConfig({ ...configured, moduleRules: [{ key: 'shared', scope: 'folder', path: 'gui', modules: ['gui', 'backend'] }], moduleOverrides: [{ id: 'WORK-1', modules: ['gui'] }, { id: 'REF-1', modules: ['gui', 'backend'] }] });
  await open(); await page.locator('.module-row').first().getByRole('button', { name: 'Remove module', exact: true }).click(); await apply();
  const saved = await savedConfiguration(); expect(saved.modules).toEqual([modules[1]]); expect(saved.moduleRules[0].modules).toEqual(['backend']);
  expect(saved.moduleOverrides).toEqual([{ id: 'WORK-1', modules: [] }, { id: 'REF-1', modules: ['backend'] }]);
  await expect(card('WORK-1').locator('.module-badge')).toHaveText('Unassigned'); await expect(card('REF-1').locator('.module-badge')).toHaveText('Backend');
});

test('nested module rules respect shared capacity and retain keyboard focus in both themes at minimum size', async () => {
  const config = { ...initial, modules, moduleRules: [
    { key: 'shared', scope: 'folder', path: 'gui', modules: ['gui', 'backend'] },
    ...Array.from({ length: 127 }, (_, i) => ({ key: `r${i}`, scope: 'file', path: 'notes.md', modules: ['gui'] })),
  ] };
  await setConfig(config); await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend', 'GUI']);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Application modules', exact: true }).click();
    const entry = page.locator('.module-names > .config-entry').first(), owner = entry.locator('.module-row');
    await entry.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
    const rules = owner.locator('.module-rules > .config-entry'); await rules.first().locator(':scope > summary').click();
    await expect(owner.getByLabel('Project-relative path', { exact: true }).first()).toBeDisabled(); await expect(owner.locator('.module-rule-limit').first()).toBeVisible();
    await expect(page.locator('.module-add-rule').first()).toBeDisabled(); await expect(page.locator('.module-add-rule').last()).toBeDisabled();
    await rules.nth(1).locator(':scope > summary').click(); await rules.nth(1).getByRole('button', { name: 'Remove file rule', exact: true }).click();
    await expect(owner.getByLabel('Project-relative path', { exact: true }).first()).toBeEnabled(); await expect(page.locator('.module-add-rule').last()).toBeEnabled();
    await owner.getByLabel('Project-relative path', { exact: true }).first().fill('backend');
    await expect(owner.getByLabel('Project-relative path', { exact: true }).first()).toBeFocused(); await expect(page.locator('.module-add-rule').last()).toBeDisabled();
    await expect(owner.getByLabel('Project-relative path', { exact: true }).first()).toBeEnabled();
    await rules.first().getByRole('button', { name: 'Remove file rule', exact: true }).click();
    await expect(owner.getByRole('button', { name: 'Add file rule', exact: true })).toBeFocused(); await page.keyboard.press('Enter');
    const added = owner.getByLabel('Project-relative path', { exact: true }).last(); await expect(added).toBeFocused(); await added.fill('gui/a.md');
    expect(await page.locator('#project-configuration-dialog').evaluate(e => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await page.screenshot({ path: `test-results/module-rules-${theme}.png` }); await page.locator('#config-cancel').click(); expect(await savedConfiguration()).toEqual(config);
  }
});

test('nested ID overrides edit shared IDs independently, merge existing targets, and retain editable unassigned IDs across restart', async () => {
  const config = { ...configured, moduleOverrides: [{ id: 'REF-1', modules: ['gui', 'backend'] }, { id: 'WORK-1', modules: ['backend'] }, { id: 'REF-2', modules: [] }] };
  await setConfig(config); await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend', 'GUI']); await open();
  const gui = () => page.locator('.module-row').first(), backend = () => page.locator('.module-row').nth(1);
  await expect(gui().locator('.module-overrides')).toHaveCount(1); await expect(gui().locator('.module-id-override')).toHaveCount(1);
  await expect(backend().locator('.module-id-override')).toHaveCount(2); await expect(page.locator('.module-unassigned .module-id-override')).toHaveCount(1);
  await apply(); expect((await savedConfiguration()).moduleOverrides).toEqual(config.moduleOverrides);
  await open(); await gui().getByLabel('Exact ID', { exact: true }).fill('DEC-1');
  await expect(backend().getByLabel('Exact ID', { exact: true }).first()).toHaveValue('REF-1');
  await page.locator('#config-cancel').click(); expect((await savedConfiguration()).moduleOverrides).toEqual(config.moduleOverrides);
  await open(); await gui().getByLabel('Exact ID', { exact: true }).fill('DEC-1'); await apply();
  // Reindexing can briefly retain two old badges; list assertions wait for the new single membership.
  await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend']); await expect(card('DEC-1').locator('.module-badge')).toHaveText(['GUI']);
  await open();
  for (const id of ['WORK-1', 'REF-2', 'WORK-1']) {
    await gui().getByRole('button', { name: 'Add ID override', exact: true }).click();
    const input = gui().getByLabel('Exact ID', { exact: true }).last(); await expect(input).toBeFocused(); await input.fill(id);
    // Preview's click must still run when blur merges an existing override.
    await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  }
  await expect(gui().locator('.module-id-override')).toHaveCount(3); await expect(page.locator('.module-unassigned .module-id-override')).toHaveCount(0);
  await apply(); const combined = await savedConfiguration();
  expect(combined.moduleOverrides.find((rule: any) => rule.id === 'WORK-1').modules).toEqual(['backend', 'gui']);
  expect(combined.moduleOverrides.find((rule: any) => rule.id === 'REF-2').modules).toEqual(['gui']);
  await open();
  for (const id of ['WORK-1', 'REF-2']) {
    await gui().locator('.module-overrides > .config-entry').filter({ hasText: id }).getByRole('button', { name: 'Remove ID override', exact: true }).click();
    await expect(gui().getByRole('button', { name: 'Add ID override', exact: true })).toBeFocused();
  }
  const unassigned = page.locator('.module-unassigned > .config-entry'); await unassigned.locator(':scope > summary').click();
  await expect(unassigned.getByLabel('Exact ID', { exact: true })).toHaveValue('REF-2'); await apply();
  await expect(card('WORK-1').locator('.module-badge')).toHaveText(['Backend']); await expect(card('REF-2').locator('.module-badge')).toHaveText(['Unassigned']);
  await close(); await launch(); await open();
  await page.locator('.module-unassigned').getByRole('button', { name: 'Restore file/folder assignments', exact: true }).click(); await apply();
  expect((await savedConfiguration()).moduleOverrides.some((rule: any) => rule.id === 'REF-2')).toBe(false);
  expect((await savedConfiguration()).moduleRules).toEqual(configured.moduleRules);
});

test('nested override limits and keyboard controls fit matching sections in both themes', async () => {
  const config = { ...configured, moduleOverrides: [{ id: 'REF-1', modules: ['gui', 'backend'] }, ...Array.from({ length: 255 }, (_, i) => ({ id: `REF-${i + 2}`, modules: [] }))] };
  await setConfig(config); await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend', 'GUI']);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Application modules', exact: true }).click();
    const entry = page.locator('.module-names > .config-entry').first(); await entry.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
    const override = entry.locator('.module-overrides > .config-entry').first(); await override.locator(':scope > summary').click();
    await expect(override.getByLabel('Exact ID', { exact: true })).toBeDisabled(); await expect(override.locator('.module-rule-limit')).toBeVisible();
    await expect(entry.getByRole('button', { name: 'Add ID override', exact: true })).toBeDisabled();
    const unassigned = page.locator('.module-unassigned > .config-entry').first(); await unassigned.locator(':scope > summary').click();
    await unassigned.getByRole('button', { name: 'Restore file/folder assignments', exact: true }).click();
    await expect(override.getByLabel('Exact ID', { exact: true })).toBeEnabled(); await override.getByLabel('Exact ID', { exact: true }).fill('DEC-1');
    await expect(entry.getByRole('button', { name: 'Add ID override', exact: true })).toBeDisabled();
    await expect(override.getByLabel('Exact ID', { exact: true })).toBeFocused();
    expect(await page.locator('#project-configuration-dialog').evaluate(e => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await entry.locator('.module-overrides').scrollIntoViewIfNeeded(); await page.screenshot({ path: `test-results/module-overrides-${theme}.png` });
    await page.locator('#config-cancel').click(); expect(await savedConfiguration()).toEqual(config);
  }
});

const assignmentDialog = () => page.locator('#module-assignment-dialog');
async function editModules(id = 'REF-1') {
  // A fixture write can trigger a watcher refresh after the first card appears.
  // The UI asks users to reopen in that case; retry opening against the fresh card.
  await expect(async () => {
    if (!await assignmentDialog().isVisible()) await card(id).getByRole('button', { name: `Edit modules for ${id}`, exact: true }).click();
    await expect(assignmentDialog()).toBeVisible({ timeout: 300 });
  }).toPass({ timeout: 10_000 });
}
async function saveModules() {
  await page.locator('#module-assignment-apply').click(); await expect(assignmentDialog()).not.toBeVisible();
}
async function savedConfiguration() { return JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')); }

test('card module editor adds/removes memberships, cancels, unassigns, restores inheritance and persists on restart', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI');
  await editModules(); await expect(assignmentDialog().getByRole('checkbox', { name: '1. GUI', exact: true })).toBeChecked();
  await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check(); await page.keyboard.press('Escape');
  expect(await savedConfiguration()).toEqual(configured);
  await expect(card('REF-1').getByRole('button', { name: 'Edit modules for REF-1', exact: true })).toBeFocused();
  await editModules(); await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check(); await saveModules();
  await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend', 'GUI']);
  expect(await savedConfiguration()).toEqual({ ...configured, moduleOverrides: [{ id: 'REF-1', modules: ['gui', 'backend'] }] });
  await editModules(); await assignmentDialog().getByRole('checkbox', { name: '1. GUI', exact: true }).uncheck(); await saveModules();
  await expect(card('REF-1').locator('.module-badge')).toHaveText('Backend');
  await open(); await expect(page.locator('.module-row').nth(1).locator('.module-id-override').getByLabel('Exact ID', { exact: true })).toHaveValue('REF-1'); await page.locator('#config-cancel').click();
  await page.getByLabel('Filter by module', { exact: true }).selectOption('backend'); await expect(card('REF-1')).toBeVisible();
  await editModules(); await page.locator('#module-assignment-none').click(); await saveModules(); await expect(card('REF-1')).toHaveCount(0);
  await page.getByLabel('Filter by module', { exact: true }).selectOption('@unassigned'); await expect(card('REF-1').locator('.module-badge')).toHaveText('Unassigned');
  expect((await savedConfiguration()).moduleOverrides).toEqual([{ id: 'REF-1', modules: [] }]);
  await close(); await launch(); await expect(card('REF-1').locator('.module-badge')).toHaveText('Unassigned');
  await editModules(); await page.locator('#module-assignment-inherit').click(); await saveModules();
  await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI'); expect((await savedConfiguration()).moduleOverrides).toEqual([]);
  await expect(card('WORK-1').locator('.module-badge')).toHaveText('GUI');
  await editModules('REF-2'); await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check(); await saveModules();
  await expect(card('REF-2').locator('.module-badge')).toHaveText('Backend');
  expect(await readFile(path.join(project, 'gui/a.md'), 'utf8')).toBe('# REF-1 Need\nDEC-1\n# WORK-1 Task\nDEC-1\n');
});

test('card editing resolves duplicate membership conflicts explicitly and reset restores their evidence', async () => {
  await setConfig(configured); await writeFile(path.join(project, 'backend/duplicate.md'), '# REF-1 Duplicate\n'); await page.locator('#refresh').click();
  await expect(card('REF-1').locator('.module-badge')).toHaveText('Module conflict'); await editModules();
  await expect(page.locator('#module-assignment-evidence')).toContainText('backend/duplicate.md');
  await expect(page.locator('#module-assignment-evidence')).toContainText('gui/a.md');
  await expect(page.locator('#module-assignment-apply')).toBeDisabled();
  await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check(); await saveModules();
  await expect(page.locator('.lens-card[data-id="REF-1"] .module-badge')).toHaveText(['Backend', 'Backend']);
  await page.locator('#pending-tab').click(); await expect(page.locator('#lens-results')).toContainText('Duplicate ID');
  await expect(page.locator('#lens-results')).not.toContainText('Module conflict'); await page.locator('#index-tab').click();
  await editModules(); await page.locator('#module-assignment-inherit').click(); await saveModules();
  await expect(page.locator('.lens-card[data-id="REF-1"] .module-badge')).toHaveText(['Module conflict', 'Module conflict']);
});

test('card editor preserves selections on failed saves and recovers from external conflicts', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI'); await editModules();
  await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let first = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (first) { first = false; return { ok: false, message: 'Simulated module write failure' }; }
      return original(event, ...args);
    });
  });
  await page.locator('#module-assignment-apply').click(); await expect(page.locator('#module-assignment-error')).toContainText('write failure');
  await expect(assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true })).toBeChecked();
  expect(await savedConfiguration()).toEqual(configured); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI'); await saveModules();
  await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend', 'GUI']); await editModules();
  const external = { ...configured, modules: [{ key: 'gui', name: 'New GUI' }, modules[1]] };
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(external));
  await expect(page.locator('#module-assignment-error')).toContainText('configuration changed'); await expect(page.locator('#module-assignment-apply')).toBeDisabled();
  expect(await savedConfiguration()).toEqual(external); await page.locator('#module-assignment-reload').click();
  await expect(assignmentDialog().getByRole('checkbox', { name: '1. New GUI', exact: true })).toBeChecked();
  await page.locator('#module-assignment-none').click(); await saveModules();
  expect(await savedConfiguration()).toEqual({ ...external, moduleOverrides: [{ id: 'REF-1', modules: [] }] });
});

test('card editor protects suspended configuration drafts and supports empty-module setup', async () => {
  await editModules(); await expect(page.locator('#module-assignment-options')).toContainText('No modules configured');
  await page.locator('#module-assignment-configure').click(); await expect(page.getByRole('tab', { name: 'Discover IDs', exact: true })).toHaveAttribute('aria-selected', 'true'); await page.getByRole('tab', { name: 'Application modules', exact: true }).click();
  await page.getByRole('button', { name: 'Add module', exact: true }).click(); await page.locator('.module-row').getByLabel('Module name', { exact: true }).fill('Draft module');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-results button').first().click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  await editModules(); await expect(page.locator('#module-assignment-error')).toContainText('existing Project configuration draft');
  await expect(page.locator('#module-assignment-apply')).toBeDisabled(); await page.locator('#module-assignment-configure').click();
  await expect(page.locator('.module-row').getByLabel('Module name', { exact: true })).toHaveValue('Draft module');
  await page.locator('#config-cancel').click(); expect(await savedConfiguration()).toEqual(initial);
  await editModules(); await page.locator('#module-assignment-none').click(); await saveModules();
  expect((await savedConfiguration()).moduleOverrides).toEqual([{ id: 'REF-1', modules: [] }]);
});

test('card editing preserves unsaved Markdown and undo; stale card callbacks cannot edit another project', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI');
  await card('REF-1').locator('.lens-row').click(); await failAutosave(app);
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('\nUnsaved note\n');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed'); await editModules();
  await page.locator('#module-assignment-none').click(); await saveModules(); await expect(card('REF-1').locator('.module-badge')).toHaveText('Unassigned');
  await expect(page.locator('#editor .cm-content')).toContainText('Unsaved note');
  expect(await readFile(path.join(project, 'gui/a.md'), 'utf8')).not.toContain('Unsaved note');
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+z'); await expect(page.locator('#editor .cm-content')).not.toContainText('Unsaved note');
  const stale = await card('REF-1').getByRole('button', { name: 'Edit modules for REF-1', exact: true }).elementHandle();
  await page.locator('#refresh').click(); await expect(card('REF-1').locator('.module-badge')).toHaveText('Unassigned');
  await stale!.evaluate(button => (button as HTMLButtonElement).click()); await expect(assignmentDialog()).not.toBeVisible();
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-1 Other\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other');
  await stale!.evaluate(button => (button as HTMLButtonElement).click()); await expect(assignmentDialog()).not.toBeVisible();
  await expect(readFile(path.join(other, '.specular/project.json'))).rejects.toThrow();
});

test('card module editor supports keyboard and both themes at minimum size', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  await card('REF-1').getByRole('button', { name: 'Edit modules for REF-1', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(assignmentDialog()).toBeVisible(); const backend = assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true });
  await backend.focus(); await page.keyboard.press('Space'); await expect(backend).toBeChecked();
  expect(await assignmentDialog().evaluate(e => e.getBoundingClientRect().bottom <= innerHeight && e.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/card-modules-dark.png' }); await page.locator('#module-assignment-cancel').click();
  await page.locator('#theme-switch').click(); await editModules(); await page.screenshot({ path: 'test-results/card-modules-light.png' });
  await page.locator('#module-assignment-cancel').click(); expect(await savedConfiguration()).toEqual(configured);
});


test('card save serializes Apply, retains old badges until persistence, and returns keyboard focus', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI'); await editModules();
  await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration');
    (globalThis as any).moduleSaveCalls = 0;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', async (event, ...args) => {
      (globalThis as any).moduleSaveCalls++;
      await new Promise<void>(resolve => { (globalThis as any).releaseModuleSave = resolve; });
      return original(event, ...args);
    });
  });
  await page.locator('#module-assignment-apply').click(); await expect(page.locator('#module-assignment-apply')).toBeDisabled();
  await expect(page.locator('#module-assignment-cancel')).toBeDisabled(); await expect(assignmentDialog().getByRole('checkbox').first()).toBeDisabled();
  await page.locator('#module-assignment-apply').evaluate(button => (button as HTMLButtonElement).click()); await page.keyboard.press('Escape');
  await expect(assignmentDialog()).toBeVisible(); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI'); expect(await savedConfiguration()).toEqual(configured);
  expect(await app.evaluate(() => (globalThis as any).moduleSaveCalls)).toBe(1);
  await app.evaluate(() => (globalThis as any).releaseModuleSave()); await expect(assignmentDialog()).not.toBeVisible();
  await expect(card('REF-1').locator('.module-badge')).toHaveText(['Backend', 'GUI']);
  await expect(card('REF-1').getByRole('button', { name: 'Edit modules for REF-1', exact: true })).toBeFocused();
});

test('changed Markdown invalidates an open card edit and an active project switch closes it', async () => {
  await setConfig(configured); await expect(card('REF-1').locator('.module-badge')).toHaveText('GUI'); await editModules();
  await assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true }).check();
  await writeFile(path.join(project, 'notes.md'), '# REF-2 Changed\n');
  await expect(page.locator('#module-assignment-error')).toContainText('Markdown changed'); await expect(page.locator('#module-assignment-apply')).toBeDisabled();
  await expect(assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true })).toBeChecked();
  await page.locator('#module-assignment-reload').click(); await expect(page.locator('#module-assignment-apply')).toBeEnabled();
  await expect(assignmentDialog().getByRole('checkbox', { name: '2. Backend', exact: true })).not.toBeChecked();
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-1 Other\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').evaluate(button => (button as HTMLButtonElement).click());
  await expect(page.locator('#project-heading')).toHaveText('other'); await expect(assignmentDialog()).not.toBeVisible();
  expect(await savedConfiguration()).toEqual(configured); await expect(readFile(path.join(other, '.specular/project.json'))).rejects.toThrow();
});
