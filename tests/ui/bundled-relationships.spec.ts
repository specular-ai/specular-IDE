import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';

let app: ElectronApplication, page: Page, root: string, project: string;
const content = '# REQ-001 - First\nDD-001\n# DD-001 - Design\nREQ-001 TASK-001 DD-001 REQ-404\n# TASK-001 - Build\nDD-001\n# REQ-002 - Isolated\n';
async function launch(restart = false) {
  if (!restart) {
    await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/bundled-'));
    project = path.join(root, 'project'); await mkdir(project); await writeFile(path.join(project, 'requirements.md'), content);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  const args = ['--project=' + project];
  app = await electron.launch({ ...(process.env.SPECULAR_TEST_PACKAGED ? { executablePath: path.resolve('out', `Specular-${process.platform}-${process.arch}`, 'Specular.exe'), args } : { args: ['.', ...args] }), env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#lens-results .lens-card').first()).toBeVisible();
}
async function custom(script: string) {
  return app.evaluate(async ({ webContents }, script) => {
    const view = webContents.getAllWebContents().find(w => w.getURL().includes('/custom.html'));
    const frame = view?.mainFrame.frames.find(f => f.url.startsWith('specular-plugin-ui://'));
    // The frame URL can be available before its document body during crash recovery.
    if (!frame || !(await frame.executeJavaScript('!!document.body'))) return undefined;
    return frame.executeJavaScript(script);
  }, script);
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); await close().catch(() => {}); });

test('Codex chat and nested dialogs cover focused Relationships and restore its native surface', async () => {
  await launch(); await page.locator('#dependency-overview-open').click();
  const frame = await pluginFrame(app);
  await frame.getByRole('button', { name: 'Zoom in', exact: true }).click();
  const camera = await frame.locator('.dependency-graph-controls span').textContent();
  const surfaces = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.filter(v => (v as any).webContents?.getURL().includes('/custom.html')).map(v => ({ visible: v.getVisible(), id: (v as any).webContents.id })));
  const initial = await surfaces();
  const plugin = initial[0];
  expect(plugin.visible).toBe(true);
  await page.locator('#show-conversation').click();
  await expect(page.locator('#codex-conversation-dialog')).toBeVisible();
  await expect.poll(async () => (await surfaces()).find(v => v.id === plugin.id)?.visible).toBe(false);
  await page.locator('#conversation-prompt').fill('A local draft');
  await page.screenshot({ path: 'test-results/relationships-chat-on-top.png' });
  // A plugin update acknowledgement must not reveal the native view over a dialog.
  await page.evaluate(() => { (document.querySelector('#theme-switch') as HTMLButtonElement).click(); });
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  expect((await surfaces()).find(v => v.id === plugin.id)?.visible).toBe(false);
  await page.locator('#conversation-setup').click();
  await expect(page.locator('#agent-setup-dialog')).toBeVisible();
  expect((await surfaces()).find(v => v.id === plugin.id)?.visible).toBe(false);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await surfaces()).find(v => v.id === plugin.id)?.visible).toBe(true);
  await expect(frame.locator('.dependency-graph-controls span')).toHaveText(camera!);
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  const focus = await pluginFrame(app); await focus.locator('#plugin-root').click({ position: { x: 10, y: 10 } });
  await page.locator('#show-conversation').click();
  await expect(page.locator('#conversation-prompt')).toHaveValue('A local draft');
  await expect.poll(async () => (await surfaces()).every(v => !v.visible)).toBe(true);
  await page.locator('#conversation-hide').click();
  await expect.poll(async () => (await surfaces()).some(v => v.visible)).toBe(true);
  await expect(focus.locator('#relationship-focus')).toBeVisible();
});

test('bundled Focus and Overview preserve evidence, complete graph, and session state', async () => {
  await launch();
  await page.getByRole('button', { name: 'Explore map for REQ-001', exact: true }).click();
  await expect.poll(() => custom('document.body.innerText')).toContain('TASK-001');
  await custom("document.querySelector('[data-id=\"DD-001\"].map-connection').click()");
  await expect.poll(() => custom('document.body.innerText')).toContain('Evidence: REQ-001 / DD-001');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect.poll(() => app.evaluate(async ({ webContents }) => Promise.all(webContents.getAllWebContents().filter(w => w.getURL().includes('/custom.html')).map(async w => ({ url: w.getURL(), text: await w.mainFrame.frames.find(f => f.url.startsWith('specular-plugin-ui://'))?.executeJavaScript('document.body.innerText') }))))).toEqual(expect.arrayContaining([expect.objectContaining({ text: expect.stringContaining('Project dependencies') })]));
  await expect.poll(() => custom('document.querySelectorAll(".dependency-graph-node").length')).toBe(5);
  await expect.poll(() => custom('document.querySelector(".dependency-summary")?.textContent')).toContain('6 directed connections');
  await custom("document.querySelector('.dependency-graph-node[data-graph-id=\"DD-001\"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))");
  await expect.poll(() => custom('document.body.innerText')).toContain('DD-001 - Full-model connections');
  await custom("[...document.querySelectorAll('button')].find(b=>b.textContent==='Zoom in').click()");
  const camera = await custom("document.querySelector('.dependency-graph-controls span').textContent");
  await custom("[...document.querySelectorAll('button')].find(b=>b.textContent==='Open DD-001 definition').click()");
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  await page.locator('#dependency-overview-open').click();
  await expect.poll(() => custom('document.body.innerText')).toContain('DD-001 - Full-model connections');
  await expect.poll(() => custom("document.querySelector('.dependency-graph-controls span')?.textContent")).toBe(camera);
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await expect.poll(() => custom('document.body.innerText')).toContain('Evidence: REQ-001 / DD-001');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(content);
  await page.screenshot({ path: 'test-results/bundled-relationships.png' });
  await (await pluginFrame(app)).page().screenshot({ path: 'test-results/bundled-relationships-surface.png' });
});

