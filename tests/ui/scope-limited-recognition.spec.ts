import { failAutosave } from './autosave-fixture';
import { selectConfigurationTab } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

// Increment 90: a category recognized only inside its scopes, and defined only in some files.
let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1,
  idDefinitionSites: { headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: true, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered', 'ordered'], mode: 'start' } },
  categories: [{ key: 'tasks', name: 'Tasks', role: 'task', idScopes: [{ pattern: 'specs/*' }] }],
  rules: [{ key: 'tasks', category: 'tasks', prefix: 'T', separator: '' }] };
const dialog = () => page.locator('#project-configuration-dialog');
async function preview() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); }
const saved = async () => JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/scope-limited-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await mkdir(path.join(project, 'specs/001-a'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config));
  await writeFile(path.join(project, 'specs/001-a/tasks.md'), '# Tasks\n\n- T001 Build the parser\n');
  await writeFile(path.join(project, 'specs/001-a/plan.md'), '# Plan\n\n- T001 Build the parser (summary)\n');
  await writeFile(path.join(project, 'README.md'), '# Readme\n\nSee T001 and T009.\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#metric-ids')).toHaveText('2'); await failAutosave(app);
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('recognize only inside scopes and define only in some files, with preview and apply', async () => {
  await page.locator('#project-config-open').click(); await selectConfigurationTab(page, 'categories');
  await preview();
  await expect(page.locator('#config-summary')).toContainText('2 duplicate definitions');
  await expect(page.locator('#config-summary')).toContainText('2 unresolved references');
  const tasks = page.locator('.config-category').first();
  await expect(tasks.locator('.config-scope-coverage')).toContainText('Rules match in every file');
  await tasks.getByLabel('Recognize only inside these scopes').check();
  await expect(tasks.locator('.config-scope-coverage')).toHaveText('Covers 2 of 3 indexed Markdown files.');
  await tasks.locator('.config-category-definition-sites > summary').click();
  const paths = tasks.getByLabel('Define only in', { exact: true });
  await paths.fill('specs/{x}/tasks.md');
  await expect(tasks.locator('.config-definition-paths-coverage')).toContainText('Fix the patterns');
  await preview().catch(() => {});
  await expect(page.locator('#config-error')).toContainText('Definition path');
  await paths.fill('specs/*/tasks.md');
  await expect(tasks.locator('.config-definition-paths-coverage')).toHaveText('Covers 1 of 3 indexed Markdown files.');
  await preview();
  await expect(page.locator('#config-summary')).toContainText('1 definitions · 1 references · 0 unresolved references');
  await expect(page.locator('#config-summary')).toContainText('0 duplicate definitions');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('1');
  expect((await saved()).categories[0]).toMatchObject({ key: 'tasks', onlyInScopes: true, definitionPaths: ['specs/*/tasks.md'] });
});
