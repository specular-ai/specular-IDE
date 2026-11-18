import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expandDiscoveryMethods } from './configuration-entries';
import { menuAction } from './menu-action';

/** Increment 97c: an installed Spec Kitty profile (a discovery plugin) proposes under its tool with gaps; failing and slow plugins are reported and skipped. */
let app: ElectronApplication, page: Page, root: string, project: string;
const prompt = (id: string, subtasks: string[], dependencies: string[] = []) =>
  `---\nwork_package_id: ${id}\ndependencies: [${dependencies.join(', ')}]\nsubtasks:\n${subtasks.map(t => `- ${t}`).join('\n')}\nhistory:\n- lane: planned\nwp_code: ${id}\n---\n\n# Work Package Prompt: ${id} – Work\n\nDo it.\n`;
const tasks = (packages: [string, string[]][]) => `# Work Packages\n\n${packages.map(([id, subtasks]) => `## Work Package ${id}: Work\n\n${subtasks.map(t => `- [ ] ${t} Do ${t}`).join('\n')}\n`).join('\n')}`;
const FILES: Record<string, string> = {
  'kitty-specs/001-a/tasks/WP01-work.md': prompt('WP01', ['T001', 'T002']), 'kitty-specs/001-a/tasks/WP02-work.md': prompt('WP02', ['T003'], ['WP01']),
  'kitty-specs/001-a/tasks.md': tasks([['WP01', ['T001', 'T002']], ['WP02', ['T003']]]),
  'kitty-specs/002-b/tasks/WP01-work.md': prompt('WP01', ['T001']), 'kitty-specs/002-b/tasks.md': tasks([['WP01', ['T001']]]),
};
const manifest = (id: string, tool: string) => ({ manifestVersion: 1, id, version: '1.0.0', api: '0.2.0', entry: 'index.js', capabilities: ['workspace.read'], models: ['markdown@1'], views: [], discovery: { tool, versions: 'test' } });
async function install(directory: string, action = 'profile-install-folder') {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, directory);
  const before = await page.evaluate(() => window.specular.pluginList().then(list => list.length));
  await menuAction(app, action);
  await expect.poll(() => page.evaluate(() => window.specular.pluginList().then(list => list.length))).toBe(before + 1);
}
async function plugin(name: string, id: string, tool: string, code: string) {
  const directory = path.join(root, name); await mkdir(directory);
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(directory, 'specular-plugin.json'), JSON.stringify(manifest(id, tool)));
  await writeFile(path.join(directory, 'index.js'), code);
  return directory;
}
async function openDiscover() {
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
  const providers = page.locator('#discovery-providers');
  if (await providers.getAttribute('open') === null) await providers.locator(':scope > summary').click();
}
const entry = (text: string) => page.locator('#discovery-review > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: text }) });
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/discovery-plugins-')); project = path.join(root, 'project');
  for (const [file, text] of Object.entries(FILES)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow(); await expect(page.locator('#project-heading')).toHaveText('project');
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('an installed discovery plugin proposes under its tool with gaps; failing, slow, and invalid ones are skipped; turning it off removes its suggestions', async () => {
  await install(path.resolve('examples/plugins/spec-kitty'));
  await install(await plugin('throws', 'test.throws', 'Thrower', 'export function discover() { throw new Error("boom"); }'));
  await install(await plugin('slow', 'test.slow', 'Sleeper', 'export function discover() { return new Promise(() => {}); }'));
  await install(await plugin('invalid', 'test.invalid', 'Broken', 'export function discover(r) { return { apiVersion: r.apiVersion, requestId: r.requestId, suggestions: [{ key: "x", category: { key: "x", name: "X" }, evidence: [], uncertainty: "?" }] }; }'));
  await openDiscover();
  const list = page.locator('#discovery-provider-list');
  await expect(list.locator('li label')).toHaveText(['Kiro', 'Spec Kit', 'Trae', 'Spec Kitty', 'Thrower', 'Sleeper', 'Broken']);
  await expect(list.locator('li').filter({ hasText: 'Spec Kitty' })).toContainText('installed example.spec-kitty · kitty-specs work packages');
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  const status = page.locator('#discovery-status');
  await expect(status).toContainText('candidate groups', { timeout: 30000 });
  await expect(status).toContainText('Thrower (test.throws): Discovery failed or sent an invalid response.');
  await expect(status).toContainText('Sleeper (test.slow): Discovery timed out after 10 seconds.');
  await expect(status).toContainText('Broken (test.invalid): Suggestions without a rule need a keyword heading site');
  const work = entry('Work package · Spec Kitty');
  await work.locator(':scope > summary').click();
  await expect(work.locator('.discovery-provider')).toHaveText('Proposed by the Spec Kitty installed profile.');
  await expect(work).toContainText('3 work package prompts in 2 feature folders of kitty-specs/');
  await expect(entry('Subtask · Spec Kitty')).toHaveCount(1);
  const gaps = page.locator('#discovery-gaps li');
  await expect(gaps.first()).toContainText('Spec Kitty: 1 dependency between work packages');
  await expect(gaps.first().locator('button').first()).toBeVisible();
  // Turning the plugin off removes its suggestions and gaps at the next scan.
  await page.getByRole('checkbox', { name: 'Use the Spec Kitty provider', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: 'Use the Sleeper provider', exact: true }).uncheck();
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(status).toContainText('candidate groups', { timeout: 30000 });
  await expect(entry('Work package · Spec Kitty')).toHaveCount(0);
  await expect(page.locator('#discovery-gaps')).toBeHidden();
  await expect(status).not.toContainText('Sleeper');
});

test('profiles are installed and managed from the Project menu, apart from the abstractions', async () => {
  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.find(item => item.label === 'Project')!.submenu!.items.map(item => item.label));
  expect(labels).toEqual(['Project configuration…', '', 'Manage profiles…', 'Install profile folder…', 'Install profile archive (.zip)…']);
  // A profile is not an abstraction, and an abstraction is not a profile.
  const spec = path.resolve('examples/plugins/spec-kitty');
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, spec);
  const refusal = (kind?: 'profile') => page.evaluate(kind => window.specular.choosePlugin(kind).then(() => 'installed', (error: Error) => error.message), kind);
  expect(await refusal()).toContain('example.spec-kitty has no views, so it is not an abstraction');
  const view = path.join(root, 'view'); await mkdir(view);
  await writeFile(path.join(view, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(view, 'specular-plugin.json'), JSON.stringify({ manifestVersion: 1, id: 'test.view', version: '1.0.0', api: '0.2.0', entry: 'index.js', capabilities: ['workspace.read'], models: ['project@1'], views: [{ id: 'main', title: 'View', kind: 'list' }] }));
  await writeFile(path.join(view, 'index.js'), 'export function render() { return { type: "text", text: "" }; }');
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, view);
  expect(await refusal('profile')).toContain('test.view has no discovery contribution, so it is not a profile');
  // Through the menu, the refusal is shown as a notice.
  await menuAction(app, 'profile-install-folder');
  await expect(page.locator('#toast')).toContainText('test.view has no discovery contribution, so it is not a profile');
  await install(spec);
  await menuAction(app, 'profile-manager');
  await expect(page.locator('#plugin-manager-title')).toHaveText('Installed profiles');
  await expect(page.locator('.plugin-manager-item')).toHaveCount(1);
  await expect(page.locator('.plugin-manager-item')).toContainText('Profile for Spec Kitty');
  await page.locator('#plugin-manager-close').click();
  await menuAction(app, 'plugin-manager');
  await expect(page.locator('#plugin-manager-title')).toHaveText('Installed abstractions');
  await expect(page.locator('.plugin-manager-item').filter({ hasText: 'example.spec-kitty' })).toHaveCount(0);
});
