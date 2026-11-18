import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

let application: ElectronApplication, page: Page, root: string, project: string;
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  application = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await application.firstWindow(); await expect(page.locator('#workspace')).toBeVisible();
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.locator('[data-file="guide.md"]').click();
}
async function close() {
  if (application) { await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await application.close().catch(() => {}); }
}
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true });
  root = await mkdtemp(path.resolve('.cache/ui-tests/side-panels-'));
  project = path.join(root, 'project'); await mkdir(project);
  await writeFile(path.join(project, 'guide.md'), '# Guide\n\n## REQ-001 — First\n\nText.\n');
  await launch();
});
test.afterEach(close);

const width = (selector: string) => page.locator(selector).evaluate(el => Math.round(el.getBoundingClientRect().width));

test('drags and keys resize the Explorer and Project Lens, within limits, and reset to defaults', async () => {
  const explorerDefault = await width('.explorer'), lensDefault = await width('.inspector');
  expect(explorerDefault).toBe(225); expect(lensDefault).toBe(275);

  // Drag the Explorer edge right by 100px.
  const explorerHandle = (await page.locator('#explorer-resize').boundingBox())!;
  const ex = explorerHandle.x + explorerHandle.width / 2, ey = explorerHandle.y + 200;
  await page.mouse.move(ex, ey); await page.mouse.down(); await page.mouse.move(ex + 100, ey, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => width('.explorer')).toBe(explorerDefault + 100);
  await expect(page.locator('#explorer-resize')).toHaveAttribute('aria-valuenow', String(explorerDefault + 100));

  // Drag the Lens edge left by 80px widens it; Escape mid-drag cancels.
  const lensHandle = (await page.locator('#lens-resize').boundingBox())!;
  const lx = lensHandle.x + lensHandle.width / 2, ly = lensHandle.y + 200;
  await page.mouse.move(lx, ly); await page.mouse.down(); await page.mouse.move(lx - 80, ly, { steps: 5 }); await page.mouse.up();
  await expect.poll(() => width('.inspector')).toBe(lensDefault + 80);
  await page.mouse.move(lx - 80, ly); await page.mouse.down(); await page.mouse.move(lx - 200, ly, { steps: 5 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(() => width('.inspector')).toBe(lensDefault + 80);

  // Keyboard: arrows adjust (Lens grows to the left), Home is the minimum, End keeps the document area usable.
  await page.locator('#lens-resize').focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => width('.inspector')).toBe(lensDefault + 100);
  await page.keyboard.press('Home');
  await expect.poll(() => width('.inspector')).toBe(160);
  await page.keyboard.press('End');
  await expect.poll(() => width('.document-area')).toBeGreaterThanOrEqual(429);
  expect(await width('.document-area')).toBeLessThanOrEqual(431);

  // Enter and double-click restore the defaults.
  await page.keyboard.press('Enter');
  await expect.poll(() => width('.inspector')).toBe(lensDefault);
  await page.locator('#explorer-resize').dblclick();
  await expect.poll(() => width('.explorer')).toBe(explorerDefault);
});

test('a narrower window shrinks a widened panel to keep the document area, and restores it when widened', async () => {
  await page.locator('#explorer-resize').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight'); // 225 + 400
  await expect.poll(() => width('.explorer')).toBe(625);
  await page.setViewportSize({ width: 1250, height: 900 });
  // 1250 - 275 (Lens) - 430 (document area minimum).
  await expect.poll(() => width('.explorer')).toBe(545);
  expect(await width('.document-area')).toBe(430);
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect.poll(() => width('.explorer')).toBe(625);
});

test('panel widths and the split are saved and restored after a restart; resets remove them', async () => {
  const settingsFile = path.join(root, 'user-data', 'settings.json');
  const saved = async () => { try { return JSON.parse(await readFile(settingsFile, 'utf8')).panelLayout; } catch { return undefined; } };
  await page.locator('#explorer-resize').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight'); // 285
  await page.locator('#lens-resize').focus(); await page.keyboard.press('Home'); // 160
  await page.locator('#panel-divider').focus(); await page.keyboard.press('ArrowLeft'); // 45%
  await expect.poll(saved).toEqual({ explorerWidth: 285, lensWidth: 160, sourceRatio: expect.closeTo(0.45, 5) });

  await close(); await launch();
  await expect.poll(() => width('.explorer')).toBe(285);
  expect(await width('.inspector')).toBe(160);
  await expect(page.locator('#panel-divider')).toHaveAttribute('aria-valuenow', '45');

  // Resetting each one removes it from the settings, so the defaults apply after the next restart.
  await page.locator('#explorer-resize').dblclick();
  await page.locator('#lens-resize').focus(); await page.keyboard.press('Enter');
  await page.locator('#reset-split').click();
  await expect.poll(saved).toEqual({});
  await close(); await launch();
  expect(await width('.explorer')).toBe(225);
  expect(await width('.inspector')).toBe(275);
  await expect(page.locator('#panel-divider')).toHaveAttribute('aria-valuenow', '50');
});

test('invalid saved widths are ignored field by field', async () => {
  await close();
  const settingsFile = path.join(root, 'user-data', 'settings.json');
  let settings: Record<string, unknown> = { version: 1 };
  try { settings = JSON.parse(await readFile(settingsFile, 'utf8')); } catch { /* first run */ }
  await writeFile(settingsFile, JSON.stringify({ ...settings, panelLayout: { explorerWidth: 'wide', lensWidth: 300, sourceRatio: 7 } }));
  await launch();
  await expect.poll(() => width('.inspector')).toBe(300);
  expect(await width('.explorer')).toBe(225);
  await expect(page.locator('#panel-divider')).toHaveAttribute('aria-valuenow', '50');
});

test('a hidden source stays hidden after a restart and in another project, until shown again', async () => {
  const settingsFile = path.join(root, 'user-data', 'settings.json');
  const saved = async () => { try { return JSON.parse(await readFile(settingsFile, 'utf8')).panelLayout; } catch { return undefined; } };
  await page.locator('#toggle-source').click();
  await expect(page.locator('#source-panel')).toBeHidden();
  await expect.poll(saved).toEqual({ sourceHidden: true });

  await close(); await launch();
  await expect(page.locator('#source-panel')).toBeHidden();
  await expect(page.locator('#toggle-source')).toHaveText('Show source');

  // Another project opens with the source hidden too, rather than reset to shown.
  const other = path.join(root, 'other'); await mkdir(other);
  await writeFile(path.join(other, 'guide.md'), '# Other\n');
  await close();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  application = await electron.launch({ args: ['.', '--project=' + other], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await application.firstWindow(); await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('[data-file="guide.md"]').click();
  await expect(page.locator('#source-panel')).toBeHidden();

  await page.locator('#toggle-source').click();
  await expect(page.locator('#source-panel')).toBeVisible();
  await expect.poll(saved).toEqual({});
  await close(); await launch();
  await expect(page.locator('#source-panel')).toBeVisible();
});
