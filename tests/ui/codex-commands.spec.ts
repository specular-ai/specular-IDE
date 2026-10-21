import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { conversationFixture } from '../helpers/codex-runtime';
let application: ElectronApplication; let page: Page; let fixture: Awaited<ReturnType<typeof conversationFixture>>;
async function launch() {
  fixture = await conversationFixture(false, { compact: 'hold' });
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  application = await electron.launch({ args: ['.'], cwd: process.cwd(), env: { ...env, SPECULAR_USER_DATA: fixture.userData } });
  page = await application.firstWindow(); await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert', '');
  await page.locator('#show-conversation').click();
}
async function send(text: string) { await page.locator('#conversation-prompt').fill(text); await page.locator('#conversation-prompt').press('Control+Enter'); }
test.afterEach(async ({}, info) => {
  if (application) {
    if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => undefined);
    await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined);
    await application.close().catch(() => undefined);
  }
});
test('slash suggestions, offline help, model arguments, runtime status and compaction stop work in the conversation', async () => {
  await launch(); const prompt = page.locator('#conversation-prompt'); const feedback = page.locator('#conversation-feedback');
  await prompt.fill('/'); await expect(page.locator('#conversation-commands button')).toHaveCount(5);
  await prompt.press('ArrowDown'); await prompt.press('Tab'); await expect(prompt).toHaveValue('/status');
  await prompt.press('Control+Enter'); await expect(feedback).toContainText('Connect Codex'); await expect(prompt).toHaveValue('/status');
  await prompt.fill('/mo'); await prompt.press('Enter'); await expect(prompt).toHaveValue('/model ');
  await send('/model provider/custom:v2'); await expect(page.locator('#conversation-model')).toHaveValue('provider/custom:v2'); await expect(feedback).toContainText('next message');
  await send('/help'); await expect(feedback).toContainText('/compact'); await expect(feedback).toContainText('IDE');
  await prompt.fill('/'); await prompt.press('Escape'); await expect(page.locator('#conversation-commands')).toBeHidden(); await expect(page.locator('#codex-conversation-dialog')).toBeVisible();
  await send('/unknown keep these arguments'); await expect(feedback).toContainText('Unsupported'); await expect(prompt).toHaveValue('/unknown keep these arguments');
  await send('\\status'); await expect(feedback).toContainText('backslash');
  await page.locator('#conversation-setup').click(); await page.locator('#codex-path').fill(fixture.executable); await page.locator('#codex-api-key').fill('sk-ui-fixture'); await page.locator('#codex-connect').click();
  await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status', 'connected');
  await page.locator('#agent-setup-close').click(); await page.locator('#show-conversation').click();
  await send('/model'); await expect(feedback).toContainText('alternate-model');
  await send('/compact'); await expect(feedback).toContainText('Send a message first');
  await send('/model alternate-model'); await expect(page.locator('#conversation-model')).toHaveValue('alternate-model');
  await send('hello'); await expect(page.locator('#conversation-status')).toHaveAttribute('data-status', 'completed');
  await send('/status extra'); await expect(feedback).toContainText('Usage: /status'); await expect(prompt).toHaveValue('/status extra');
  await prompt.fill('/status'); await prompt.press('Enter'); await expect(feedback).toContainText('Codex thread: idle');
  await expect(page.locator('#conversation-result-title')).toHaveText('Command result');
  await expect(page.locator('#conversation-result')).toBeInViewport(); await expect(prompt).toHaveValue('');
  await page.screenshot({ path: 'test-results/codex-status.png' });
  await prompt.fill('/model provider/next:v2'); await prompt.press('Enter'); await expect(page.locator('#conversation-model')).toHaveValue('provider/next:v2');
  await send('/compact'); await expect(page.locator('#conversation-status')).toContainText('compacting');
  await prompt.fill('/model fixture-model'); await expect(page.locator('#conversation-send')).toBeDisabled();
  await send('/stop'); await expect(page.locator('#conversation-status')).toHaveAttribute('data-status', 'interrupted');
  await expect(page.locator('#conversation-transcript')).toContainText('Reply: hello');
  await prompt.fill('/'); await page.screenshot({ path: 'test-results/codex-commands.png' });
  const calls = JSON.parse(await readFile(path.join(fixture.root, 'calls.json'), 'utf8'));
  const turns = calls.filter((c: any) => c.method === 'turn/start'); expect(turns).toHaveLength(1); expect(turns[0].params.model).toBe('alternate-model');
  expect(calls.find((c: any) => c.method === 'thread/compact/start').params.threadId).toBe('thread-1');
});
