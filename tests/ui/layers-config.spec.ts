import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
import { expandDiscoveryMethods, selectConfigurationTab } from './configuration-entries';

/** Increment 100b: configured layers place a category without a role in Focus, in a named column. */
let app: ElectronApplication, page: Page, project: string;
const configuration = { version: 1, categories: [
  { key: 'story', name: 'User story', role: 'requirement' }, { key: 'task', name: 'Task', role: 'task' }, { key: 'test', name: 'Test' },
], rules: [{ key: 'story', category: 'story', prefix: 'US' }, { key: 'task', category: 'task', prefix: 'T' }, { key: 'test', category: 'test', prefix: 'ZS' }] };
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.cache/ui-tests/layers-config-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration));
  await writeFile(path.join(project, 'specs.md'), '# US-1 Sign in\n\n# T-1 Build the form\nFor US-1, tested by ZS-1.\n\n# ZS-1 Form test\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#metric-ids')).toHaveText('3');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});
async function open() {
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
  await selectConfigurationTab(page, 'categories');
}
async function apply() {
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
}
async function focus(id: string) {
  await page.locator('#id-search').fill(id);
  await page.getByRole('button', { name: `Explore map for ${id}`, exact: true }).click();
  const frame = await pluginFrame(app); await expect(frame.locator('#relationship-focus')).toBeVisible(); return frame;
}

test('customized layers name the columns and bring a test category into Focus; Use roles returns to the default', async () => {
  // By default the test category has no role, so Focus on T-1 shows only its story.
  let frame = await focus('T-1');
  await expect(frame.locator('.map-headings > strong')).toHaveText(['Requirements', 'Implementation tasks']);
  await expect(frame.locator('.map-node[data-id="ZS-1"]')).toHaveCount(0);

  await open();
  const layers = page.locator('#config-layers');
  await expect(layers.locator('#config-layers-summary')).toHaveText("From the categories' roles: Requirements (User story); Implementation tasks (Task).");
  await layers.getByRole('button', { name: 'Customize layers', exact: true }).click();
  await layers.getByLabel('Layer 1 name', { exact: true }).fill('Needs');
  await layers.getByRole('button', { name: 'Add layer', exact: true }).click();
  await expect(layers.locator('#config-layers-warning')).toContainText('Layer 3');
  await layers.getByLabel('Layer 3 name', { exact: true }).fill('Tests');
  await layers.getByLabel('Layer for Test', { exact: true }).selectOption({ label: 'Tests' });
  await expect(layers.locator('#config-layers-warning')).toBeHidden();
  await expect(layers.getByLabel('Layer for User story', { exact: true })).toHaveValue('0');
  await apply();
  expect(JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')).layers).toEqual([
    { name: 'Needs', categories: ['story'] }, { name: 'Implementation tasks', categories: ['task'] }, { name: 'Tests', categories: ['test'] }]);

  frame = await focus('T-1');
  await expect(frame.locator('.map-headings > strong')).toHaveText(['Needs', 'Implementation tasks', 'Tests']);
  const [story, task, check] = await Promise.all(['US-1', 'T-1', 'ZS-1'].map(id => frame.locator(`.map-node[data-id="${id}"]`).boundingBox()));
  expect(story!.x + story!.width).toBeLessThan(task!.x); expect(task!.x + task!.width).toBeLessThan(check!.x);
  await frame.getByRole('button', { name: 'Inspect connection T-1 and ZS-1', exact: true }).click();
  await expect(frame.locator('#map-evidence')).toContainText('T-1 references ZS-1');

  // Reordering moves the column; Use roles removes the layers again.
  await open();
  await layers.getByRole('button', { name: 'Move up Tests', exact: true }).click();
  await apply();
  frame = await focus('T-1');
  await expect(frame.locator('.map-headings > strong')).toHaveText(['Needs', 'Tests', 'Implementation tasks']);
  await open();
  await layers.getByRole('button', { name: 'Use roles', exact: true }).click();
  await expect(layers.locator('#config-layers-summary')).toBeVisible();
  await apply();
  expect(JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')).layers).toBeUndefined();
});
