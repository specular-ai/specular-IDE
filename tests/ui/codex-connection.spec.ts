import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

let application: ElectronApplication; let page: Page; let root: string; let executable: string;
async function launch(live = false) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  application = await electron.launch({ ...(process.env.SPECULAR_TEST_PACKAGED ? { executablePath: path.resolve('out', `Specular-${process.platform}-${process.arch}`, 'Specular.exe'), args: [] } : { args: ['.'] }), cwd: process.cwd(), env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await application.firstWindow(); await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert', '');
  await page.locator('#show-agent-setup').click();
  if (!live && await page.locator('#codex-path').isEnabled()) await page.locator('#codex-path').fill(executable);
}
test.beforeEach(async () => {
  const base = path.resolve('.cache/codex-auth-ui'); await mkdir(base, { recursive: true }); root = await mkdtemp(path.join(base, 'run-'));
  const runtime = path.join(root, 'server.cjs'); executable = path.join(root, 'codex.cmd');
  await writeFile(executable, `@echo off\r\nif "%~1"=="--version" (\r\necho codex-cli 0.154.0\r\nexit /b 0\r\n)\r\n"${process.execPath}" "${runtime}"\r\n`);
  await writeFile(runtime, `const fs = require('node:fs'); let loggedIn = false;
    fs.writeFileSync(${JSON.stringify(path.join(root, 'pid.txt'))}, String(process.pid));
    const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const m = JSON.parse(line); fs.appendFileSync(${JSON.stringify(path.join(root, 'methods.txt'))}, m.method + '\\n'); if (!m.id) return; let result = {};
      if (m.method === 'config/read') result = { config: { cli_auth_credentials_store: 'ephemeral' } };
      if (m.method === 'account/read') result = { account: loggedIn ? { type: 'apiKey' } : null };
      if (m.method === 'account/login/start') {
        if (m.params.apiKey === 'sk-refuse-ui') { send({ id: m.id, error: { code: -32000, message: 'rejected ' + m.params.apiKey } }); return; }
        loggedIn = true; send({ method: 'account/login/completed', params: { success: true } }); result = { type: 'apiKey' };
      }
      send({ id: m.id, result });
    });`);
});
test.afterEach(async ({}, info) => {
  if (application) {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => undefined);
    await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined);
    await application.close().catch(() => undefined);
  }
});
const state = () => page.locator('#codex-connection-state');
async function connect(key: string) {
  await page.locator('#codex-api-key').fill(key); await page.locator('#codex-connect').click();
}
test('connects with an API key, handles validation/rejection, refreshes and reconnects without keeping the key field', async () => {
  await launch(); await page.locator('#codex-connect').click(); await expect(state()).toHaveAttribute('data-status', 'error');
  await connect('sk-refuse-ui'); await expect(state()).toHaveAttribute('data-status', 'error');
  await expect(state()).not.toContainText('sk-refuse-ui'); await expect(page.locator('#codex-api-key')).toHaveValue('');
  await connect('sk-accept-ui'); await expect(state()).toHaveAttribute('data-status', 'connected');
  await expect(state()).toContainText('Model access has not been tested');
  await expect(page.locator('#codex-path')).toBeDisabled(); await expect(page.locator('#codex-api-key')).toHaveValue('');
  await page.locator('#codex-status-refresh').click(); await expect(state()).toHaveAttribute('data-status', 'connected');
  await page.locator('#agent-setup-close').click(); await page.locator('#show-agent-setup').click();
  await expect(state()).toHaveAttribute('data-status', 'connected');
  await page.locator('#codex-disconnect').click(); await expect(state()).toHaveAttribute('data-status', 'disconnected');
  await expect(page.locator('#codex-api-key')).toBeEnabled();
  await page.locator('#codex-api-key').fill('sk-unsent'); await page.keyboard.press('Escape');
  await page.locator('#show-agent-setup').click(); await expect(page.locator('#codex-api-key')).toHaveValue('');
  await connect('sk-reconnect'); await expect(state()).toHaveAttribute('data-status', 'connected');
  const pid = Number(await readFile(path.join(root, 'pid.txt'), 'utf8'));
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await application.close();
  expect(() => process.kill(pid, 0)).toThrow();
});
test('reports unexpected runtime exit and allows a fresh connection', async () => {
  await launch(); await connect('sk-process-exit'); await expect(state()).toHaveAttribute('data-status', 'connected');
  process.kill(Number(await readFile(path.join(root, 'pid.txt'), 'utf8')), 'SIGKILL');
  await expect(state()).toHaveAttribute('data-status', 'error');
  await expect(state()).toContainText('unexpectedly');
  await connect('sk-retry-exit'); await expect(state()).toHaveAttribute('data-status', 'connected');
});
test('live Electron connection configures Codex with ephemeral API-key access', async () => {
  test.skip(!process.env.SPECULAR_LIVE_CODEX_AUTH, 'Opt in to the installed runtime authentication check.');
  await launch(true); await connect('sk-specular-ui-synthetic-not-a-real-key');
  await expect(state()).toHaveAttribute('data-status', 'connected', { timeout: 20_000 });
  await expect(page.locator('#codex-api-key')).toHaveValue('');
  await page.screenshot({ path: 'test-results/codex-connection.png' });
  await page.locator('#codex-disconnect').click(); await expect(state()).toHaveAttribute('data-status', 'disconnected');
});

