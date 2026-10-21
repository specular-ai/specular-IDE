import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failAutosave } from './autosave-fixture';

let app: ElectronApplication, page: Page, root: string, project: string;
const configuration = {
  version: 1, categories: [{ key: 'requirements', name: 'Requirements', role: 'requirement' }], rules: [{ key: 'req', category: 'requirements', prefix: 'REQ' }],
  modules: [{ key: 'gui', name: 'GUI' }, { key: 'backend', name: 'Backend' }, { key: 'empty', name: 'Unused' }],
  moduleRules: [{ key: 'a', scope: 'file', path: 'a.md', modules: ['gui'] }, { key: 'b', scope: 'file', path: 'b.md', modules: ['backend'] }, { key: 'c', scope: 'file', path: 'c.md', modules: ['gui'] }],
  moduleOverrides: [{ id: 'REQ-1', modules: ['gui', 'backend'] }, { id: 'REQ-2', modules: [] }],
  features: [{ key: 'first', name: 'First feature' }, { key: 'second', name: 'Second feature' }, { key: 'empty', name: 'Unused feature' }],
  featureRules: [{ key: 'a', scope: 'file', path: 'a.md', features: ['first'] }, { key: 'b', scope: 'file', path: 'b.md', features: ['second'] }],
  featureOverrides: [{ id: 'REQ-1', features: ['first', 'second'] }, { id: 'REQ-2', features: [] }],
};
const group = (key: string) => page.locator(`.lens-group[data-group="${key}"]`);
const card = (id: string) => page.locator(`#lens-results .lens-card[data-id="${id}"]`);
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/lens-groups-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration));
  await writeFile(path.join(project, 'a.md'), '# REQ-1 Shared\nStatus: Implemented\n# REQ-2 Missing\n# REQ-3 Conflict\nStatus: Draft\n');
  await writeFile(path.join(project, 'b.md'), '# REQ-3 Duplicate\nStatus: Accepted\n# REQ-4 Backend\n');
  await writeFile(path.join(project, 'c.md'), '# REQ-5 GUI\nStatus: Confirmed\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(card('REQ-1')).toBeVisible();
});
test.afterEach(async () => { if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); } });

test('group modes retain filters, distinct counts, source cards, and existing actions', async () => {
  const grouping = page.getByLabel('Group definitions by');
  await expect(grouping).toHaveValue('none'); await expect(page.locator('.lens-group')).toHaveCount(0);
  await grouping.selectOption('module');
  await expect(page.locator('.lens-group > summary')).toHaveText(['Backend2 IDs', 'GUI2 IDs', 'Module conflicts1 ID', 'No module1 ID']);
  await expect(page.locator('.lens-group-total')).toContainText('5 distinct IDs');
  await expect(card('REQ-1')).toHaveCount(2); await expect(group('module:conflict').locator('.lens-card')).toHaveCount(2);
  await group('module:conflict').locator('.module-evidence summary').first().click(); await expect(group('module:conflict')).toContainText('a.md'); await expect(group('module:conflict')).toContainText('b.md');
  await page.getByLabel('Filter by module', { exact: true }).selectOption('gui');
  await expect(page.locator('.lens-group > summary')).toHaveText(['Backend1 ID', 'GUI2 IDs']);
  await page.getByLabel('Search IDs').fill('REQ-1'); await expect(page.locator('.lens-group-total')).toContainText('1 distinct ID matching filters');
  await grouping.selectOption('none'); await expect(card('REQ-1')).toHaveCount(1); await expect(page.getByLabel('Search IDs')).toHaveValue('REQ-1');
  await grouping.selectOption('status'); await expect(page.locator('.lens-group > summary')).toHaveText(['Implemented1 ID']);
  await page.getByLabel('Filter by module', { exact: true }).selectOption(''); await page.getByLabel('Search IDs').fill('');
  await expect(page.locator('.lens-group > summary')).toHaveText(['Confirmed1 ID', 'Implemented1 ID', 'No status2 IDs', 'Status conflicts1 ID']);
  await group('status:value:implemented').getByRole('button', { name: 'All occurrences of REQ-1', exact: true }).click(); await expect(page.locator('#references-panel')).toBeVisible();
  await card('REQ-4').locator('.lens-row').click(); await expect(page.locator('#document-path')).toHaveText('b.md');
  await card('REQ-1').getByRole('button', { name: 'Edit modules for REQ-1', exact: true }).click(); await expect(page.getByRole('dialog').filter({ hasText: 'REQ-1' })).toBeVisible(); await page.keyboard.press('Escape');
  await page.locator('#pending-tab').click(); await expect(grouping).toBeHidden(); await expect(page.locator('.lens-group')).toHaveCount(0);
  await page.locator('#index-tab').click(); await expect(grouping).toHaveValue('status');
  await page.getByLabel('Search IDs').fill('no matching id'); await expect(page.locator('.lens-group')).toHaveCount(0); await expect(page.locator('#lens-results')).toContainText('No matching items.');
});

