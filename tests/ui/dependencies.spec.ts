import { failAutosave } from './autosave-fixture';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
const plugin = () => pluginFrame(app);
let app: ElectronApplication, page: Page, project: string, root: string;
const requirements = '# REQ-001 - First requirement\nREQ-002 and REQ-001.\n# REQ-002 - Second requirement\nNo outgoing links.\n# REQ-003 - Isolated\nNo links.\n';
const design = '# DD-001\nREQ-001 and DD-001, DD-002 and DD-002.\n# DD-002\nPH-001\n';
async function launch(extra: Record<string, string> = {}) {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/dependencies-'));
  project = path.join(root, 'project'); await mkdir(project);
  for (const [file, text] of Object.entries({ 'requirements.md': requirements, 'design.md': design.replace(/\n/g, '\r\n'), 'plan.md': '# PH-001\nDD-001 and Q-404\n', 'notes.md': 'Unowned REQ-999\n# Q-001\nAn open question.\n', ...extra })) await writeFile(path.join(project, file), text);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  const args = ['--project=' + project];
  app = await electron.launch({ ...(process.env.SPECULAR_TEST_PACKAGED ? { executablePath: path.resolve('out', `Specular-${process.platform}-${process.arch}`, 'Specular.exe'), args } : { args: ['.', ...args] }), env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await failAutosave(app); await expect(page.locator('#lens-results .lens-card').first()).toBeVisible();
}
async function overview() {
  await page.getByRole('button', { name: 'Dependency overview', exact: true }).click();
  await expect((await plugin()).locator('#dependency-overview')).toBeVisible(); await expect((await plugin()).locator('.dependency-summary')).toBeVisible();
}
const inspect = async (id: string) => { await (await plugin()).getByRole('button', { name: 'Fit all', exact: true }).click(); await (await plugin()).getByRole('button', { name: `Inspect ${id}`, exact: true }).click(); };
const inspector = async () => (await plugin()).locator('#dependency-inspector');
test.afterEach(async ({}, info) => {
  if (app) { if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('overview invocation shows the complete visual graph, filters preserve cross-file context, and source return preserves state', async () => {
  await launch(); await overview(); await expect((await plugin()).locator('.dependency-summary')).toContainText('8 IDs / 8 directed connections / 9 source mentions');
  await expect((await plugin()).locator('.dependency-graph-node')).toHaveCount(8);
  await expect((await plugin()).locator('.dependency-graph-edge')).toHaveCount(8);
  await expect((await plugin()).locator('.dependency-graph-cluster')).toHaveCount(5);
  await expect((await plugin()).locator('.dependency-node')).toHaveCount(8);
  await (await plugin()).locator('.dependency-scope summary').click(); await expect((await plugin()).locator('.dependency-scope')).toContainText('1 unowned mentions');
  await (await plugin()).locator('#dependency-file').selectOption('requirements.md'); await (await plugin()).locator('#dependency-kind').selectOption('REQ');
  await expect((await plugin()).locator('.dependency-summary')).toContainText('Filters match 3 IDs and 3 incident connections');
  await inspect('REQ-001'); await expect(await inspector()).toContainText('Incoming (2)'); await expect(await inspector()).toContainText('Outgoing (2)');
  const edge = (await inspector()).locator('[data-edge="DD-001>REQ-001"]').first(); await edge.press('Enter');
  await expect((await plugin()).locator('#dependency-evidence')).toContainText('DD-001 references REQ-001');
  await (await plugin()).locator('.dependency-evidence-source').click(); await expect(page.locator('#document-path')).toHaveText('design.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('REQ-001');
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click();
  await expect((await plugin()).locator('#dependency-overview')).toBeVisible(); await expect((await plugin()).locator('#dependency-file')).toHaveValue('requirements.md'); await expect((await plugin()).locator('#dependency-kind')).toHaveValue('REQ');
  await expect((await plugin()).locator('#dependency-evidence')).toContainText('DD-001 references REQ-001');
  await page.getByRole('button', { name: 'Focus', exact: true }).click(); await expect((await plugin()).locator('#map-focus')).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click(); await expect((await plugin()).locator('#dependency-file')).toHaveValue('requirements.md');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(requirements);
});

test('incoming and outgoing multi-hop paths preserve authored direction, expose every hop, and terminate cycles', async () => {
  await launch(); await overview(); await inspect('PH-001');
  await (await plugin()).getByRole('button', { name: 'Trace to REQ-002', exact: true }).click();
  await expect((await plugin()).locator('.dependency-route')).toHaveText('PH-001 \u2192 DD-001 \u2192 REQ-001 \u2192 REQ-002'); await expect((await plugin()).locator('.dependency-hop')).toHaveCount(3);
  await (await plugin()).locator('.dependency-hop').nth(1).click(); await expect((await plugin()).locator('#dependency-evidence')).toContainText('DD-001 references REQ-001');
  await inspect('REQ-002'); await (await plugin()).locator('#dependency-direction').selectOption('incoming');
  await (await plugin()).getByRole('button', { name: 'Trace to DD-002', exact: true }).click();
  await expect((await plugin()).locator('.dependency-route')).toHaveText('DD-002 \u2192 PH-001 \u2192 DD-001 \u2192 REQ-001 \u2192 REQ-002');
  await expect((await plugin()).locator('.dependency-path-target')).toHaveCount(4);
  await (await plugin()).locator('.dependency-hop').first().click(); await (await plugin()).locator('.dependency-evidence-source').click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('PH-001');
});

test('isolated, missing, and duplicate definitions are explicit; ambiguous definitions cannot be used as path intermediates', async () => {
  await launch({ 'duplicate.md': '# DD-001\nQ-001.\n' }); await overview();
  await inspect('REQ-003'); await expect(await inspector()).toContainText('Incoming (0)'); await expect(await inspector()).toContainText('Outgoing (0)');
  await inspect('Q-404'); await expect(await inspector()).toContainText('Missing definition'); await expect((await inspector()).getByRole('button', { name: 'Open Q-404 definition' })).toHaveCount(0);
  await inspect('DD-001'); await expect(await inspector()).toContainText('2 definitions; ambiguous'); await expect((await inspector()).getByRole('button', { name: 'Open DD-001 definition' })).toHaveCount(0);
  await inspect('PH-001'); await expect((await plugin()).getByRole('button', { name: 'Trace to DD-001', exact: true })).toBeVisible();
  await expect((await plugin()).getByRole('button', { name: 'Trace to REQ-001', exact: true })).toHaveCount(0);
  await (await inspector()).locator('[data-edge="PH-001>DD-001"]').first().click(); await expect((await plugin()).locator('#dependency-evidence')).toContainText('DD-001: 2 definitions; ambiguous');
});

test('unsaved edits invalidate old evidence and refresh the complete graph and paths without saving', async () => {
  await launch(); await page.locator('[data-file="requirements.md"]').click(); await overview(); await inspect('REQ-001');
  await (await inspector()).locator('[data-edge="REQ-001>REQ-002"]').first().click();
  await (await plugin()).locator('.dependency-evidence-source').evaluate(button => { (globalThis as any).oldDependencyEvidence = button; });
  await page.getByRole('tab', { name: 'requirements.md', exact: true }).click();
  await page.locator('#editor .cm-content').fill(requirements.replace('REQ-002 and REQ-001.', 'Q-002.'));
  await expect.poll(() => app.context().pages().filter(p => p.url().includes('/custom.html')).length).toBe(0);
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click(); await expect((await plugin()).locator('.dependency-summary')).toContainText('9 IDs / 7 directed connections');
  await expect((await plugin()).locator('.dependency-edge[data-edge="REQ-001>REQ-002"]')).toHaveCount(0);
  await (await inspector()).locator('[data-edge="REQ-001>Q-002"]').click(); await (await plugin()).locator('.dependency-evidence-source').click();
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/); expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('Q-002');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(requirements);
});

test('large graphs render every node and edge, retain camera state, support search, and reset on project switch', async () => {
  await launch({ 'large.md': Array.from({ length: 45 }, (_, i) => `# AT-${100 + i}\nREQ-001\n`).join('\n') }); await overview();
  await expect((await plugin()).locator('.dependency-summary')).toContainText('53 IDs / 53 directed connections');
  await expect((await plugin()).locator('.dependency-graph-node')).toHaveCount(53); await expect((await plugin()).locator('.dependency-graph-edge')).toHaveCount(53);
  const transform = async () => (await plugin()).locator('.dependency-graph-stage > svg > g').getAttribute('transform');
  const before = await transform(); await (await plugin()).getByRole('button', { name: 'Zoom in', exact: true }).click(); expect(await transform()).not.toBe(before);
  const stage = (await plugin()).locator('.dependency-graph-stage'); await stage.focus(); const zoomed = await transform(); await stage.press('ArrowRight'); expect(await transform()).not.toBe(zoomed);
  await stage.scrollIntoViewIfNeeded(); const box = (await stage.boundingBox())!;
  const beforeDrag = await transform(); await (await plugin()).page().mouse.move(box.x + 5, box.y + 5); await (await plugin()).page().mouse.down(); await (await plugin()).page().mouse.move(box.x + 35, box.y + 25); await (await plugin()).page().mouse.up(); expect(await transform()).not.toBe(beforeDrag);
  const moved = await transform(); await page.getByRole('tab', { name: 'design.md', exact: true }).click(); await page.getByRole('tab', { name: 'Relationships', exact: true }).click(); expect(await transform()).toBe(moved);
  await expect((await plugin()).locator('.dependency-graph-node')).toHaveCount(53); await expect((await plugin()).locator('.dependency-graph-edge')).toHaveCount(53);
  await (await plugin()).locator('#dependency-search').fill('AT-144'); await expect((await plugin()).locator('.dependency-summary')).toContainText('Filters match 1 IDs and 1 incident connections'); await inspect('AT-144');
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'requirements.md'), '# REQ-999\nOther project.\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other'); await expect(page.getByRole('tab', { name: 'Relationships', exact: true })).toHaveCount(0);
  await overview(); await expect((await plugin()).locator('.dependency-summary')).toContainText('1 IDs / 0 directed connections'); await expect((await plugin()).locator('#dependency-search')).toHaveValue('');
});

test('real project overview fits the minimum window and external edits remove selected paths and stale evidence', async () => {
  test.skip(!existsSync('plan.md'), 'The development documents are not part of the public distribution.');
  await launch({ 'requirements.md': await readFile('requirements.md', 'utf8'), 'design.md': await readFile('design.md', 'utf8'), 'plan.md': await readFile('plan.md', 'utf8') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720)); await overview();
  expect(await page.locator('[aria-label="Relationships view"]').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await (await plugin()).locator('.dependency-graph-stage').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/dependency-overview-minimum.png' });
  await (await plugin()).locator('#dependency-search').fill('DD-031'); await inspect('DD-031');
  await (await inspector()).locator('[data-edge="DD-031>REQ-127"]').first().click(); await expect((await plugin()).locator('.dependency-evidence-source').first()).toBeVisible();
  await writeFile(path.join(project, 'design.md'), '# DD-031\nNo references.\n');
  await expect((await plugin()).locator('[data-edge="DD-031>REQ-127"]')).toHaveCount(0); await expect((await plugin()).locator('.dependency-evidence-source')).toHaveCount(0);
  await (await plugin()).locator('#dependency-search').fill('does-not-exist'); await expect((await plugin()).locator('.dependency-status')).toHaveText('No IDs match these filters.');
});


test('graph nodes and links expose details with pointer and keyboard, including self-links', async () => {
  await launch(); await overview(); await inspect('REQ-001');
  await expect((await plugin()).locator('.dependency-graph-node[data-graph-id="REQ-001"]')).toHaveAttribute('aria-pressed', 'true');
  await expect((await plugin()).locator('.dependency-graph-edge.selected')).toHaveCount(3);
  await (await plugin()).getByRole('button', { name: 'Fit all', exact: true }).click();
  const edge = (await plugin()).getByRole('button', { name: 'Inspect connection REQ-001 to REQ-001', exact: true });
  await (await plugin()).locator('.dependency-graph-stage').scrollIntoViewIfNeeded();
  const point = await edge.locator('.dependency-graph-line').evaluate(element => {
    const line = element as SVGPathElement, point = line.getPointAtLength(line.getTotalLength() / 2), matrix = line.getScreenCTM()!;
    return { x: matrix.a * point.x + matrix.c * point.y + matrix.e, y: matrix.b * point.x + matrix.d * point.y + matrix.f };
  });
  await (await plugin()).page().mouse.click(point.x, point.y);
  await expect((await plugin()).locator('#dependency-evidence')).toContainText('REQ-001 references REQ-001');
  await (await plugin()).getByRole('button', { name: 'Inspect connection DD-001 to DD-002', exact: true }).press('Enter');
  await expect((await plugin()).locator('#dependency-evidence')).toContainText('DD-001 references DD-002'); await expect((await plugin()).locator('.dependency-evidence-source')).toHaveCount(2);
  await (await plugin()).locator('.dependency-evidence-source').first().click(); expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('DD-002');
});

test('overview includes authored tasks, direct requirement and task links, and unlinked tasks', async () => {
  await launch({ 'tasks.md': '# TASK-001\nDD-001, REQ-001 and TASK-002.\n# TASK-002\nTASK-001.\n# TASK-003\nUnlinked.\n' }); await overview();
  await (await plugin()).locator('#dependency-kind').selectOption('TASK');
  await expect((await plugin()).locator('.dependency-summary')).toContainText('Filters match 3 IDs and 4 incident connections');
  await inspect('TASK-001'); await expect(await inspector()).toContainText('Outgoing (3)');
  await (await inspector()).locator('[data-edge="TASK-001>REQ-001"]').first().click();
  await expect((await plugin()).locator('#dependency-evidence')).toContainText('TASK-001 references REQ-001');
  await (await plugin()).locator('.dependency-evidence-source').click();
  await expect(page.locator('#document-path')).toHaveText('tasks.md');
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click(); await inspect('TASK-003');
  await expect(await inspector()).toContainText('Incoming (0)'); await expect(await inspector()).toContainText('Outgoing (0)');
});

test('registered view modes preserve camera on close/reopen and source navigation reveals a hidden editor', async () => {
  await launch(); await page.locator('[data-file="requirements.md"]').click();
  await page.locator('#toggle-source').click(); await expect(page.locator('#source-panel')).toBeHidden();
  await overview(); await inspect('REQ-001');
  await (await plugin()).getByRole('button', { name: 'Zoom in', exact: true }).click();
  const camera = await (await plugin()).locator('.dependency-graph-stage svg > g').getAttribute('transform');
  await page.getByRole('button', { name: 'Close Relationships', exact: true }).click();
  await overview();
  await expect((await plugin()).locator('.dependency-graph-stage svg > g')).toHaveAttribute('transform', camera!);
  await expect(await inspector()).toContainText('REQ-001');
  await (await inspector()).locator('[data-edge="DD-001>REQ-001"]').first().click();
  await (await plugin()).locator('.dependency-evidence-source').click();
  await expect(page.locator('#document-path')).toHaveText('design.md'); await expect(page.locator('#source-panel')).toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('REQ-001');
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect((await plugin()).locator('#dependency-evidence')).toContainText('DD-001 references REQ-001');
});

test('opening a registered mode invalidates a pending source read', async () => {
  const late = '# DD-005\nREQ-001.\n';
  await launch({ 'late.md': late }); await overview(); await inspect('DD-005');
  await app.evaluate(({ ipcMain }, text) => {
    ipcMain.removeHandler('document:read');
    ipcMain.handle('document:read', async (_event, file) => {
      (globalThis as any).pendingViewRead = file;
      await new Promise<void>(resolve => { (globalThis as any).releaseViewRead = resolve; });
      return { path: file, text, version: 'test-version' };
    });
  }, late);
  await (await inspector()).locator('[data-edge="DD-005>REQ-001"]').first().click();
  await (await plugin()).locator('.dependency-evidence-source').click();
  await expect.poll(() => app.evaluate(() => (globalThis as any).pendingViewRead)).toBe('late.md');
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await app.evaluate(() => (globalThis as any).releaseViewRead());
  // Flush the completed IPC before checking that its old destination did not become active.
  await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 100)));
  await expect(page.locator('[aria-label="Relationships view"]')).toBeVisible();
  await expect((await plugin()).locator('#map-focus')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'late.md', exact: true })).toHaveCount(0);
});
