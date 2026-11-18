import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
import { menuAction } from './menu-action';
import { seedLegacyConfiguration } from './legacy-configuration';

// Increment 94a: a custom view requests summaries of an ID set; Specular builds the input, asks for consent, and stores JSON.
let app: ElectronApplication, page: Page, root: string, project: string;
const manifest = { manifestVersion: 1, id: 'test.summaries', title: 'Summary test', version: '1.0.0', api: '>=0.2.0 <0.3.0', entry: 'index.js', customApi: 2,
  capabilities: ['workspace.read', 'summary.generate'], models: ['project@1', 'physical@1'], views: [{ id: 'summary', title: 'Summary test', kind: 'custom' }] };
const code = `export function activate({ root, summaries }) {
  root.innerHTML = '<main><p id="has">' + String(!!summaries) + '</p><button id="gen">Generate</button><button id="get">Get</button><button id="bad">Bad</button><p id="out">ready</p></main>';
  const subject = { kind: 'ids', keys: ['REQ-2', 'REQ-1'], name: 'Pair' };
  const show = value => { root.querySelector('#out').textContent = value; };
  const fail = error => show('error:' + error.message);
  if (summaries) {
    root.querySelector('#gen').onclick = () => summaries.generate(subject, { agent: 'claude' }).then(r => show('generated:' + r.text + '|' + r.citedIds.join(',') + '|' + r.unknownCitations.join(',')), fail);
    root.querySelector('#get').onclick = () => summaries.get(subject).then(r => show(r ? 'stored:' + r.name + '|' + JSON.stringify(r.changes) : 'none'), fail);
    root.querySelector('#bad').onclick = () => summaries.generate({ kind: 'file', path: 'a.md' }, { agent: 'claude' }).then(() => show('unexpected'), fail);
  }
  return { update() {} };
}`;
const requirements = '# REQ-1 First\n\nStatus: Implemented\n\n# REQ-2 Second\n\nSee REQ-1.\n';
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/summaries-')); project = path.join(root, 'project');
  await mkdir(project); await writeFile(path.join(project, 'requirements.md'), requirements);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  await seedLegacyConfiguration(project);
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#lens-results .lens-card').first()).toBeVisible();
  // The agent call is stubbed: it records the input Specular built and answers with two citations, one unknown.
  await app.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('summary:run');
    ipcMain.handle('summary:run', (_event, request) => { (globalThis as any).summaryInputs = [...((globalThis as any).summaryInputs ?? []), request]; return { ok: true, text: 'The pair covers [REQ-1] and [REQ-9].' }; });
  });
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
});
async function install(directory: string, value: Record<string, unknown>) {
  await mkdir(directory); await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(directory, 'specular-plugin.json'), JSON.stringify(value)); await writeFile(path.join(directory, 'index.js'), code);
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, directory);
  await menuAction(app, 'plugin-install-folder');
  return pluginFrame(app, '#has');
}

test('a custom view gets summaries of an ID set after consent, stored as JSON with changes and citations', async () => {
  let frame = await install(path.join(root, 'plugin'), manifest);
  const out = frame.locator('#out'), consent = page.locator('#summary-consent-dialog');
  await expect(frame.locator('#has')).toHaveText('true');
  await frame.locator('#get').click(); await expect(out).toHaveText('none');
  await frame.locator('#gen').click();
  await expect(consent).toBeVisible(); await expect(consent).toContainText('To summarize Pair, Specular sends about 1 KB');
  await page.locator('#summary-consent-cancel').click();
  await expect(out).toHaveText('error:Summaries were not allowed for this project.');
  await expect.poll(() => readdir(path.join(project, '.specular')).then(files => files.filter(file => file !== 'project.json')).catch(() => [])).toEqual([]);
  await frame.locator('#gen').click(); await page.locator('#summary-consent-allow').click();
  await expect(out).toHaveText('generated:The pair covers [REQ-1] and [REQ-9].|REQ-1|REQ-9');
  const inputs = await app.evaluate(() => (globalThis as any).summaryInputs);
  expect(inputs).toHaveLength(1); expect(inputs[0].agent).toBe('claude');
  expect(inputs[0].input).toMatch(/^Subject: Pair \(2 IDs\)\n\nIDs:\n- REQ-1 \[REQ\] First \(status: Implemented\)\n- REQ-2 \[REQ\] Second\n\nRecorded links \(an ID mentioned in the section that defines another\):\n- REQ-2 mentions REQ-1 \(1 time\)\n\nDefinitions:\n\n## REQ-1 \(requirements\.md:1\)/);
  expect(await readdir(path.join(project, '.specular', 'summaries', 'ids'))).toHaveLength(1);
  await frame.locator('#get').click();
  await expect(out).toHaveText('stored:Pair|{"added":[],"removed":[],"changed":[],"instruction":false}');
  await frame.locator('#gen').click(); await expect(out).toHaveText(/^generated:/); await expect(consent).toBeHidden();
  await writeFile(path.join(project, 'requirements.md'), requirements.replace('# REQ-2 Second', '# REQ-2 Renamed'));
  await page.locator('#refresh').click(); await expect(page.locator('#lens-results')).toContainText('Renamed');
  frame = await pluginFrame(app, '#has');
  await frame.locator('#get').click();
  await expect(frame.locator('#out')).toHaveText('stored:Pair|{"added":[],"removed":[],"changed":[{"key":"REQ-2","fields":["title","excerpt"]}],"instruction":false}');
  await frame.locator('#bad').click(); await expect(frame.locator('#out')).toHaveText('error:Unsupported summary subject.');
  await page.locator('#show-agent-setup').click();
  await expect(page.locator('#summary-consent-setting')).toBeVisible();
  await page.locator('#summary-consent-revoke').click(); await expect(page.locator('#summary-consent-setting')).toBeHidden();
  await page.locator('#agent-setup-close').click();
  frame = await pluginFrame(app, '#has');
  await frame.locator('#gen').click(); await expect(consent).toBeVisible();
  await page.keyboard.press('Escape'); await expect(frame.locator('#out')).toHaveText('error:Summaries were not allowed for this project.');
});

test('a custom view without the capability gets no summaries API', async () => {
  const frame = await install(path.join(root, 'plain'), { ...manifest, id: 'test.plain', capabilities: ['workspace.read'] });
  await expect(frame.locator('#has')).toHaveText('false');
});

test('a failed agent call reports its message and keeps the previous summary', async () => {
  const frame = await install(path.join(root, 'plugin'), manifest);
  await frame.locator('#gen').click(); await page.locator('#summary-consent-allow').click();
  await expect(frame.locator('#out')).toHaveText(/^generated:/);
  const [file] = await readdir(path.join(project, '.specular', 'summaries', 'ids'));
  const before = await readFile(path.join(project, '.specular', 'summaries', 'ids', file), 'utf8');
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('summary:run'); ipcMain.handle('summary:run', () => ({ ok: false, message: 'Claude Code stopped: overloaded' })); });
  await frame.locator('#gen').click();
  await expect(frame.locator('#out')).toHaveText('error:Claude Code stopped: overloaded');
  expect(await readFile(path.join(project, '.specular', 'summaries', 'ids', file), 'utf8')).toBe(before);
  await frame.locator('#get').click(); await expect(frame.locator('#out')).toHaveText(/^stored:Pair\|/);
});
