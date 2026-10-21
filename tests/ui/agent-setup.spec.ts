import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { failAutosave } from './autosave-fixture';

let application: ElectronApplication;
let page: Page;
let root: string;
async function launch(extraEnv: Record<string, string> = {}, project?: string) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  application = await electron.launch({ args: ['.', ...(project ? [`--project=${project}`] : [])], cwd: process.cwd(), env: { ...env, ...extraEnv, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await application.firstWindow();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert', '');
  await expect(page.locator(project ? '#workspace' : '#welcome')).toBeVisible();
}
test.beforeEach(async () => {
  const base = path.resolve('.cache/agent-ui-tests'); await mkdir(base, { recursive: true });
  root = await mkdtemp(path.join(base, 'run-'));
});
test.afterEach(async ({}, info) => {
  if (application) {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => undefined);
    await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined);
    await application.close().catch(() => undefined);
  }
});
test('checks PATH and explicit launchers, handles picker cancellation, and preserves unsaved Markdown', async () => {
  const bin = path.join(root, 'bin & tools'); await mkdir(bin);
  const executable = path.join(bin, 'codex.cmd'); await writeFile(executable, '@echo off\r\necho codex-cli 1.2.3\r\n');
  const project = path.join(root, 'project'); await mkdir(project); await writeFile(path.join(project, 'README.md'), '# Keep my work\n');
  await launch({ PATH: bin, Path: bin }, project);
  await failAutosave(application);
  await page.locator('.cm-content').fill('# Unsaved work');
  await page.locator('#show-agent-setup').click();
  const card = page.locator('[data-agent="codex"]');
  await card.getByRole('button', { name: 'Check installation' }).click();
  await expect(card.locator('.agent-result')).toHaveAttribute('data-status', 'detected');
  await expect(card.locator('.agent-result')).toContainText(executable);
  await expect(card.locator('.agent-result')).toContainText('codex-cli 1.2.3');
  await application.evaluate(({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] }); });
  await card.getByRole('button', { name: 'Browse…' }).click();
  await expect(card.locator('#codex-path')).toHaveValue('');
  await application.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, executable);
  await card.getByRole('button', { name: 'Browse…' }).click();
  await expect(card.locator('#codex-path')).toHaveValue(executable);
  await card.getByRole('button', { name: 'Check installation' }).click();
  await expect(card.locator('.agent-result')).toHaveAttribute('data-status', 'detected');
  await page.locator('#agent-setup-close').click();
  await expect(page.locator('.cm-content')).toContainText('Unsaved work');
  expect(await readFile(path.join(project, 'README.md'), 'utf8')).toBe('# Keep my work\n');
  await application.evaluate(({ Menu }) => { Menu.getApplicationMenu()!.items.find(item => item.label === 'Agents')!.submenu!.items[0].click(); });
  await expect(card.locator('#codex-path')).toHaveValue(executable);
  await page.keyboard.press('Escape'); await expect(page.locator('#agent-setup-dialog')).not.toBeVisible();
});
test('reports missing, invalid, failed, and timed-out installations with retry', async () => {
  await launch({ PATH: root, Path: root });
  await page.locator('#show-agent-setup').click();
  const card = page.locator('[data-agent="codex"]'); const result = card.locator('.agent-result');
  const check = card.getByRole('button', { name: 'Check installation' });
  await check.click(); await expect(result).toHaveAttribute('data-status', 'missing');
  await card.locator('#codex-path').fill('codex --help');
  await check.click(); await expect(result).toHaveAttribute('data-status', 'invalid');
  const executable = path.join(root, 'failed.cmd'); await writeFile(executable, '@echo off\r\nexit /b 9\r\n');
  await card.locator('#codex-path').fill(executable); await check.click();
  await expect(result).toContainText('exit 9');
  await writeFile(executable, '@echo off\r\n:loop\r\ngoto loop\r\n');
  await check.click(); await expect(check).toBeDisabled();
  await expect(result).toHaveAttribute('data-status', 'timeout'); await expect(check).toBeEnabled();
  await writeFile(executable, '@echo off\r\necho codex-cli 1.2.4\r\n');
  await check.click(); await expect(result).toHaveAttribute('data-status', 'detected');
  await page.locator('[data-agent="claude"] .agent-check').click();
  await expect(page.locator('[data-agent="claude"] .agent-result')).toHaveAttribute('data-status', 'missing');
});
test('live discovery reports locally installed Codex and Claude Code versions', async () => {
  test.skip(!process.env.SPECULAR_LIVE_AGENT_CHECK, 'Opt in to version checks of locally installed runtimes.');
  await launch(); await page.locator('#show-agent-setup').click();
  for (const id of ['codex', 'claude']) {
    const card = page.locator(`[data-agent="${id}"]`);
    await card.locator('.agent-check').click();
    await expect(card.locator('.agent-result')).toHaveAttribute('data-status', 'detected');
    console.log(`${id}: ${await card.locator('.agent-result').innerText()}`);
  }
  await page.screenshot({ path: 'test-results/agent-setup.png' });
});
