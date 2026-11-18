import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';

/** Increment 100a: without design decisions, Focus draws tasks and their stories directly, in two columns. */
let app: ElectronApplication, page: Page;
const configuration = { version: 1, categories: [
  { key: 'story', name: 'User story', role: 'requirement' }, { key: 'task', name: 'Task', role: 'task' }, { key: 'test', name: 'Test' },
], rules: [{ key: 'story', category: 'story', prefix: 'US' }, { key: 'task', category: 'task', prefix: 'T' }, { key: 'test', category: 'test', prefix: 'ZS' }] };
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.cache/ui-tests/focus-layers-')), project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration));
  await writeFile(path.join(project, 'spec.md'), '# US-1 Sign in\n\n# US-2 Sign out\n');
  await writeFile(path.join(project, 'tasks.md'), '# T-1 Build the form\nFor US-1, tested by ZS-1.\n\n# T-2 Add sign-out\nFor US-2 after T-1.\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#metric-ids')).toHaveText('4');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('a task shows its story and a sibling task; the story shows its task; columns follow the layers in use', async () => {
  // The Lens list shows the direct story link and the link within the task layer.
  await page.locator('#id-search').fill('T-2');
  await page.getByRole('button', { name: 'Relationships for T-2', exact: true }).click();
  await expect(page.locator('.relationship-group')).toHaveCount(2);
  await expect(page.locator('.relationship-group[data-id="US-2"]')).toBeVisible();
  await expect(page.locator('.relationship-group[data-id="T-1"]')).toBeVisible();

  await page.getByRole('button', { name: 'Explore map for T-2', exact: true }).click();
  const frame = await pluginFrame(app); await expect(frame.locator('#relationship-focus')).toBeVisible();
  // Two columns: the stories' layer and the tasks' layer; no empty design column.
  await expect(frame.locator('.map-headings > strong')).toHaveText(['Requirements', 'Implementation tasks']);
  await expect(frame.locator('.map-node')).toHaveCount(3);
  const [story, focused, sibling] = await Promise.all(['US-2', 'T-2', 'T-1'].map(id => frame.locator(`.map-node[data-id="${id}"]`).boundingBox()));
  expect(story!.x + story!.width).toBeLessThan(focused!.x);
  expect(Math.abs(sibling!.x - focused!.x)).toBeLessThan(2);
  // The arrow keeps the authored direction: T-2 references US-2.
  await frame.getByRole('button', { name: 'Inspect connection T-2 and US-2', exact: true }).click();
  await expect(frame.locator('#map-evidence')).toContainText('T-2 references US-2');
  await frame.getByRole('button', { name: 'Inspect connection T-2 and T-1', exact: true }).click();
  await expect(frame.locator('#map-evidence')).toContainText('T-2 references T-1');
  await frame.locator('.map-graph').screenshot({ path: 'test-results/focus-layers.png' });

  await frame.locator('.map-node[data-id="US-2"]').getByRole('button', { name: 'Focus US-2', exact: true }).click();
  await expect(frame.locator('.map-node')).toHaveCount(2);
  await expect(frame.locator('.map-node[data-id="T-2"]')).toBeVisible();
  // ZS-1 belongs to a category with no role, so it is in no layer and stays out of Focus.
  await frame.locator('.map-node[data-id="T-2"]').getByRole('button', { name: 'Focus T-2', exact: true }).click();
  await frame.locator('.map-node[data-id="T-1"]').getByRole('button', { name: 'Focus T-1', exact: true }).click();
  await expect(frame.locator('.map-node[data-id="US-1"]')).toBeVisible();
  await expect(frame.locator('.map-node[data-id="ZS-1"]')).toHaveCount(0);
});
