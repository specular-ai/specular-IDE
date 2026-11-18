import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
import { writeHomes } from '../helpers/activity-fixtures';
import { seedLegacyConfiguration } from './legacy-configuration';

// Increment 95b: the bundled Agent activity view over fixture Claude Code and Codex logs.
let app: ElectronApplication, page: Page, root: string, project: string;
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/agent-activity-')); project = path.join(root, 'project');
  await mkdir(path.join(project, 'specs'), { recursive: true });
  await writeFile(path.join(project, 'README.md'), '# REQ-1 Readme\n'); await writeFile(path.join(project, 'specs', 'login.md'), '# REQ-2 Login\n\nUsers log in.\n');
  const homes = await writeHomes(root, project);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  await seedLegacyConfiguration(project);
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data'), CLAUDE_CONFIG_DIR: homes.claude, CODEX_HOME: homes.codex } });
  page = await app.firstWindow(); await expect(page.locator('#lens-results .lens-card').first()).toBeVisible();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
});
const openActivity = async (selector = '#agent-activity') => { await page.locator('#loaded-plugin-views button[data-plugin-id="specular.agent-activity"]').click(); return pluginFrame(app, selector); };
const setReading = async (on: boolean) => {
  await page.locator('#show-agent-setup').click();
  if (on) await page.locator('#activity-enabled').check(); else await page.locator('#activity-enabled').uncheck();
  await page.locator('#agent-setup-close').click();
};

test('the Agent activity view shows sessions, resources, and commands from the logs, opens spec files, and empties when reading is off', async () => {
  await expect(page.locator('#loaded-plugin-views button[data-plugin-id="specular.agent-activity"]')).toHaveText('Agent activity');
  let frame = await openActivity();
  await expect(frame.locator('.activity-empty')).toContainText('Reading agent sessions is off for this project');
  await setReading(true);
  await expect(frame.locator('.activity-session')).toHaveCount(4);
  await expect(frame.locator('.activity-counts')).toHaveText('4 sessions · 7 turns · 25 tool calls · 6 failures');
  await expect(frame.locator('.activity-session .activity-title')).toHaveText(['Codex session x-legacy', 'Codex session x-root', 'Fix the login spec', 'Fix the login spec']);
  await frame.page().screenshot({ path: 'test-results/agent-activity-sessions.png' });

  // A session expands into turns, and a turn into its tool calls with failures marked.
  const session = frame.locator('.activity-session[data-key="claude:c-root"]');
  await session.locator('summary').first().click();
  await expect(session.locator('.activity-turn')).toHaveCount(2);
  await session.locator('.activity-turn summary').first().click();
  await expect(session.locator('.activity-call')).toHaveCount(7);
  await expect(session.locator('.activity-call.failed .activity-target')).toHaveText(['npm test', 'rm -rf build']);
  await expect(session.locator('.activity-call.failed .activity-outcome')).toHaveText(['failed (exit 2)', 'denied']);

  // Resources: project files by reads and writes; a spec file opens.
  await frame.getByRole('tab', { name: 'Resources' }).click();
  const login = frame.locator('tr[data-path="specs/login.md"]');
  await expect(login.locator('td')).toHaveText(['specs/login.mdspec', '2', '2', '', '2', /./]);
  await expect(frame.locator('tr[data-path="src/a.ts"] td').nth(2)).toHaveText('1');
  await expect(frame.locator('[data-view="resources"] .activity-note')).toContainText('outside the project');
  await frame.locator('#activity-spec-only').check();
  // Spec files are the project's Markdown documents: the Codex session read README.md.
  await expect(frame.locator('.activity-table tbody .activity-file')).toHaveText(['specs/login.md', 'README.md']);
  await frame.page().screenshot({ path: 'test-results/agent-activity-resources.png' });
  await login.getByRole('button', { name: 'specs/login.md' }).click();
  await expect(page.locator('#document-path')).toHaveText('specs/login.md');

  // Commands: grouped by first words, with failures; the tab and filters survive the source visit.
  frame = await openActivity();
  await expect(frame.getByRole('tab', { name: 'Resources' })).toHaveAttribute('aria-selected', 'true');
  await frame.getByRole('tab', { name: 'Commands' }).click();
  await expect(frame.locator('.activity-group-name')).toHaveText(['npm test', 'rm', 'Get-Content', 'git status', 'npm run build', 'npx playwright test']);
  const npm = frame.locator('.activity-group[data-group="npm test"]');
  await expect(npm.locator('summary')).toContainText('3 calls · 3 sessions');
  await expect(npm.locator('.activity-badge.failed')).toHaveText('3 failures');
  await npm.locator('summary').click();
  await expect(npm.locator('.activity-call')).toHaveCount(3);
  await frame.page().screenshot({ path: 'test-results/agent-activity-commands.png' });
  await frame.locator('#activity-failed-commands').check();
  await expect(frame.locator('.activity-group-name')).toHaveText(['npm test', 'rm', 'npx playwright test']);
  await frame.locator('#activity-failed-commands').uncheck();
  await expect(frame.locator('.activity-group')).toHaveCount(6);

  // Filters: agent and session.
  await frame.getByLabel('Agent', { exact: true }).selectOption('codex');
  await expect(frame.locator('.activity-group-name')).toHaveText(['Get-Content', 'git status', 'npm run build', 'npm test', 'npx playwright test']);
  await frame.getByRole('tab', { name: 'Sessions' }).click();
  await expect(frame.locator('.activity-session')).toHaveCount(2);
  await frame.getByLabel('Session', { exact: true }).selectOption('codex:x-root');
  await expect(frame.locator('.activity-session')).toHaveCount(1);
  await expect(frame.locator('.activity-session')).toHaveAttribute('open', '');
  await frame.getByRole('button', { name: 'Clear filters' }).click();
  await expect(frame.locator('.activity-session')).toHaveCount(4);

  // Failure filter: every fixture session fails somewhere, but only turns with a failure remain.
  await frame.locator('#activity-failed-sessions').check();
  await expect(frame.locator('.activity-session > summary > .activity-badge.failed')).toHaveCount(4);
  const failing = frame.locator('.activity-session[data-key="claude:c-root"]');
  await expect(failing).toHaveAttribute('open', '');
  await expect(failing.locator('.activity-turn')).toHaveCount(1);
  await frame.locator('#activity-failed-sessions').uncheck();
  await expect(failing.locator('.activity-turn')).toHaveCount(2);

  await setReading(false);
  await expect(frame.locator('.activity-empty')).toContainText('Reading agent sessions is off for this project');
});
