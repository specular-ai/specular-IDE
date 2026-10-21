import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { failAutosave } from './autosave-fixture';

let app: ElectronApplication, page: Page, root: string, project: string;
const configuration = { version: 1, categories: [{ key: 'requirements', name: 'Requirements', role: 'requirement' }],
  rules: [{ key: 'ref', category: 'requirements', prefix: 'REF' }, { key: 'named', category: 'requirements', pattern: '(?<![\\w/])feature/[a-z]+(?![\\w/])' }] };
async function configure(value: unknown) {
  await writeFile(path.join(project, '.specular/project.json'), typeof value === 'string' ? value : JSON.stringify(value));
  await page.locator('#refresh').click();
}
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#document-path')).toHaveText('a.md');
}
test.beforeEach(async () => {
  await mkdir('.cache/project-id-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/project-id-tests/run-'));
  project = path.join(root, 'project'); await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, 'a.md'), '# REF-01 First\n\nREF-01 and `REF-01` and **REF-01**.\n\nREF&#45;01 before REF-01.\n\nSee feature/login.\n\nREQ-01 stays ordinary with this configuration.\n');
  await writeFile(path.join(project, 'b.md'), '# feature/login Login\nREF-01\n');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    console.log(await page?.locator('#warnings').textContent(), await page?.locator('#status').textContent());
    await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  }
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});
test('custom IDs share preview links, cross-file navigation, cursor lookup and brief capture', async () => {
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration)); await launch();
  await expect(page.locator('#metric-ids')).toHaveText('2');
  await expect(page.locator('#preview [data-id="REF-01"]')).toHaveCount(5);
  await expect(page.locator('#preview code [data-id="REF-01"]')).toHaveCount(1);
  await expect(page.locator('#preview p').filter({ hasText: 'before' }).locator('[data-id]')).toHaveCount(1);
  await expect(page.locator('#preview [data-id="REQ-01"]')).toHaveCount(0);
  await page.locator('#preview [data-id="feature/login"]').click();
  await expect(page.locator('#document-path')).toHaveText('b.md');
  expect(await page.evaluate(() => window.getSelection()?.toString() || '')).toBe('feature/login');
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('F12');
  await expect(page.locator('#document-path')).toHaveText('a.md');
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+a');
  await page.locator('#prepare-brief').click();
  await expect(page.locator('#brief-ids')).toContainText('REF-01');
  await expect(page.locator('#brief-ids')).toContainText('feature/login');
  await expect(page.locator('#brief-ids')).not.toContainText('REQ-01');
});
test('invalid configuration recovery, runtime errors and repair never silently accept a partial index', async () => {
  await writeFile(path.join(project, '.specular/project.json'), '{broken'); await launch();
  await expect(page.locator('#warnings')).toContainText('legacy defaults');
  await configure(configuration); await expect(page.locator('#metric-ids')).toHaveText('2');
  await configure('{bad'); await expect(page.locator('#warnings')).toContainText('last valid');
  await expect(page.locator('#metric-ids')).toHaveText('2');
  await configure({ ...configuration, rules: [...configuration.rules, { key: 'overlap', category: 'requirements', pattern: 'REF-\\d+' }] });
  await expect(page.locator('#warnings')).toContainText('overlap');
  await expect(page.locator('#metric-ids')).toHaveText('—');
  await expect(page.locator('#preview .id-link')).toHaveCount(0);
  await configure({ ...configuration, rules: [{ key: 'empty', category: 'requirements', pattern: '(?=REF)' }] });
  await expect(page.locator('#warnings')).toContainText('empty');
  await configure(configuration); await expect(page.locator('#metric-ids')).toHaveText('2');
  await expect(page.locator('#preview [data-id="REF-01"]')).toHaveCount(5);
  await expect(page.locator('#warnings')).toBeHidden();
});
test('pathological regex is stopped while the editor remains responsive and repair can retry', async () => {
  await writeFile(path.join(project, 'a.md'), '# REF-01 First\n\n' + 'a'.repeat(15000) + '!\n');
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify({ ...configuration, rules: [{ key: 'slow', category: 'requirements', pattern: '(a+)+$' }] }));
  await launch();
  await page.locator('#id-search').fill('Editor is responsive');
  await expect(page.locator('#id-search')).toHaveValue('Editor is responsive');
  await expect(page.locator('#warnings')).toContainText('was stopped', { timeout: 15000 });
  await configure(configuration); await expect(page.locator('#metric-ids')).toHaveText('2');
});
test('live rule changes preserve unsaved text and undo and refresh custom matches', async () => {
  await launch(); await failAutosave(app);
  await expect(page.locator('#status')).toContainText('Index up to date');
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n# REF-02 Unsaved\n');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed');
  await configure(configuration); await expect(page.locator('#metric-ids')).toHaveText('3');
  await expect(page.locator('#editor .cm-content')).toContainText('REF-02 Unsaved');
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).not.toContain('REF-02');
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+z');
  await expect(page.locator('#metric-ids')).toHaveText('2');
});
test('reopening and switching projects use their own conventions', async () => {
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration)); await launch();
  await expect(page.locator('#metric-ids')).toHaveText('2');
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'a.md'), '# REQ-01 Legacy\nREF-01\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click();
  await expect(page.locator('#project-heading')).toHaveText('other');
  await expect(page.locator('#metric-ids')).toHaveText('1');
  await expect(page.locator('#preview [data-id="REF-01"]')).toHaveCount(0);
  await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('app:action', 'recent:' + value), project);
  await expect(page.locator('#project-heading')).toHaveText('project');
  await expect(page.locator('#metric-ids')).toHaveText('2');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close();
  await launch(); await expect(page.locator('#metric-ids')).toHaveText('2');
});
