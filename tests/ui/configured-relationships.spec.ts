import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
import type { IdConfiguration } from '../../src/core/id-configuration';
let app: ElectronApplication, page: Page, root: string, project: string;
const configuration: IdConfiguration = { version: 1, categories: [
  { key: 'needs', name: 'Business needs', role: 'requirement' }, { key: 'architecture', name: 'Architecture', role: 'design' },
  { key: 'work', name: 'Work items', role: 'task' }, { key: 'notes', name: 'Notes' },
], rules: [
  { key: 'ref', category: 'needs', prefix: 'REF' }, { key: 'need', category: 'needs', prefix: 'NEED', separator: '' },
  { key: 'dec', category: 'architecture', prefix: 'DEC' }, { key: 'work', category: 'work', prefix: 'WORK' },
  { key: 'lower', category: 'work', pattern: 'work/\\d+' }, { key: 'notes', category: 'notes', prefix: 'REQ' },
] };
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/configured-'));
  project = path.join(root, 'project'); await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration));
  await writeFile(path.join(project, 'a.md'), '# REF-01 Need\nDEC-1\n# NEED02 Another need\nDEC-1\n# REQ-1 Note\nDEC-1\n');
  await writeFile(path.join(project, 'b.md'), '# DEC-1 Design\nREF-01 NEED02 WORK-1 work/2 WORK-404 REQ-1\n');
  await writeFile(path.join(project, 'c.md'), '# WORK-1 Task\nDEC-1\n# work/2 Another task\nDEC-1\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#metric-ids')).toHaveText('6');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
});
async function focus(id: string) {
  await page.locator('#id-search').fill(id);
  await page.getByRole('button', { name: `Explore map for ${id}`, exact: true }).click();
  const frame = await pluginFrame(app); await expect(frame.locator('#relationship-focus')).toBeVisible(); return frame;
}
test('custom categories expose both hops and navigate to exact cross-file evidence', async () => {
  await page.locator('#id-search').fill('REQ-1');
  await expect(page.getByRole('button', { name: 'Relationships for REQ-1', exact: true })).toHaveCount(0);
  await page.locator('#id-search').fill('REF-01');
  await page.getByRole('button', { name: 'Relationships for REF-01', exact: true }).click();
  await expect(page.locator('.relationship-group[data-id="DEC-1"]')).toBeVisible();
  let frame = await focus('REF-01');
  await expect(frame.locator('.map-node[data-id="DEC-1"]')).toContainText('Architecture');
  await expect(frame.locator('.map-node[data-id="WORK-1"]')).toBeVisible();
  await expect(frame.locator('.map-node[data-id="WORK-404"]')).toContainText('Missing definition');
  await frame.locator('.map-connection[data-id="WORK-1"]').click();
  await expect(frame.locator('#map-evidence')).toContainText('Evidence: DEC-1 / WORK-1');
  await frame.locator('#map-evidence .map-evidence-source').first().click();
  await expect(page.locator('#document-path')).toHaveText('b.md');
  frame = await focus('REF-01');
  await frame.getByRole('button', { name: 'Open WORK-1 definition', exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText('c.md');
  frame = await focus('REF-01');
  await frame.locator('#map-focus').fill('work/2'); await frame.locator('#map-focus').press('Enter');
  await expect(frame.locator('.map-node.focused')).toHaveAttribute('data-id', 'work/2');
  await expect(frame.locator('.map-node[data-id="REF-01"]')).toBeVisible();
  await frame.locator('.map-graph').scrollIntoViewIfNeeded();
  await frame.page().screenshot({ path: 'test-results/configured-relationships.png' });
});
test('Overview groups multiple prefixes by category and retains role-free IDs', async () => {
  await page.locator('#dependency-overview-open').click(); const frame = await pluginFrame(app);
  await expect(frame.locator('#dependency-overview')).toBeVisible();
  await frame.locator('#dependency-kind').selectOption('needs');
  await expect(frame.locator('#dependency-kind option:checked')).toHaveText('Business needs');
  await expect(frame.locator('.dependency-summary')).toContainText('2');
  await frame.locator('#dependency-kind').selectOption('notes');
  await expect(frame.locator('.dependency-graph-node[data-graph-id="REQ-1"]')).toBeVisible();
  await expect(frame.locator('#dependency-kind option:checked')).toHaveText('Notes');
});
test('role changes refresh open Focus and reject a previously captured source action', async () => {
  const frame = await focus('REF-01');
  await frame.getByRole('button', { name: 'Open DEC-1 definition', exact: true }).evaluate(button => { (window as any).oldSource = button; });
  const changed = structuredClone(configuration); delete changed.categories[0].role;
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(changed)); await page.locator('#refresh').click();
  await expect(frame.locator('.map-status')).toContainText('Choose an ID with a requirement, design or task role');
  await frame.evaluate(() => (window as any).oldSource.click());
  await expect(page.locator('#document-path')).toHaveText('a.md');
  await expect(frame.locator('#relationship-focus')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Explore map for REF-01', exact: true })).toHaveCount(0);
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration)); await page.locator('#refresh').click();
  await expect(frame.locator('.map-node[data-id="DEC-1"]')).toBeVisible();
  await writeFile(path.join(project, 'b.md'), '# DEC-1 Design\nWORK-1\n# DEC-1 Duplicate\nWORK-1\n'); await page.locator('#refresh').click();
  await expect(frame.locator('.map-node[data-id="DEC-1"]')).toContainText('2 definitions');
  await expect(frame.locator('.map-node[data-id="WORK-1"]')).toHaveCount(0);
});

