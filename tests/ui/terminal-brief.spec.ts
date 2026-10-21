import { failAutosave } from './autosave-fixture';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createTerminalAgent } from '../helpers/terminal-agent';

let application: ElectronApplication, page: Page, root: string, project: string;
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/brief-terminal-'));
  project = path.join(root, 'project'); await mkdir(project); await writeFile(path.join(project, 'requirements.md'), '# REQ-201\nPreserve this specification.\n');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  application = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await application.firstWindow(); await failAutosave(application); await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('[data-file="requirements.md"]').click();
  await application.evaluate(({ clipboard }) => { clipboard.writeText = async text => { (globalThis as any).copied = text; }; });
});
test.afterEach(async () => {
  if (application) { await application.evaluate(({ BrowserWindow }) => { for (const w of BrowserWindow.getAllWindows()) w.destroy(); }).catch(() => {}); await application.close().catch(() => {}); }
});
async function launch(kind: 'codex' | 'claude') {
  const fixture = await createTerminalAgent(root, kind);
  await page.locator('#show-agent-setup').click(); await page.locator('#' + kind + '-path').fill(fixture.launcher); await page.locator('#agent-setup-close').click();
  if (!await page.locator('#terminal-panel').isVisible()) await page.locator('#show-terminals').click();
  await page.locator('[data-terminal-kind="' + kind + '"]').click();
  await expect(page.locator('.terminal-host:not([hidden])')).toContainText('AGENT-INPUT-READY');
  const id = (await page.locator('.terminal-host:not([hidden])').getAttribute('data-terminal-id'))!;
  return { ...fixture, id };
}
async function prepare() {
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+a');
  await page.locator('#prepare-brief').click(); await page.locator('#brief-instruction').fill('Review this requirement.');
  await page.locator('#brief-create').click();
}
async function recorded(file: string) { return JSON.parse(await readFile(file, 'utf8')); }

for (const kind of ['codex', 'claude'] as const) test(kind + ' receives the reviewed brief once, retains existing input and waits for Enter', async () => {
  const fixture = await launch(kind);
  const input = page.locator('.terminal-host:not([hidden]) .xterm-helper-textarea');
  await input.pressSequentially('Existing draft: ');
  await page.locator('#terminal-hide').click();
  await page.locator('#editor .cm-content').fill('# REQ-202\nUnsaved source café 🧭');
  await prepare();
  const assembled = await page.locator('#brief-output').inputValue();
  expect(assembled).toContain('Unsaved editor snapshot'); expect(assembled).toContain('REQ-202');
  const edited = assembled + '\nReviewed addition: $(not-a-shell-command)\n';
  await page.locator('#brief-output').fill(edited);
  await expect(page.locator('#brief-insert')).toBeDisabled();
  await page.locator('#brief-terminal').selectOption(fixture.id);
  await page.screenshot({ path: 'test-results/brief-terminal-' + kind + '.png' });
  await page.locator('#brief-insert').click();
  await expect(page.locator('#brief-dialog')).toBeHidden(); await expect(input).toBeFocused();
  await expect.poll(async () => (await recorded(fixture.state)).pastes).toBe(1);
  const state = await recorded(fixture.state);
  expect(state.draft).toBe('Existing draft: ' + edited.replace(/\n/g, '\r')); expect(state.submissions).toEqual([]);
  expect(state.received.endsWith('\x1b[201~')).toBe(true);
  await expect(page.locator('#terminal-notice')).toContainText('without pressing Enter');
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).not.toContain('REQ-202');
  await input.press('Enter');
  await expect.poll(async () => (await recorded(fixture.state)).submissions.length).toBe(1);
  expect((await recorded(fixture.state)).submissions[0]).toBe(state.draft);
  expect(await application.evaluate(() => (globalThis as any).copied)).toBeUndefined();
});

test('unavailable targets and failed insertion keep the brief reviewable and copyable', async () => {
  await prepare(); await expect(page.locator('#brief-insert')).toBeDisabled();
  await expect(page.locator('#brief-terminal-hint')).toContainText('Open a Codex or Claude terminal');
  await page.locator('#brief-close').click();
  const fixture = await launch('codex');
  await prepare(); await page.locator('#brief-terminal').selectOption(fixture.id);
  const text = await page.locator('#brief-output').inputValue();
  await writeFile(fixture.disable, '');
  await expect(page.locator('.terminal-host')).toContainText('PASTE-DISABLED');
  await page.locator('#brief-insert').click(); await expect(page.locator('#brief-feedback')).toContainText('not ready for multiline paste');
  await expect(page.locator('#brief-output')).toHaveValue(text);
  expect((await recorded(fixture.state)).pastes).toBe(0);
  await page.locator('#brief-copy').click(); await expect(page.locator('#brief-feedback')).toHaveText('Copied to clipboard.');
  expect(await application.evaluate(() => (globalThis as any).copied)).toBe(text);
  await writeFile(fixture.exit, ''); await expect(page.locator('#terminal-scope')).toContainText('exited');
  await page.locator('#brief-insert').click(); await expect(page.locator('#brief-feedback')).toContainText('no longer running');
  await expect(page.locator('#brief-insert')).toBeDisabled(); await expect(page.locator('#brief-output')).toHaveValue(text);
});

test('shells and other projects cannot receive briefs, and invalid payloads are rejected without input', async () => {
  const fixture = await launch('codex');
  await page.locator('[data-terminal-kind="powershell"]').click();
  const shell = (await page.locator('.terminal-host:not([hidden])').getAttribute('data-terminal-id'))!;
  expect(await page.evaluate(async ({ id, root }) => window.specular.insertTerminalBrief(id, root, 'no'), { id: shell, root: project })).toMatchObject({ ok: false });
  await prepare();
  expect(await page.locator('#brief-terminal option').count()).toBe(2); // Placeholder and agent, no shell.
  await page.locator('#brief-terminal').selectOption(fixture.id);
  await page.locator('#brief-output').fill('x'.repeat(60_001)); await page.locator('#brief-insert').click();
  await expect(page.locator('#brief-feedback')).toContainText('60,000');
  expect(await page.evaluate(async ({ id, root }) => window.specular.insertTerminalBrief(id, root, 'escape\x1b[201~\r'), { id: fixture.id, root: project })).toMatchObject({ ok: false });
  expect(await page.evaluate(async ({ id, root }) => window.specular.insertTerminalBrief(id, root, 'no'), { id: fixture.id, root: project + '-other' })).toMatchObject({ ok: false });
  expect((await recorded(fixture.state)).received).toBe('');
  await page.locator('#brief-close').click();
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'requirements.md'), '# Other project');
  await application.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other');
  await page.locator('[data-file="requirements.md"]').click(); await prepare();
  await expect(page.locator('#brief-terminal option[value="' + fixture.id + '"]')).toBeDisabled();
  await expect(page.locator('#brief-terminal option[value="' + fixture.id + '"]')).toContainText('different project');
  expect(await page.evaluate(async ({ id, root }) => window.specular.insertTerminalBrief(id, root, 'no'), { id: fixture.id, root: other })).toMatchObject({ ok: false });
  expect((await recorded(fixture.state)).received).toBe('');
});