async function restart() {
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  await application.close();
  await launch();
}

test('Windows protected key auto-connects after restart with saved executable, disconnect retains it, Forget removes it', async () => {
  test.setTimeout(90_000);
  await launch();
  await page.locator('#codex-remember-key').check(); await page.locator('#codex-auto-connect').check();
  await connect('sk-protected-ui'); await expect(state()).toHaveAttribute('data-status', 'connected');
  await expect(page.locator('#codex-credential-state')).toContainText('protected key');
  const directory = path.join(root, 'user-data', 'codex-credentials');
  const prefs = JSON.parse(await readFile(path.join(directory, 'preferences.json'), 'utf8'));
  expect(prefs.executable).toBe(executable); expect(prefs.autoConnect).toBe(true);
  const bytes = await readFile(path.join(directory, prefs.credential));
  expect(bytes.includes('sk-protected-ui')).toBe(false);
  const roundtrip = await application.evaluate(async ({ safeStorage }, encrypted) => {
    const value = await safeStorage.decryptStringAsync(Buffer.from(encrypted));
    return value.result === 'sk-protected-ui';
  }, [...bytes]);
  expect(roundtrip).toBe(true);
  await page.screenshot({ path: 'test-results/remembered-codex-key.png' });
  await restart(); await expect(state()).toHaveAttribute('data-status', 'connected');
  await expect(page.locator('#codex-api-key')).toHaveValue('');
  await expect(page.locator('#codex-path')).toHaveValue(executable);
  await page.locator('#codex-disconnect').click(); await expect(state()).toHaveAttribute('data-status', 'disconnected');
  expect(JSON.parse(await readFile(path.join(directory, 'preferences.json'), 'utf8')).credential).toBe(prefs.credential);
  await page.locator('#codex-status-refresh').click(); await expect(state()).toHaveAttribute('data-status', 'disconnected');
  await page.locator('#codex-forget-key').click();
  await expect(page.locator('#codex-credential-state')).toContainText('Saved key removed');
  expect((await readdir(directory)).filter(name => name.endsWith('.bin'))).toEqual([]);
  await restart(); await expect(state()).toHaveAttribute('data-status', 'disconnected');
  await expect(page.locator('#codex-auto-connect')).not.toBeChecked();
  const methods = await readFile(path.join(root, 'methods.txt'), 'utf8');
  expect(methods).not.toContain('turn/start'); expect(methods).not.toContain('thread/start'); expect(methods).not.toContain('thread/resume');
});

test('remember-only, replacement, corrupted key recovery and session-only fallback survive restarts', async () => {
  test.setTimeout(90_000);
  await launch(); await page.locator('#codex-remember-key').check();
  await connect('sk-remember-only'); await expect(state()).toHaveAttribute('data-status', 'connected');
  await restart(); await expect(state()).toHaveAttribute('data-status', 'disconnected');
  await connect(''); await expect(state()).toHaveAttribute('data-status', 'connected');
  await page.locator('#codex-disconnect').click(); await expect(state()).toHaveAttribute('data-status', 'disconnected');
  await connect('sk-replaced-ui'); await expect(state()).toHaveAttribute('data-status', 'connected');
  await page.locator('#codex-disconnect').click(); await expect(state()).toHaveAttribute('data-status', 'disconnected');
  const directory = path.join(root, 'user-data', 'codex-credentials');
  const prefs = JSON.parse(await readFile(path.join(directory, 'preferences.json'), 'utf8'));
  expect((await readdir(directory)).filter(name => name.endsWith('.bin'))).toHaveLength(1);
  await writeFile(path.join(directory, prefs.credential), 'corrupted-ciphertext');
  await connect(''); await expect(state()).toHaveAttribute('data-status', 'error');
  await expect(state()).toContainText('preserved');
  await page.locator('#agent-setup-close').click(); await page.locator('#show-agent-setup').click();
  await expect(state()).toHaveAttribute('data-status', 'error');
  expect(await readFile(path.join(directory, prefs.credential), 'utf8')).toBe('corrupted-ciphertext');
  await page.locator('#codex-remember-key').uncheck();
  await connect('sk-fallback-ui'); await expect(state()).toHaveAttribute('data-status', 'connected');
  expect(await readFile(path.join(directory, prefs.credential), 'utf8')).toBe('corrupted-ciphertext');
  await page.locator('#codex-forget-key').click(); await expect(page.locator('#codex-credential-state')).toContainText('Saved key removed');
});

test('unavailable Windows encryption refuses remembering but permits explicit session-only access', async () => {
  await launch();
  await application.evaluate(({ safeStorage }) => { safeStorage.isAsyncEncryptionAvailable = async () => false; });
  await page.locator('#codex-remember-key').check(); await page.locator('#codex-auto-connect').check();
  await connect('sk-unavailable-ui'); await expect(state()).toHaveAttribute('data-status', 'error');
  await expect(state()).toContainText('protected storage');
  expect(await readdir(path.join(root, 'user-data', 'codex-credentials')).catch(() => [])).toEqual([]);
  await page.locator('#codex-remember-key').uncheck();
  await expect(page.locator('#codex-auto-connect')).not.toBeChecked();
  await connect('sk-session-only-ui'); await expect(state()).toHaveAttribute('data-status', 'connected');
  await restart(); await expect(state()).toHaveAttribute('data-status', 'disconnected');
});