test('bundled crash retry, explicit replacement and restoration use the ordinary isolated runtime', async () => {
  await launch(); await page.locator('#dependency-overview-open').click();
  await expect.poll(() => custom('document.body.innerText')).toContain('Project dependencies');
  await app.evaluate(({ webContents }) => { const view = webContents.getAllWebContents().find(w => w.getURL().includes('/custom.html'))!; setTimeout(() => view.forcefullyCrashRenderer(), 0); });
  await expect(page.locator('.plugin-custom-host:visible > [role=status]')).toContainText('process stopped');
  await page.getByRole('button', { name: 'Close Relationships', exact: true }).click(); await page.locator('#dependency-overview-open').click();
  await expect.poll(() => custom('document.body.innerText')).toContain('Project dependencies');
  await page.getByRole('button', { name: 'Close Relationships', exact: true }).click();
  const replacement = path.join(root, 'replacement'); await mkdir(replacement);
  const manifest = JSON.parse(await readFile('bundled-plugins/relationships/specular-plugin.json', 'utf8'));
  await writeFile(path.join(replacement, 'specular-plugin.json'), JSON.stringify({ ...manifest, version: '2.0.0', entry: 'index.js' }));
  await writeFile(path.join(replacement, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(replacement, 'index.js'), 'export function activate(){throw new Error("failed replacement")}');
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); }, replacement);
  await page.locator('#plugin-view-open').click();
  await expect(page.locator('.plugin-custom-host:visible > [role=status]')).toContainText('failed');
  await page.locator('#plugin-manager-open').click();
  const row = page.locator('.plugin-manager-item').filter({ hasText: 'specular.relationships' });
  await expect(row).toContainText('Installed replacement');
  await row.getByRole('button', { name: 'Restore bundled version', exact: true }).click(); await expect(row).toContainText('Bundled');
  await page.locator('#plugin-manager-close').click(); await page.locator('#dependency-overview-open').click();
  await expect.poll(() => custom('document.querySelectorAll(".dependency-graph-node").length')).toBe(5);
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(content);
});

test('disable survives restart and restoration keeps the explicit disabled preference', async () => {
  await launch(); await page.locator('#plugin-manager-open').click();
  const row = page.locator('.plugin-manager-item').filter({ hasText: 'specular.relationships' });
  await expect(row).toContainText('Bundled'); await row.getByRole('button', { name: 'Disable', exact: true }).click();
  await row.getByRole('button', { name: 'Restore bundled version', exact: true }).click();
  await expect(row.getByRole('button', { name: 'Enable', exact: true })).toBeVisible();
  await close(); await launch(true);
  await expect(page.locator('#dependency-overview-open')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Explore map for REQ-001', exact: true })).toHaveCount(0);
  await page.locator('#plugin-manager-open').click();
  await page.locator('.plugin-manager-item').filter({ hasText: 'specular.relationships' }).getByRole('button', { name: 'Enable', exact: true }).click();
  await page.locator('#plugin-manager-close').click(); await page.locator('#dependency-overview-open').click();
  await expect.poll(() => custom('document.querySelectorAll(".dependency-graph-node").length')).toBe(5);
});

test('Project Lens controls remain spaced at minimum size with zero and multiple additional plugins', async () => {
  await launch(); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  const spacing = async () => {
    const controls = page.locator('#plugin-view-open, #plugin-manager-open, #loaded-plugin-views button, #dependency-overview-open');
    const boxes = await controls.evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; }));
    expect(boxes[1].left - boxes[0].right).toBeGreaterThanOrEqual(3.9);
    // Plugin shortcuts have their own bounded scroller.
    const actions = await page.locator('.lens-plugin-actions').boundingBox();
    const shortcuts = await page.locator('#loaded-plugin-views').boundingBox();
    const overview = await page.locator('#dependency-overview-open').boundingBox();
    expect(shortcuts!.y - (actions!.y + actions!.height)).toBeGreaterThanOrEqual(3.9);
    expect(overview!.y - (shortcuts!.y + shortcuts!.height)).toBeGreaterThanOrEqual(3.9);
    expect(boxes.every(b => b.left >= 0 && b.right <= 1120)).toBe(true);
    const inspector = await page.locator('.inspector').boundingBox();
    const results = await page.locator('#lens-results').boundingBox();
    expect(results!.height).toBeGreaterThan(inspector!.height / 2);
  };
  await spacing();
  for (const example of ['example-path.txt', 'headings-example-path.txt']) {
    const directory = (await readFile(path.join('.cache/plugin-sdk', example), 'utf8')).trim();
    await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, directory);
    await page.locator('#plugin-view-open').click();
  }
  await expect(page.locator('#loaded-plugin-views button')).toHaveCount(3); await spacing();
  await page.screenshot({ path: 'test-results/bundled-plugin-lens-minimum.png' });
});
