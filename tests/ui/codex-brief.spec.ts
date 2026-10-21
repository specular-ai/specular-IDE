import { failAutosave } from './autosave-fixture';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { conversationFixture } from '../helpers/codex-runtime';
let app: ElectronApplication, page: Page, fixture: Awaited<ReturnType<typeof conversationFixture>>, project: string;
async function launch(options: Parameters<typeof conversationFixture>[1] = {}) {
  fixture = await conversationFixture(false, options); project = path.join(fixture.root, 'project'); await mkdir(project);
  await writeFile(path.join(project, 'requirements.md'), '# REQ-201\nPreserve this specification.\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  const args = ['--project=' + project];
  app = await electron.launch({ ...(process.env.SPECULAR_TEST_PACKAGED ? { executablePath: path.resolve('out', `Specular-${process.platform}-${process.arch}`, 'Specular.exe'), args } : { args: ['.', ...args] }), env: { ...env, SPECULAR_USER_DATA: fixture.userData } });
  page = await app.firstWindow(); await failAutosave(app); await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('[data-file="requirements.md"]').click();
  await app.evaluate(({ clipboard }) => { clipboard.writeText = async text => { (globalThis as any).copied = text; }; });
}
async function connect() {
  await page.locator('#show-agent-setup').click(); await page.locator('#codex-path').fill(fixture.executable); await page.locator('#codex-api-key').fill('sk-brief-ui');
  await page.locator('#codex-connect').click(); await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status', 'connected'); await page.locator('#agent-setup-close').click();
}
async function prepare() {
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+a');
  await page.locator('#prepare-brief').click(); await page.locator('#brief-instruction').fill('Discuss this requirement.'); await page.locator('#brief-create').click();
  await expect(page.locator('#brief-send')).toBeEnabled();
}
async function calls(): Promise<any[]> { return JSON.parse(await readFile(path.join(fixture.root, 'calls.json'), 'utf8')); }
test.afterEach(async ({}, info) => {
  if (app) { if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('edited unsaved Markdown brief arrives once, opens streamed chat and supports a follow-up without changing the file', async () => {
  await launch({ threadDelayMs: 250 }); await connect();
  await page.locator('#editor .cm-content').fill('# REQ-202\nUnsaved caf\u00e9 \u{1f9ed}'); await prepare();
  const assembled = await page.locator('#brief-output').inputValue(); expect(assembled).toContain('Unsaved editor snapshot'); expect(assembled).toContain('REQ-202'); expect(assembled).toContain('requirements.md');
  const text = '/compact\n' + assembled + '\nReviewed addition.  \n'; await page.locator('#brief-output').fill(text);
  await page.locator('#brief-model').fill('alternate-model'); await expect(page.locator('#brief-chat-target')).toContainText(project);
  await expect(page.locator('#brief-chat-target')).toContainText('Read-only');
  await page.locator('#brief-send').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/codex-brief-review.png' });
  await page.locator('#brief-send').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator('#brief-close')).toBeDisabled(); await expect(page.locator('#brief-copy')).toBeDisabled();
  await expect(page.locator('#brief-dialog')).toBeHidden(); await expect(page.locator('#codex-conversation-dialog')).toBeVisible();
  await expect(page.locator('#conversation-status')).toHaveAttribute('data-status', 'completed');
  await expect(page.locator('#conversation-transcript')).toContainText('Reply: /compact');
  let all = await calls(); const turns = all.filter(x => x.method === 'turn/start'); expect(turns).toHaveLength(1); expect(turns[0].params.input).toEqual([{ type: 'text', text }]); expect(turns[0].params.model).toBe('alternate-model');
  expect(all.some(x => x.method === 'thread/compact/start')).toBe(false);
  await page.locator('#conversation-prompt').fill('follow-up'); await page.locator('#conversation-send').click();
  await expect(page.locator('#conversation-status')).toHaveAttribute('data-status', 'completed'); await expect(page.locator('#conversation-transcript')).toContainText('Remembered: /compact');
  all = await calls(); expect(all.filter(x => x.method === 'thread/start')).toHaveLength(1);
  await page.locator('#conversation-hide').click(); await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe('# REQ-201\nPreserve this specification.\n');
});

test('missing connection retains the edited draft and Copy works independently', async () => {
  await launch(); await prepare(); const text = (await page.locator('#brief-output').inputValue()) + '\nKeep my edits.'; await page.locator('#brief-output').fill(text);
  await expect(page.locator('#brief-chat-target')).toContainText('Connect Codex'); await page.locator('#brief-send').click();
  await expect(page.locator('#brief-feedback')).toContainText('Connect Codex'); await expect(page.locator('#brief-output')).toHaveValue(text);
  await page.locator('#brief-copy').click(); await expect(page.locator('#brief-feedback')).toHaveText('Copied to clipboard.'); expect(await app.evaluate(() => (globalThis as any).copied)).toBe(text);
});

test('dispatch failure retains review and copy, and rejects stale project or oversized requests', async () => {
  await launch({ turnStartFailure: true }); await connect(); await prepare();
  const text = (await page.locator('#brief-output').inputValue()) + '\nKeep after failure.'; await page.locator('#brief-output').fill(text);
  expect(await page.evaluate(({ project }) => window.specular.sendCodexBrief(project + '-stale', 'draft', 'fixture-model'), { project })).toMatchObject({ ok: false });
  await page.locator('#brief-output').fill('x'.repeat(32_001)); await page.locator('#brief-send').click(); await expect(page.locator('#brief-feedback')).toContainText('32,000');
  expect((await calls()).some(x => x.method === 'turn/start')).toBe(false);
  await page.locator('#brief-output').fill(text); await page.locator('#brief-send').click(); await expect(page.locator('#brief-feedback')).toContainText('draft was kept');
  await expect(page.locator('#brief-output')).toHaveValue(text); await expect(page.locator('#brief-close')).toBeEnabled();
  expect((await calls()).filter(x => x.method === 'turn/start')).toHaveLength(1);
  await page.locator('#brief-copy').click(); await expect(page.locator('#brief-feedback')).toHaveText('Copied to clipboard.'); expect(await app.evaluate(() => (globalThis as any).copied)).toBe(text);
});