test('group refresh preserves expansion and keyboard focus, includes unsaved status edits and module updates', async () => {
  await page.getByLabel('Group definitions by').selectOption('status');
  const summary = group('status:value:confirmed').locator(':scope > summary');
  await summary.focus(); await page.keyboard.press('Enter'); await expect(group('status:value:confirmed')).not.toHaveAttribute('open');
  await writeFile(path.join(project, 'b.md'), '# REQ-3 Duplicate\nStatus: Draft\n# REQ-4 Backend\n');
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#refresh')!.click());
  await expect(group('status:conflict')).toHaveCount(0); await expect(group('status:value:draft').locator('.lens-group-count')).toHaveText('1 ID');
  await expect(summary).toBeFocused(); await expect(group('status:value:confirmed')).not.toHaveAttribute('open');
  await page.keyboard.press('Space'); await expect(card('REQ-5')).toBeVisible();
  await card('REQ-5').locator('.lens-row').click(); await expect(page.locator('#document-path')).toHaveText('c.md'); await failAutosave(app);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+a'); await page.keyboard.insertText('# REQ-5 GUI\nStatus: Draft\n');
  await expect(group('status:value:confirmed')).toHaveCount(0); await expect(group('status:value:draft').locator('.lens-group-count')).toHaveText('2 IDs');
  await page.getByLabel('Group definitions by').selectOption('module');
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify({ ...configuration, moduleOverrides: [...configuration.moduleOverrides, { id: 'REQ-5', modules: ['backend'] }] }));
  await page.locator('#refresh').click(); await expect(group('module:value:backend').locator('.lens-group-count')).toHaveText('3 IDs'); await expect(group('module:value:gui').locator('.lens-group-count')).toHaveText('1 ID');
  await group('module:value:backend').getByRole('button', { name: 'Edit modules for REQ-1', exact: true }).click();
  await page.locator('#module-assignment-options input[value="backend"]').uncheck(); await page.locator('#module-assignment-apply').click();
  await expect(page.locator('#module-assignment-dialog')).not.toBeVisible();
  await expect(group('module:value:backend').locator('.lens-group-count')).toHaveText('2 IDs');
  await expect(group('module:value:gui').getByRole('button', { name: 'Edit modules for REQ-1', exact: true })).toBeFocused();
});

test('groups fit both themes at minimum width, reset on project switch, and page large groups', async () => {
  await page.getByLabel('Group definitions by').selectOption('module');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    expect(await page.locator('#lens-results').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    await expect(group('module:value:gui').locator(':scope > summary')).toBeVisible();
  }
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'all.md'), Array.from({ length: 260 }, (_, i) => `# REQ-${i + 10} Item`).join('\n'));
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other'); await expect(page.getByLabel('Group definitions by')).toHaveValue('none');
  await page.getByLabel('Group definitions by').selectOption('module'); await expect(group('module:missing').locator('.lens-group-count')).toHaveText('260 IDs');
  await expect(page.locator('#lens-results .lens-card')).toHaveCount(250); await group('module:missing').getByRole('button', { name: 'Show more definitions (250 of 260)' }).click(); await expect(page.locator('#lens-results .lens-card')).toHaveCount(260);
  await expect(card('REQ-269').locator('.lens-row')).toBeFocused();
});

test('feature grouping keeps missing/conflicting evidence, filters, card edits and keyboard focus', async () => {
  const grouping = page.getByLabel('Group definitions by'); await grouping.selectOption('feature');
  await expect(page.locator('.lens-group > summary')).toHaveText(['Feature conflicts1 ID', 'First feature1 ID', 'No feature2 IDs', 'Second feature2 IDs']);
  await expect(page.locator('.lens-group-total')).toContainText('5 distinct IDs'); await expect(card('REQ-1')).toHaveCount(2);
  await expect(group('feature:conflict').locator('.lens-card')).toHaveCount(2);
  await group('feature:conflict').locator('.feature-evidence summary').first().click(); await expect(group('feature:conflict')).toContainText('a.md'); await expect(group('feature:conflict')).toContainText('b.md');
  await page.getByLabel('Filter by module', { exact: true }).selectOption('gui');
  await expect(page.locator('.lens-group > summary')).toHaveText(['First feature1 ID', 'No feature1 ID', 'Second feature1 ID']);
  await page.getByLabel('Search IDs').fill('REQ-1'); await expect(page.locator('.lens-group-total')).toContainText('1 distinct ID matching filters');
  for (const mode of ['none', 'status', 'module', 'feature']) { await grouping.selectOption(mode); await expect(page.getByLabel('Search IDs')).toHaveValue('REQ-1'); }
  await page.getByLabel('Search IDs').fill(''); await page.getByLabel('Filter by module', { exact: true }).selectOption('');
  await group('feature:value:first').getByRole('button', { name: 'Edit features for REQ-1', exact: true }).click();
  await page.locator('#feature-assignment-options input[value="first"]').uncheck(); await page.locator('#feature-assignment-apply').click();
  await expect(group('feature:value:first')).toHaveCount(0); await expect(card('REQ-1')).toHaveCount(1);
  await expect(group('feature:value:second').getByRole('button', { name: 'Edit features for REQ-1', exact: true })).toBeFocused();
  await group('feature:value:second').locator(':scope > summary').focus(); await page.keyboard.press('Enter'); await expect(group('feature:value:second')).not.toHaveAttribute('open');
  await grouping.selectOption('none'); await grouping.selectOption('feature'); await expect(group('feature:value:second')).not.toHaveAttribute('open');
  await group('feature:value:second').locator(':scope > summary').click(); await card('REQ-4').locator('.lens-row').click(); await expect(page.locator('#document-path')).toHaveText('b.md');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    expect(await page.locator('#lens-results').evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/feature-groups-${theme}.png` });
  }
  await grouping.selectOption('none'); await expect(page.locator('.lens-group')).toHaveCount(0); await expect(page.locator('#lens-results .lens-card')).toHaveCount(6);
});
