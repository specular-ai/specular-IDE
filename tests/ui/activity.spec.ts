import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { appendFile, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
import { jsonl, t, writeHomes } from '../helpers/activity-fixtures';
import { menuAction } from './menu-action';
import { seedLegacyConfiguration } from './legacy-configuration';

// Increment 95a: a plugin that declares activity@1 receives the project's agent activity once reading is turned on.
let app: ElectronApplication, page: Page, root: string, project: string, homes: Awaited<ReturnType<typeof writeHomes>>;
const manifest = { manifestVersion: 1, id: 'test.activity', title: 'Activity test', version: '1.0.0', api: '>=0.2.0 <0.3.0', entry: 'index.js', customApi: 1,
  capabilities: ['workspace.read'], models: ['activity@1', 'physical@1'], views: [{ id: 'activity', title: 'Activity test', kind: 'custom' }] };
const code = `export function activate({ root, request }) {
  root.innerHTML = '<p id="out"></p>';
  const paint = r => {
    const a = r.models.activity;
    root.querySelector('#out').textContent = a ? 'enabled:' + a.enabled + ' sessions:' + a.sessions.length + ' calls:' + a.sessions.reduce((n, s) => n + s.toolCalls, 0) + ' warnings:' + a.warnings.length : 'no activity model';
  };
  paint(request); return { update: paint };
}`;
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/activity-')); project = path.join(root, 'project');
  await mkdir(project); await writeFile(path.join(project, 'README.md'), '# REQ-1 Readme\n');
  homes = await writeHomes(root, project);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  await seedLegacyConfiguration(project);
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data'), CLAUDE_CONFIG_DIR: homes.claude, CODEX_HOME: homes.codex } });
  page = await app.firstWindow(); await expect(page.locator('#lens-results .lens-card').first()).toBeVisible();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
});
async function install(name: string, value: Record<string, unknown>) {
  const directory = path.join(root, name); await mkdir(directory); await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(directory, 'specular-plugin.json'), JSON.stringify(value)); await writeFile(path.join(directory, 'index.js'), code);
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, directory);
  await menuAction(app, 'plugin-install-folder');
  return pluginFrame(app, '#out');
}

test('activity reaches a declaring plugin only after reading is turned on, follows Refresh, and empties when turned off', async () => {
  const frame = await install('plugin', manifest), out = frame.locator('#out');
  await expect(out).toHaveText('enabled:false sessions:0 calls:0 warnings:1');
  await page.locator('#show-agent-setup').click();
  await expect(page.locator('#activity-setting')).toBeVisible();
  await expect(page.locator('#activity-enabled')).not.toBeChecked();
  await page.locator('#activity-enabled').check();
  await page.locator('#agent-setup-close').click();
  await expect(out).toHaveText('enabled:true sessions:4 calls:25 warnings:0');
  await appendFile(path.join(homes.folder(project), 'c-root.jsonl'), jsonl([{ sessionId: 'c-root', cwd: project, type: 'assistant', timestamp: t(19),
    message: { role: 'assistant', content: [{ type: 'tool_use', id: 'z', name: 'Read', input: { file_path: path.join(project, 'README.md') } }] } }]));
  await page.locator('#refresh').click();
  await expect(out).toHaveText('enabled:true sessions:4 calls:26 warnings:0');
  await page.locator('#show-agent-setup').click(); await page.locator('#activity-enabled').uncheck(); await page.locator('#agent-setup-close').click();
  await expect(out).toHaveText('enabled:false sessions:0 calls:0 warnings:1');
});

test('a plugin that does not declare activity@1 receives no activity model', async () => {
  const frame = await install('plain', { ...manifest, id: 'test.plain', models: ['project@1', 'physical@1'] });
  await expect(frame.locator('#out')).toHaveText('no activity model');
});