test('ID picker reopens after Explore and supports browsing, searching, and keyboard selection', async () => {
  const frame = await focus('REF-01'); const input = frame.locator('#map-focus');
  await frame.getByRole('button', { name: 'Explore', exact: true }).click();
  await frame.getByRole('button', { name: 'Show IDs', exact: true }).click();
  await expect(frame.getByRole('listbox', { name: 'Focus IDs' })).toBeVisible();
  await expect(frame.getByRole('option', { name: /^NEED02/ })).toBeVisible();
  await frame.getByRole('option', { name: /^NEED02/ }).click(); await expect(input).toHaveValue('NEED02');
  await frame.getByRole('button', { name: 'Explore', exact: true }).click();
  await expect(frame.locator('.map-node.focused')).toHaveAttribute('data-id', 'NEED02');
  await input.click(); await expect(frame.getByRole('option', { name: /^REF-01/ })).toBeVisible();
  await input.fill('work/'); await expect(frame.locator('#map-ids').getByRole('option')).toHaveCount(1);
  await input.press('ArrowDown'); await input.press('Enter'); await expect(input).toHaveValue('work/2');
  await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.press('Enter'); await expect(frame.locator('.map-node.focused')).toHaveAttribute('data-id', 'work/2');
  await input.press('ArrowUp'); await expect(input).toHaveAttribute('aria-expanded', 'true');
  await expect(frame.locator('#map-ids [aria-selected=true]')).toHaveText(await frame.locator('#map-ids [role=option]').last().textContent() ?? '');
  await input.press('Escape'); await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.click(); await input.press('Tab'); await expect(input).toHaveAttribute('aria-expanded', 'false');
  await frame.getByRole('button', { name: 'Show IDs', exact: true }).click();
  await frame.locator('h2').click(); await expect(input).toHaveAttribute('aria-expanded', 'false');
  await input.fill('does-not-exist'); await expect(frame.locator('.map-picker-notice')).toContainText('No matching IDs');
  await input.press('Enter'); await expect(frame.locator('.map-status')).toContainText('No owned');
  await frame.getByRole('button', { name: 'Show IDs', exact: true }).click();
  await expect(frame.getByRole('option', { name: /^REF-01/ })).toBeVisible();
  expect(await frame.locator('#map-ids').evaluate(list => list.getBoundingClientRect().bottom <= document.querySelector('#relationship-focus')!.getBoundingClientRect().bottom)).toBe(true);
  await frame.page().screenshot({ path: 'test-results/relationships-id-picker.png' });
});
