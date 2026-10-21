import { _electron as electron, expect } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = path.resolve('.cache', 'packaged-smoke');
await mkdir(base, { recursive: true });
const userData = await mkdtemp(path.join(base, 'run-'));
const executable = path.resolve('out', `Specular-${process.platform}-${process.arch}`, 'Specular.exe');
const environment = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'ELECTRON_RUN_AS_NODE'));
environment.SPECULAR_USER_DATA = userData;
const application = await electron.launch({ executablePath: executable, args: [], env: environment });
let passed = false;
try {
  const page = await application.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#welcome')).toBeVisible();
  const agentFixture = path.join(userData, 'codex-fixture.cmd');
  await writeFile(agentFixture, '@echo off\r\necho codex-cli 1.2.3\r\n');
  await page.locator('#show-agent-setup').click();
  await page.locator('#codex-path').fill(agentFixture);
  await page.locator('[data-agent="codex"] .agent-check').click();
  await expect(page.locator('[data-agent="codex"] .agent-result')).toHaveAttribute('data-status', 'detected');
  await expect(page.locator('[data-agent="codex"] .agent-result')).toContainText('codex-cli 1.2.3');
  await page.screenshot({ path: path.join(userData, 'agent-setup.png') });
  if (process.env.SPECULAR_LIVE_CODEX_AUTH) {
    await page.locator('#codex-path').fill('');
    await page.locator('#codex-api-key').fill('sk-specular-packaged-synthetic-not-a-real-key');
    await page.locator('#codex-connect').click();
    await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status', 'connected', { timeout: 20_000 });
    await expect(page.locator('#codex-api-key')).toHaveValue('');
    await page.screenshot({ path: path.join(userData, 'codex-connection.png') });
    await page.locator('#codex-disconnect').click();
    await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status', 'disconnected');
  }
  await page.locator('#agent-setup-close').click();
  if (process.env.SPECULAR_LIVE_CODEX_CHAT) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the opted-in conversation check.');
    await page.locator('#show-agent-setup').click(); await page.locator('#codex-path').fill('');
    await page.locator('#codex-api-key').fill(process.env.OPENAI_API_KEY); await page.locator('#codex-connect').click();
    await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status','connected',{timeout:20_000});
    await page.locator('#agent-setup-close').click(); await page.locator('#show-conversation').click();
    await expect(page.locator('#conversation-model')).not.toHaveValue('');
    if (process.env.SPECULAR_LIVE_CODEX_MODEL) await page.locator('#conversation-model').fill(process.env.SPECULAR_LIVE_CODEX_MODEL);
    await page.locator('#conversation-prompt').fill('Reply with SPECULAR-READY only.'); await page.locator('#conversation-send').click();
    await expect(page.locator('#conversation-status')).toHaveAttribute('data-status','completed',{timeout:60_000});
    await expect(page.locator('#conversation-transcript .assistant')).toContainText('SPECULAR-READY');
    await page.screenshot({path:path.join(userData,'codex-conversation.png')});
    await page.locator('#conversation-end').click(); await expect(page.locator('#conversation-connection')).toContainText('Disconnected');
    await page.locator('#conversation-hide').click();
  }
  await page.screenshot({ path: path.join(userData, 'welcome.png') });
  await page.getByRole('button', { name: 'Try the demo project' }).click();
  await expect(page.locator('#document-path')).toHaveText('README.md');
  await page.locator('#show-terminals').click(); await page.locator('[data-terminal-kind="powershell"]').click();
  await expect(page.locator('#terminal-tabs [role="tab"]')).toHaveCount(1);
  await page.locator('.terminal-host:not([hidden]) .xterm-helper-textarea').pressSequentially("[IO.File]::WriteAllText((Join-Path (Get-Location) 'terminal-proof.txt'), 'PACKAGED-TERMINAL-OK'); exit");
  await page.keyboard.press('Enter');
  await expect.poll(async () => readFile(path.join(userData, 'demo-project/terminal-proof.txt'), 'utf8').catch(() => '')).toBe('PACKAGED-TERMINAL-OK');
  await expect(page.locator('#terminal-scope')).toContainText('exited', { timeout: 15_000 });
  await page.screenshot({ path: path.join(userData, 'terminal.png') });
  await page.locator('#terminal-close').click(); await expect(page.locator('#terminal-tabs [role="tab"]')).toHaveCount(0);
  await page.locator('#terminal-hide').click();
  if (process.env.SPECULAR_LIVE_CODEX_PROJECT || process.env.SPECULAR_LIVE_CODEX_COMMANDS) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for the opted-in project check.');
    await page.locator('#show-agent-setup').click(); await page.locator('#codex-path').fill('');
    await page.locator('#codex-api-key').fill(process.env.OPENAI_API_KEY); await page.locator('#codex-connect').click();
    await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status','connected',{timeout:20_000});
    await page.locator('#agent-setup-close').click(); await page.locator('#show-conversation').click();
    if (await page.locator('#conversation-use-project').isVisible()) await page.locator('#conversation-use-project').click();
    await expect(page.locator('#conversation-model')).not.toHaveValue('');
    if (process.env.SPECULAR_LIVE_CODEX_MODEL) await page.locator('#conversation-model').fill(process.env.SPECULAR_LIVE_CODEX_MODEL);
    await page.locator('#conversation-prompt').fill('Read requirements.md with your shell tool and reply with its first requirement ID only.'); await page.locator('#conversation-send').click();
    await expect(page.locator('#conversation-status')).toHaveAttribute('data-status','completed',{timeout:60_000});
    await expect(page.locator('#conversation-transcript .assistant').last()).toContainText('REQ-001');
    await expect(page.locator('#conversation-project')).toContainText(path.join(userData,'demo-project'));
    await page.screenshot({path:path.join(userData,'codex-project.png')});
    if (process.env.SPECULAR_LIVE_CODEX_COMMANDS) {
      const prompt = page.locator('#conversation-prompt'); const feedback = page.locator('#conversation-feedback');
      await prompt.fill('/'); await expect(page.locator('#conversation-commands button')).toHaveCount(5);
      await prompt.fill('/status'); await prompt.press('Control+Enter'); await expect(feedback).toContainText('Codex thread: idle');
      await prompt.fill('/model'); await prompt.press('Control+Enter'); await expect(feedback).toContainText('Codex models:');
      const before = await page.locator('#conversation-transcript').textContent();
      await prompt.fill('/compact'); await prompt.press('Control+Enter');
      await expect(page.locator('#conversation-status')).toContainText('Context compacted', { timeout: 60_000 });
      expect(await page.locator('#conversation-transcript').textContent()).toBe(before);
      const previousReplies = await page.locator('#conversation-transcript .assistant').count();
      await prompt.fill('What was the first requirement ID you read earlier? Reply with the ID only.'); await prompt.press('Control+Enter');
      await expect.poll(() => page.locator('#conversation-transcript .assistant').count(), { timeout: 60_000 }).toBeGreaterThan(previousReplies);
      await expect(page.locator('#conversation-status')).toHaveAttribute('data-status', 'completed', { timeout: 60_000 });
      await expect(page.locator('#conversation-transcript .assistant').last()).toContainText('REQ-001');
      await prompt.fill('/co'); await page.screenshot({path:path.join(userData,'codex-commands.png')});
    }
    await page.locator('#conversation-end').click(); await expect(page.locator('#conversation-connection')).toContainText('Disconnected');
    await page.locator('#conversation-hide').click();
  }
  await expect(page.locator('#metric-ids')).toHaveText('10');
  await page.locator('#preview [data-id="REQ-001"]').first().click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.locator('#preview h1').evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const split = await page.locator('.document-split').boundingBox();
  const divider = await page.locator('#panel-divider').boundingBox();
  await page.mouse.move(divider.x + divider.width / 2, divider.y + 100);
  await page.mouse.down();
  await page.mouse.move(split.x + (split.width - divider.width) * 0.65 + divider.width / 2, divider.y + 100, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('#panel-divider')).toHaveAttribute('aria-valuenow', '65');
  await page.screenshot({ path: path.join(userData, 'resized-panels.png') });
  await page.locator('#reset-split').click();
  await expect(page.locator('#panel-divider')).toHaveAttribute('aria-valuenow', '50');
  await page.locator('#prepare-brief').click();
  await page.locator('#brief-use').selectOption('both');
  await page.locator('#brief-instruction').fill('Review the timer requirements.');
  await page.locator('#brief-create').click();
  const brief = await page.locator('#brief-output').inputValue();
  expect(brief).toContain('REQ-001');
  expect(brief).toContain('## Selected Markdown');
  expect(brief).toContain('## Selected preview text');
  // Materialize all formats in memory before copying; read-side items cannot be written back directly.
  await application.evaluate(async ({ clipboard, ClipboardItem }, expected) => {
    const items = await clipboard.read();
    globalThis.briefClipboardBackup = await Promise.all(items.map(async item => {
      const entries = await Promise.all(item.types.map(async type => [type, await item.getType(type)]));
      return new ClipboardItem(Object.fromEntries(entries));
    }));
    globalThis.briefClipboardExpected = expected;
  }, brief);
  await page.locator('#brief-copy').click();
  await expect(page.locator('#brief-feedback')).toHaveText('Copied to clipboard.');
  expect(await application.evaluate(({ clipboard }) => clipboard.readText())).toBe(brief);
  await page.screenshot({ path: path.join(userData, 'agent-brief.png') });
  await page.locator('#brief-close').click();
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nPackaged application save check.\n');
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  expect(await readFile(path.join(userData, 'demo-project', 'requirements.md'), 'utf8')).toContain('Packaged application save check.');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nPackaged save-on-close check.\n');
  await page.keyboard.press('Control+w');
  await expect(page.locator('#close-tab-dialog')).toBeHidden();
  await expect(page.locator('#document-path')).toHaveText('README.md');
  expect(await readFile(path.join(userData, 'demo-project', 'requirements.md'), 'utf8')).toContain('Packaged save-on-close check.');
  await page.locator('[data-file="design.md"]').click();
  await page.locator('#diagrams-tab').click();
  await expect(page.locator('#preview .diagram-card svg')).toContainText('Running');
  await page.screenshot({ path: path.join(userData, 'workspace.png') });
  await page.getByRole('button', { name: 'Close README.md', exact: true }).click();
  await page.keyboard.press('Control+w');
  await expect(page.locator('#document-empty')).toBeVisible();
  await expect(page.locator('#workspace')).toBeVisible();
  await page.screenshot({ path: path.join(userData, 'closed-tabs.png') });
  await page.locator('[data-folder="src"]').click();
  await expect(page.locator('[data-file="src/timer.ts"]')).toBeVisible();
  await page.locator('[data-file="src/timer.ts"]').click();
  await expect(page.locator('#document-path')).toHaveText('src/timer.ts · read-only');
  await expect(page.locator('#save')).toHaveCount(0);
  await page.locator('#file-search').fill('timer.ts');
  await expect(page.locator('[data-folder="src"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-file="src/timer.ts"]')).toBeVisible();
  await page.locator('#file-search').fill('');
  await page.screenshot({ path: path.join(userData, 'folder-explorer.png') });
  await page.locator('#new-file').click();
  await page.locator('#new-file-name').fill('new-specification');
  await page.locator('#new-file-create').click();
  await expect(page.locator('#document-path')).toHaveText('new-specification.md');
  await page.keyboard.insertText('# REQ-201 — Created in Specular\n');
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  await expect(page.locator('[data-file="new-specification.md"]')).toBeVisible();
  await expect(page.locator('#lens-results')).toContainText('REQ-201');
  await page.locator('#show-recent').click();
  await expect(page.locator('#recent-projects-dialog .recent-open')).toHaveCount(1);
  await page.locator('#recent-projects-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  expect(errors).toEqual([]);
  passed = true;
} catch (error) {
  const page = await application.firstWindow();
  console.error('Packaged app message:', await page.locator('#toast').textContent());
  await page.screenshot({ path: path.join(userData, 'failure.png') });
  throw error;
} finally {
  try {
    await application.evaluate(async ({ clipboard }) => {
      if (globalThis.briefClipboardBackup && await clipboard.readText() === globalThis.briefClipboardExpected) {
        if (globalThis.briefClipboardBackup.length) await clipboard.write(globalThis.briefClipboardBackup);
        else clipboard.clear();
      }
    });
  } finally {
    if (passed) {
      const closed = application.waitForEvent('close');
      await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
      await closed;
    } else {
      await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined);
      await application.close();
    }
  }
}
const restarted = await electron.launch({ executablePath: executable, args: [], env: environment });
try {
  const page = await restarted.firstWindow();
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('#document-path')).toHaveText('new-specification.md');
  await expect(page.locator('#tabs [role="tab"]')).toHaveText(['timer.ts', 'new-specification.md']);
  await expect(page.locator('#preview')).toContainText('REQ-201');
  await page.screenshot({ path: path.join(userData, 'restored-workspace.png') });
  await page.locator('#show-recent').click();
  await expect(page.locator('#recent-projects-dialog .recent-open')).toHaveCount(1);
  await page.locator('#recent-projects-dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('[data-file="new-specification.md"]')).toBeVisible();
} finally {
  await restarted.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); });
  await restarted.close();
}
console.log(`Packaged app passed: welcome, agent setup, demo copy, cross-file navigation, panel resizing/reset, brief preparation/native clipboard, save-on-close, empty tabs, folder browsing/filtering, Markdown creation, recent projects, workspace restoration after normal close, and Mermaid labels.\nScreenshots: ${userData}`);
