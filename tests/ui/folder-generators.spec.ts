import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1, categories: [{ key: 'req', name: 'Requirements', idScopes: [{ pattern: 'specs/*' }] }], rules: [{ key: 'req', category: 'req', prefix: 'FR' }],
  features: [{ key: 'manual', name: 'reporting' }], modules: [{ key: 'manual', name: 'Manual module' }],
  moduleOverrides: [{ id: 'FR-001', scope: 'specs/authentication', modules: ['manual'] }] };
const sources = { 'specs/authentication/main.md': '# FR-001 Authentication\n', 'specs/authentication/nested/main.md': '# FR-002 Nested\n',
  'specs/reporting/main.md': '# FR-001 Reporting\nFR-999\n', 'specs/overview.md': '# FR-003 Overview\n', 'specs/empty/main.md': 'No IDs here.\n' };
const file = () => path.join(project, '.specular/project.json');
const editor = (target = 'features') => page.locator(`#config-folder-${target}`);
const entries = () => page.locator('.folder-preview-entry');
async function open(target = 'features') { await page.locator('#project-config-open').click(); await page.locator(`#config-tab-${target}`).click(); }
async function add(target = 'features') { await editor(target).getByRole('button', { name: 'Add folder pattern', exact: true }).click(); }
async function preview(target = 'features') {
  await editor(target).getByRole('button', { name: `Preview folder ${target}`, exact: true }).click();
  await expect(page.locator('#config-status')).toContainText('Folder preview ready'); await expect(page.locator('#config-apply')).toBeDisabled();
}
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/folders-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await writeFile(file(), JSON.stringify(config));
  for (const [file, text] of Object.entries(sources)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#metric-ids')).toHaveText('4');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('feature and module folder previews show scoped definitions, collisions and overrides without writes', async () => {
  await open(); await expect(editor().getByRole('button', { name: 'Preview folder features' })).toBeDisabled(); await add(); await preview();
  await expect(entries()).toHaveCount(3);
  const auth = entries().filter({ has: page.getByRole('heading', { name: 'authentication — new', exact: true }) });
  await expect(auth).toContainText('2 Markdown files · 2 assigned IDs'); await auth.locator('summary').click();
  await expect(auth).toContainText('FR-001 · specs/authentication'); await expect(auth).toContainText('FR-002 · specs/authentication');
  await expect(page.locator('#config-results')).not.toContainText('FR-999'); await expect(page.locator('#config-results')).not.toContainText('FR-003');
  await expect(entries().filter({ hasText: 'reporting — new' })).toContainText('Name collision');
  await page.locator('#config-tab-modules').click(); await add('modules'); await preview('modules');
  const moduleAuth = entries().filter({ hasText: 'authentication — new' }); await moduleAuth.locator('summary').click();
  await expect(moduleAuth).toContainText('Exact override preserved'); await expect(moduleAuth).toContainText('1 assigned IDs');
  expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual(config);
  for (const [file, text] of Object.entries(sources)) expect(await readFile(path.join(project, file), 'utf8')).toBe(text);
  await page.locator('#config-cancel').click(); await expect(page.locator('.feature-badge')).toHaveCount(0);
  await open(); await expect(editor().getByLabel('Folder pattern', { exact: true })).toHaveCount(0);
});

test('invalid patterns and overlaps fail; exclusions omit unstaged folders and settings save independently', async () => {
  await open(); await add(); await preview();
  await editor().getByLabel('Folder pattern', { exact: true }).fill('../specs/*'); await expect(entries()).toHaveCount(0);
  await editor().getByRole('button', { name: 'Preview folder features' }).click(); await expect(page.locator('#config-error')).toContainText('canonical');
  await editor().getByLabel('Folder pattern', { exact: true }).fill('specs/*'); await add();
  await editor().getByLabel('Folder pattern', { exact: true }).last().fill('specs/authentication/*');
  await editor().getByRole('button', { name: 'Preview folder features' }).click(); await expect(page.locator('#config-error')).toContainText('overlap');
  await editor().getByRole('button', { name: 'Remove folder pattern' }).last().click();
  await editor().getByLabel('Excluded folders (one per line)').fill('specs/reporting'); await preview();
  await expect(entries().filter({ hasText: 'reporting' })).toHaveCount(0);
  await expect(entries().filter({ hasText: 'authentication — new' })).toHaveCount(1);
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual({ ...config, folderGenerators: [{ key: 'generator1', target: 'features', pattern: 'specs/*', exclusions: ['specs/reporting'] }] });
});

test('source and configuration changes invalidate folder previews; reload and project switch discard session settings', async () => {
  await open(); await add(); await preview();
  await writeFile(path.join(project, 'specs/authentication/main.md'), '# FR-004 Changed\n');
  await expect(page.locator('#config-status')).toContainText('Markdown changed'); await expect(entries()).toHaveCount(0); await preview();
  await entries().filter({ hasText: 'authentication — new' }).locator('summary').click(); await expect(page.locator('#config-results')).toContainText('FR-004');
  await mkdir(path.join(project, 'specs/analytics'));
  await rename(path.join(project, 'specs/reporting/main.md'), path.join(project, 'specs/analytics/main.md'));
  await expect(page.locator('#config-status')).toContainText('Markdown changed'); await preview();
  await expect(entries().filter({ hasText: 'reporting' })).toHaveCount(0);
  await expect(entries().filter({ hasText: 'analytics — new' })).toHaveCount(1);
  await writeFile(file(), JSON.stringify({ ...config, features: [{ key: 'external', name: 'External' }] }));
  await expect(page.locator('#config-error')).toContainText('changed on disk'); await expect(entries()).toHaveCount(0);
  await expect(editor().getByRole('button', { name: 'Preview folder features' })).toBeDisabled();
  await page.locator('#config-reload').click(); await expect(editor().getByLabel('Folder pattern')).toHaveCount(0);
  await add(); await preview(); await page.locator('#config-cancel').click();
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'main.md'), '# REQ-1 Other\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other'); await open();
  await expect(editor().getByLabel('Folder pattern')).toHaveCount(0); await expect(entries()).toHaveCount(0);
});

test('folder controls and preview fit the minimum window in both themes', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    await open(); await add(); await expect(editor().getByLabel('Folder pattern', { exact: true })).toBeFocused();
    await editor().scrollIntoViewIfNeeded(); await page.screenshot({ path: `test-results/folder-generator-controls-${theme}.png` }); await preview();
    await entries().first().locator('summary').click();
    expect(await page.locator('#project-configuration-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/folder-generators-${theme}.png` }); await page.locator('#config-cancel').click();
  }
});
