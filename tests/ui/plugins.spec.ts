import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
import { failAutosave } from './autosave-fixture';
let app: ElectronApplication, page: Page, project: string, root: string;
const text = '# REQ-001 - First requirement\nSome text.\n';
const base = { manifestVersion: 1, id: 'test.plugin', version: '0.1.0', api: '0.2.0', entry: 'index.js', capabilities: ['workspace.read', 'source.navigate'], models: ['project@1', 'physical@1'], views: [{ id: 'definitions', title: 'Test plugin', kind: 'list' }] };
async function launch(contents = text, extra: Record<string, string> = {}) {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/plugins-'));
  project = path.join(root, 'project'); await mkdir(project); await writeFile(path.join(project, 'requirements.md'), contents);
  for (const [file, value] of Object.entries(extra)) {
    await mkdir(path.dirname(path.join(project, file)), { recursive: true });
    await writeFile(path.join(project, file), value);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  const args = ['--project=' + project];
  app = await electron.launch({ ...(process.env.SPECULAR_TEST_PACKAGED ? { executablePath: path.resolve('out', `Specular-${process.platform}-${process.arch}`, 'Specular.exe'), args } : { args: ['.', ...args] }), env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#lens-results .lens-card').first()).toBeVisible();
  await failAutosave(app);
}
async function relaunch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#lens-results .lens-card').first()).toBeVisible();
  await failAutosave(app);
}
async function choose(directory: string) {
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, directory);
  await page.locator('#plugin-view-open').click();
  await expect(page.locator('.plugin-view')).toBeVisible();
}
async function fixture(code: string, kind = 'list', capabilities = base.capabilities, manifest: Record<string, unknown> = {}) {
  const directory = path.join(root, 'plugin'); await mkdir(directory);
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  await writeFile(path.join(directory, 'specular-plugin.json'), JSON.stringify({ ...base, capabilities, views: [{ ...base.views[0], kind }], ...manifest }));
  await writeFile(path.join(directory, 'index.js'), code);
  await choose(directory);
}
const result = (model: string) => `({apiVersion:r.apiVersion,requestId:r.requestId,viewId:r.viewId,projectId:r.context.projectId,revision:r.context.revision,model:${model}})`;
test.afterEach(async ({}, info) => {
  if (app) { if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});
test('independently built sample renders, navigates, refreshes unsaved text, and disposes on close', async () => {
  await launch();
  await choose((await readFile('.cache/plugin-sdk/example-path.txt', 'utf8')).trim());
  await expect(page.locator('.plugin-list-item')).toContainText('REQ-001');
  await expect(page.locator('.plugin-evidence button').first()).toHaveText('Open requirements.md:1');
  await page.locator('.plugin-evidence button').first().click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n# REQ-002 - Unsaved requirement\n');
  await page.getByRole('tab', { name: 'Specification index', exact: true }).click();
  await expect(page.locator('.plugin-list-item')).toHaveCount(2);
  await page.screenshot({ path: '.cache/plugin-sdk/plugin-view.png' });
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(text);
  const count = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length);
  await expect.poll(count).toBe(2);
  await page.keyboard.press('Control+w');
  await expect.poll(count).toBe(1);
});
const timelineFixture = ['# REQ-001 - Timeline fixture', 'Last updated: 2020-01-01', '- 2026-09-15: Later REQ-001', '- 2025-02-28: Earlier', '  Continued DD-001', '- 2025-02-30: Invalid', '> - 2024-01-01: Quoted', '```md', '- 2024-01-01: Fenced', '```', '- Undated entry'].join('\n');
// A nested same-basename CRLF file and a root notes file make the project scope observable.
const timelineNested = ['- 2025-02-28: Nested same day', '- 2024-02-29: Leap day TASK-007', ''].join('\r\n');
const timelineRoot = '- 2027-01-01: Root notes REQ-001\n';
async function openTimeline() {
  await launch(timelineFixture, { 'specs/notes.md': timelineNested, 'notes.md': timelineRoot });
  await choose((await readFile('.cache/plugin-sdk/timeline-example-path.txt', 'utf8')).trim());
  await expect(page.locator('#toast')).toBeHidden();
  return pluginFrame(app, '#project-timeline');
}
test('independently built project timeline collects dated entries from every project Markdown file', async () => {
  const frame = await openTimeline();
  await expect(frame.locator('#project-timeline h3')).toHaveText(['2024-02-29', '2025-02-28', '2026-09-15', '2027-01-01']);
  await expect(frame.locator('.timeline-event')).toHaveCount(5);
  await expect(frame.locator('.timeline-event').nth(0)).toContainText('Leap day TASK-007');
  await expect(frame.locator('.timeline-event').nth(0)).toContainText('Mentioned IDs: TASK-007');
  await expect(frame.locator('.timeline-event').nth(0)).toContainText('specs/notes.md');
  await expect(frame.locator('.timeline-event').nth(1)).toContainText('Earlier\nContinued DD-001');
  await expect(frame.locator('.timeline-event').nth(2)).toContainText('Nested same day');
  await expect(frame.locator('.timeline-event').nth(4)).toContainText('Root notes REQ-001');
  await expect(frame.locator('#timeline-summary')).toHaveText('5 of 5 event(s) from 3 of 3 contributing file(s); 3 Markdown file(s) in scope.');
  for (const ignored of ['Invalid', 'Quoted', 'Fenced', 'Undated', '2020-01-01']) await expect(frame.locator('#project-timeline')).not.toContainText(ignored);
  await expect(frame.locator('#timeline-file option')).toHaveText(['All files', 'notes.md', 'requirements.md', 'specs/notes.md']);
  await expect(frame.locator('#timeline-id option')).toHaveText(['All mentioned IDs', 'DD-001', 'REQ-001', 'TASK-007']);
  await expect(frame.locator('.timeline-scope')).toContainText('claim no time-of-day ordering');
  // Startup opens notes.md, so requirements.md and specs/notes.md are discovered without being opened.
  await expect(page.locator('#document-path')).toHaveText('notes.md');
  // Unsaved editor text joins the project collection without reaching disk.
  await page.getByRole('tab', { name: 'notes.md', exact: true }).click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n- 2023-01-02: Unsaved project event\n');
  await page.getByRole('tab', { name: 'Project timeline', exact: true }).click();
  const refreshed = await pluginFrame(app, '#project-timeline');
  await expect(refreshed.locator('.timeline-event')).toHaveCount(6);
  await expect(refreshed.locator('.timeline-event').first()).toContainText('Unsaved project event');
  await expect(refreshed.locator('.timeline-event').first()).toContainText('notes.md');
  await expect(refreshed.locator('#timeline-summary')).toContainText('6 of 6 event(s) from 3 of 3 contributing file(s)');
  expect(await readFile(path.join(project, 'notes.md'), 'utf8')).toBe(timelineRoot);
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(timelineFixture);
});
test('project timeline filters and counts events, states no matches, and keeps filters across evidence navigation', async () => {
  let frame = await openTimeline();
  await frame.locator('#timeline-file').selectOption('specs/notes.md');
  await expect(frame.locator('.timeline-event')).toHaveCount(2);
  await expect(frame.locator('#timeline-summary')).toContainText('2 of 5 event(s) from 1 of 3 contributing file(s)');
  await frame.locator('#project-timeline').getByRole('button', { name: 'Show all events', exact: true }).click();
  await expect(frame.locator('.timeline-event')).toHaveCount(5);
  await frame.locator('#timeline-id').selectOption('REQ-001');
  await expect(frame.locator('.timeline-event')).toHaveCount(2);
  await frame.locator('#timeline-file').selectOption('notes.md');
  await expect(frame.locator('.timeline-event')).toHaveCount(1);
  await expect(frame.locator('#timeline-summary')).toContainText('1 of 5 event(s) from 1 of 3 contributing file(s)');
  await frame.locator('#timeline-id').selectOption('TASK-007');
  await expect(frame.locator('.timeline-event')).toHaveCount(0);
  await expect(frame.locator('#project-timeline')).toContainText('No events match these filters.');
  await frame.locator('#project-timeline').getByRole('button', { name: 'Show all events', exact: true }).click();
  // Every control is labelled and focusable inside the plugin's own surface.
  await frame.locator('#timeline-from').focus();
  expect(await frame.evaluate(() => document.activeElement?.id)).toBe('timeline-from');
  // Inclusive endpoints, then a range that ends before it starts.
  await frame.locator('#timeline-from').fill('2025-02-28'); await frame.locator('#timeline-to').fill('2025-02-28');
  await expect(frame.locator('.timeline-event')).toHaveCount(2);
  await expect(frame.locator('#project-timeline h3')).toHaveText(['2025-02-28']);
  await frame.locator('#timeline-to').fill('2024-01-01');
  await expect(frame.locator('#project-timeline')).toContainText('2025-02-28 is later than 2024-01-01');
  await expect(frame.locator('.timeline-event')).toHaveCount(0);
  await frame.locator('#timeline-to').fill('2025-02-28');
  await frame.locator('#timeline-file').selectOption('specs/notes.md');
  await expect(frame.locator('.timeline-event')).toHaveCount(1);
  // Evidence opens the exact entry in another file, including a CRLF source.
  await frame.locator('.timeline-event').first().getByRole('button', { name: 'Open specs/notes.md:1', exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText('specs/notes.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toContain('2025-02-28: Nested same day');
  // The project scope ignores the active document, and session filters survive the reopened surface.
  await page.getByRole('tab', { name: 'Project timeline', exact: true }).click();
  frame = await pluginFrame(app, '#project-timeline');
  await expect(frame.locator('#timeline-file')).toHaveValue('specs/notes.md');
  await expect(frame.locator('#timeline-to')).toHaveValue('2025-02-28');
  await expect(frame.locator('.timeline-event')).toHaveCount(1);
  await frame.locator('#project-timeline').getByRole('button', { name: 'Show all events', exact: true }).click();
  await expect(frame.locator('.timeline-event')).toHaveCount(5);
  expect(await readFile(path.join(project, 'specs/notes.md'), 'utf8')).toBe(timelineNested);
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(timelineFixture);
});
test('project timeline histogram stacks entries by file and drives the date and file filters', async () => {
  const frame = await openTimeline();
  const chart = frame.locator('#timeline-chart'), bars = chart.locator('.chart-hit');
  // 2024-02-29 to 2027-01-01 spans more than 104 weeks, so buckets are months, empty ones included.
  await expect(chart).toContainText('Dated entries per month, 2024-02-01 to 2027-01-31');
  await expect(bars).toHaveCount(36);
  await expect(chart.locator('.chart-key')).toHaveText(['requirements.md (2)', 'specs/notes.md (2)', 'notes.md (1)']);
  await expect(chart.locator('.chart-faint')).toHaveCount(5);
  await expect(chart.locator('.chart-solid')).toHaveCount(5);
  await expect(chart.locator('.chart-table tr')).toHaveCount(5);
  await expect(bars.nth(12)).toHaveAttribute('aria-label', /^2025-02-01 to 2025-02-28: 2 entries, 2 matching the file and ID filters; requirements\.md 1; specs\/notes\.md 1\.$/);
  // A bar click sets the bucket's inclusive bounds and highlights the range without zooming.
  await bars.nth(12).click();
  await expect(frame.locator('#timeline-from')).toHaveValue('2025-02-01');
  await expect(frame.locator('#timeline-to')).toHaveValue('2025-02-28');
  await expect(frame.locator('.timeline-event')).toHaveCount(2);
  await expect(chart.locator('.chart-range')).toHaveCount(1);
  await expect(bars).toHaveCount(36);
  // The legend sets the file filter; non-matching entries stay visible but faint.
  await chart.getByRole('button', { name: 'specs/notes.md (2)', exact: true }).click();
  await expect(frame.locator('#timeline-file')).toHaveValue('specs/notes.md');
  await expect(chart.getByRole('button', { name: 'specs/notes.md (2)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(chart.locator('.chart-faint')).toHaveCount(5);
  await expect(chart.locator('.chart-solid')).toHaveCount(2);
  await expect(frame.locator('.timeline-event')).toHaveCount(1);
  await frame.locator('#project-timeline').getByRole('button', { name: 'Show all events', exact: true }).click();
  await expect(chart.locator('.chart-range')).toHaveCount(0);
  await expect(frame.locator('.timeline-event')).toHaveCount(5);
  // Dragging across bars selects the covered range.
  await bars.nth(0).dragTo(bars.nth(12));
  await expect(frame.locator('#timeline-from')).toHaveValue('2024-02-01');
  await expect(frame.locator('#timeline-to')).toHaveValue('2025-02-28');
  await expect(frame.locator('.timeline-event')).toHaveCount(3);
  // Keyboard: End moves to the last bucket and Enter selects it, keeping focus on the chart.
  await bars.nth(0).focus(); await bars.nth(0).press('End');
  await expect(chart.locator('.chart-readout')).toContainText('2027-01-01 to 2027-01-31: 1 entry');
  await bars.nth(35).press('Enter');
  await expect(frame.locator('#timeline-from')).toHaveValue('2027-01-01');
  await expect(frame.locator('.timeline-event')).toHaveCount(1);
  expect(await frame.evaluate(() => document.activeElement?.getAttribute('data-index'))).toBe('35');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(timelineFixture);
});
test('project timeline shows dated statuses from the project model with type and status filters', async () => {
  const configuration = { version: 1, categories: [{ key: 'REQ', name: 'Requirements', role: 'requirement' }], rules: [{ key: 'REQ', category: 'REQ', prefix: 'REQ' }],
    statuses: [{ name: 'Implemented', rules: [{ mode: 'startsWith', value: 'Implemented' }], colors: { light: '#116633', dark: '#88dd99' } }, { name: 'Unused' }] };
  const text = '# REQ-001 - First requirement\n\nStatus: Implemented on 2026-10-13.\n\n- 2026-10-14: Follow-up for REQ-001\n\n# REQ-002 - Second requirement\n\nStatus: Confirmed\n';
  await launch(text, { '.specular/project.json': JSON.stringify(configuration) });
  await choose((await readFile('.cache/plugin-sdk/timeline-example-path.txt', 'utf8')).trim());
  const frame = await pluginFrame(app, '#project-timeline');
  // One recorded entry and one dated status; the undated status is not an event.
  await expect(frame.locator('.timeline-event')).toHaveCount(2);
  const status = frame.locator('.timeline-event[data-kind="status"]');
  await expect(status).toContainText('REQ-001');
  await expect(status.locator('.timeline-status')).toHaveText('Status: Implemented');
  expect(['rgb(17, 102, 51)', 'rgb(136, 221, 153)']).toContain(await status.locator('.timeline-status').evaluate(node => getComputedStyle(node).borderLeftColor));
  await expect(frame.locator('#project-timeline h3')).toHaveText(['2026-10-13', '2026-10-14']);
  await expect(frame.locator('#timeline-status option')).toHaveText(['All statuses', 'Implemented', 'Unused']);
  await frame.locator('#timeline-kind').selectOption('status');
  await expect(frame.locator('.timeline-event')).toHaveCount(1);
  await frame.locator('#timeline-kind').selectOption('entry');
  await expect(frame.locator('.timeline-event')).toHaveCount(1);
  await expect(frame.locator('.timeline-event')).toContainText('Follow-up for REQ-001');
  await frame.locator('#timeline-kind').selectOption('');
  await frame.locator('#timeline-status').selectOption('Unused');
  await expect(frame.locator('.timeline-event')).toHaveCount(0);
  await expect(frame.locator('#project-timeline')).toContainText('No events match these filters.');
  await frame.locator('#project-timeline').getByRole('button', { name: 'Show all events', exact: true }).click();
  await expect(frame.locator('.timeline-event')).toHaveCount(2);
  // A status event opens the exact date text it was dated by.
  await status.getByRole('button', { name: 'Open requirements.md:3', exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('on 2026-10-13');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(text);
});
test('project timeline shows dated headings and labelled fields as milestones', async () => {
  const text = '# Feature Specification: Demo\n\n**Created**: 2025-12-12\n**Last Updated**: 2026-06-05\n\n## [1.0.0] - 2026-01-02\n\n- 2026-01-03: Recorded entry\n\n# REQ-001 - Demo requirement\n';
  await launch(text);
  await choose((await readFile('.cache/plugin-sdk/timeline-example-path.txt', 'utf8')).trim());
  const frame = await pluginFrame(app, '#project-timeline');
  // Default rules: Created and the release heading are milestones; Last Updated is a disabled snapshot rule.
  await expect(frame.locator('.timeline-event')).toHaveCount(3);
  await expect(frame.locator('#project-timeline h3')).toHaveText(['2025-12-12', '2026-01-02', '2026-01-03']);
  const created = frame.locator('.timeline-event').nth(0), release = frame.locator('.timeline-event').nth(1);
  await expect(created.locator('.timeline-label')).toHaveText('Created');
  await expect(created).toContainText('Feature Specification: Demo');
  await expect(release.locator('.timeline-label')).toHaveText('Heading');
  await expect(release).toContainText('[1.0.0]');
  await expect(frame.locator('#timeline-kind option')).toHaveText(['All event types', 'Recorded entries', 'Statuses', 'Milestones', 'Last updated']);
  await frame.locator('#timeline-kind').selectOption('milestone');
  await expect(frame.locator('.timeline-event')).toHaveCount(2);
  await frame.locator('#timeline-kind').selectOption('entry');
  await expect(frame.locator('.timeline-event')).toHaveCount(1);
  await frame.locator('#project-timeline').getByRole('button', { name: 'Show all events', exact: true }).click();
  // Like recorded entries, a field event opens its whole source line.
  await created.getByRole('button', { name: 'Open requirements.md:3', exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('**Created**: 2025-12-12');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(text);
});
test('project timeline package replaces its own installed identity and keeps the view working', async () => {
  const frame = await openTimeline();
  await expect(frame.locator('.timeline-event')).toHaveCount(5);
  // Selecting the same identity again is an explicit replacement, not a second package.
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await page.locator('#plugin-view-open').click();
  await expect(page.locator('#toast')).toBeHidden();
  await page.locator('#plugin-manager-open').click();
  const item = page.locator('.plugin-manager-item').filter({ hasText: 'example.document-timeline' });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('v0.6.0');
  await expect(item).toContainText('1 view(s) · workspace.read, source.navigate');
  await item.getByRole('button', { name: 'Open', exact: true }).click();
  const replaced = await pluginFrame(app, '#project-timeline');
  await expect(replaced.locator('.timeline-event')).toHaveCount(5);
  await expect(replaced.locator('#timeline-summary')).toContainText('5 of 5 event(s)');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(timelineFixture);
});
test('custom definition browser shows configured statuses and colours from the project model', async () => {
  const configuration = { version: 1, categories: [{ key: 'REQ', name: 'Requirements', role: 'requirement' }], rules: [{ key: 'REQ', category: 'REQ', prefix: 'REQ' }],
    statuses: [{ name: 'Implemented', rules: [{ mode: 'startsWith', value: 'Implemented' }], colors: { light: '#116633', dark: '#88dd99' } }] };
  await launch('# REQ-001 - First requirement\n\nStatus: Implemented on 2026-10-13.\n\n# REQ-002 - Second requirement\n\nNo status here.\n', { '.specular/project.json': JSON.stringify(configuration) });
  await choose((await readFile('.cache/plugin-sdk/custom-example-path.txt', 'utf8')).trim());
  const frame = await pluginFrame(app, '#plugin-root main');
  await expect(frame.locator('article')).toHaveCount(2);
  await expect(frame.locator('article').filter({ hasText: 'REQ-001' }).locator('.status')).toHaveText('Status: Implemented');
  await expect(frame.locator('article').filter({ hasText: 'REQ-002' }).locator('.status')).toHaveText('No status');
  const border = await frame.locator('article').filter({ hasText: 'REQ-001' }).locator('.status').evaluate(node => getComputedStyle(node).borderLeftColor);
  expect(['rgb(17, 102, 51)', 'rgb(136, 221, 153)']).toContain(border);
});
test('second public-API example installs and receives current document snapshots', async () => {
  await launch('# REQ-001 - First\n');
  await choose((await readFile('.cache/plugin-sdk/headings-example-path.txt', 'utf8')).trim());
  await expect(page.locator('.plugin-list-item')).toContainText('First');
  await page.locator('.plugin-evidence button').click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n## Unsaved second heading');
  await page.getByRole('tab', { name: 'Document headings', exact: true }).click();
  await expect(page.locator('.plugin-list-item')).toHaveCount(2);
  await expect(page.locator('.plugin-list-item').last()).toContainText('Unsaved second heading');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe('# REQ-001 - First\n');
});
test('custom plugin owns an isolated interactive interface and uses validated source navigation', async () => {
  await launch();
  await fixture(`export async function activate({root,request,openSource}) {
    const blocked=[];
    for(const action of [()=>import('node:fs'),()=>fetch('file:///C:/Windows/win.ini'),()=>fetch('https://example.com/'),()=>showOpenFilePicker()]) { try { await action(); blocked.push(false); } catch { blocked.push(true); } }
    blocked.push(window.open('https://example.com/')===null);
    root.innerHTML = '<style>main{padding:24px}button,input{display:block;margin:12px 0;padding:8px}</style><main><h1>Custom definitions</h1><label>Filter<input id="filter"></label><p id="count"></p><button id="open">Open first definition</button><p id="isolation"></p></main>';
    const paint = r => {
      const definitions = r.models.project.occurrences.filter(o => o.kind === 'definition');
      root.querySelector('#count').textContent = definitions.length + ' definitions at revision ' + r.context.revision;
      root.querySelector('#open').onclick = () => { const item=definitions[0]; if(item) openSource({...item.source,projectId:r.context.projectId,revision:r.context.revision}); };
      root.querySelector('#isolation').textContent = ['node:'+String(typeof process==='undefined'&&typeof require==='undefined'),'app-dom:'+String(typeof window.specular==='undefined'&&typeof window.supervisor==='undefined'&&!document.querySelector('#workspace')),'blocked:'+blocked.join(',')].join(' ');
    };
    root.querySelector('#filter').onkeydown=e=>root.querySelector('#filter').dataset.lastKey=e.key;
    paint(request); return {update:paint};
  }`, 'custom');
  const openBounds = await page.locator('#plugin-view-open').boundingBox(), loadedBounds = await page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])').boundingBox(), dependencyBounds = await page.locator('#dependency-overview-open').boundingBox();
  expect(openBounds && loadedBounds && loadedBounds.y >= openBounds.y + openBounds.height + 4).toBe(true);
  expect(loadedBounds && dependencyBounds && dependencyBounds.y >= loadedBounds.y + loadedBounds.height + 4).toBe(true);
  const custom = (script: string) => app.evaluate(async ({ webContents }, script) => {
    const contents = webContents.getAllWebContents();
    const view = contents.find(item => item.getURL().startsWith('specular-plugin://host/custom.html'));
    if (!view) return undefined;
    const frame = view.mainFrame.frames.find(item => item.url.startsWith('specular-plugin-ui://'));
    return frame?.executeJavaScript(script);
  }, script);
  await expect(page.locator('.plugin-view [role=status]')).toContainText('isolated read-only interface');
  await expect.poll(() => custom(`document.querySelector('#count')?.textContent`)).toContain('1 definitions');
  expect(await custom(`document.querySelector('#isolation').textContent`)).toBe('node:true app-dom:true blocked:true,true,true,true,true');
  await app.evaluate(async ({ webContents }) => {
    const view=webContents.getAllWebContents().find(item => item.getURL().includes('/custom.html'))!;
    view.focus(); const frame=view.mainFrame.frames.find(item => item.url.startsWith('specular-plugin-ui://'))!;
    await frame.executeJavaScript(`window.focus(); const input=document.querySelector('#filter'); input.focus(); input.dispatchEvent(new KeyboardEvent('keydown',{key:'x',bubbles:true}))`);
  });
  expect(await custom(`document.activeElement.id`)).toBe('filter');
  expect(await custom(`document.querySelector('#filter').dataset.lastKey`)).toBe('x');
  await custom(`document.querySelector('#open').click()`);
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('REQ-001');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\n# REQ-002 - Unsaved requirement\n');
  await page.getByRole('tab', { name: 'Test plugin', exact: true }).click();
  await expect.poll(() => custom(`document.querySelector('#count')?.textContent`)).toContain('2 definitions');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(text);
  const surfaces = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].contentView.children.map(view => view.getBounds()));
  expect(surfaces.some(bounds => bounds.width > 100 && bounds.height > 100)).toBe(true);
});
test('custom interface crash removes its surface and close/reopen creates a fresh sandbox', async () => {
  await launch(); await fixture(`export function activate({root}){root.textContent='Custom ready';return {update(){}}}`, 'custom');
  await expect(page.locator('.plugin-view [role=status]')).toContainText('isolated read-only interface');
  await app.evaluate(({ webContents }) => { const target=webContents.getAllWebContents().find(item => item.getURL().includes('/custom.html'))!; setTimeout(()=>target.forcefullyCrashRenderer(),0); });
  await expect(page.locator('.plugin-view [role=status]')).toContainText('process stopped');
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(item => item.getURL().startsWith('specular-plugin')).length)).toBe(0);
  await page.getByRole('button', { name: 'Close Test plugin', exact: true }).click();
  await page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])').click();
  await expect(page.locator('.plugin-view [role=status]')).toContainText('isolated read-only interface');
});
test('project switching revokes a custom surface and reopening receives only the new project', async () => {
  await launch(); await fixture(`export function activate({root,request}){const paint=r=>root.textContent=r.models.physical.documents.map(d=>d.text).join('');paint(request);return {update:paint}}`, 'custom');
  await expect(page.locator('.plugin-view [role=status]')).toContainText('isolated read-only interface');
  const second = path.join(root, 'second-custom'); await mkdir(second); await writeFile(path.join(second, 'requirements.md'), '# REQ-099 - Second project\n');
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, second);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#open-project')!.click());
  await expect(page.locator('#lens-results .lens-card').first()).toContainText('REQ-099');
  await expect.poll(() => app.evaluate(({ webContents }) => webContents.getAllWebContents().filter(item => item.getURL().startsWith('specular-plugin')).length)).toBe(0);
  await page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])').click();
  await expect(page.locator('.plugin-view [role=status]')).toContainText('isolated read-only interface');
  await expect.poll(() => app.evaluate(async ({ webContents }) => {
    const view = webContents.getAllWebContents().find(item => item.getURL().includes('/custom.html'));
    const frame = view?.mainFrame.frames.find(item => item.url.startsWith('specular-plugin-ui://'));
    return frame?.executeJavaScript('document.body.innerText');
  })).toContain('REQ-099');
});
test('a plugin receives only the models it declares, with the physical model describing the project', async () => {
  await launch(text, { 'specs/notes.md': '# Notes\n', 'src/a.ts': 'export {};\n' });
  await fixture(`export function render(r){ const p=r.models.physical; return ${result("{kind:'list',items:[{id:'keys',title:'models:'+Object.keys(r.models).sort().join(',')},{id:'folders',title:'folders:'+p.folders.slice().sort().join(',')},{id:'files',title:'files:'+p.files.map(f=>f.path+(f.markdown?'(md)':'')).sort().join(',')},{id:'docs',title:'documents:'+p.documents.map(d=>d.file).sort().join(',')},{id:'env',title:'envelope:'+p.name+'@'+p.version+':'+(p.revision===r.context.revision)+':'+p.provenance.extractor+':'+p.ready},{id:'legacy',title:'snapshot:'+String(r.snapshot===undefined)}]}")}; }`, 'list', base.capabilities, { models: ['physical@1'] });
  await expect(page.locator('.plugin-list-item')).toHaveText(['models:physical', 'folders:specs,src', 'files:requirements.md(md),specs/notes.md(md),src/a.ts', 'documents:requirements.md,specs/notes.md', 'envelope:physical@1:true:specular.physical:true', 'snapshot:true']);
});
test('a plugin built for API 0.1 is reported incompatible and never runs', async () => {
  await launch();
  const directory = path.join(root, 'legacy'); await mkdir(directory);
  await writeFile(path.join(directory, 'package.json'), '{"type":"module"}');
  const legacy: Record<string, unknown> = { ...base, api: '>=0.1.0 <0.2.0' }; delete legacy.models;
  await writeFile(path.join(directory, 'specular-plugin.json'), JSON.stringify(legacy));
  await writeFile(path.join(directory, 'index.js'), 'throw new Error("LEGACY ENTRY MUST NOT RUN");');
  await app.evaluate(({ dialog }, value) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [value] }); }, directory);
  await page.locator('#plugin-view-open').click();
  await expect(page.locator('#toast')).toContainText('incompatible API range');
  await expect(page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])')).toHaveCount(0);
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(text);
});
test('worker denies Node, DOM, bridge, file/network imports, sockets, filesystem and credentials', async () => {
  await launch();
  await fixture(`export async function render(r) {
    const checks = [];
    checks.push(['node', typeof process === 'undefined' && typeof require === 'undefined']);
    checks.push(['dom', typeof window === 'undefined' && typeof document === 'undefined']);
    checks.push(['bridge', typeof specular === 'undefined' && typeof supervisor === 'undefined']);
    checks.push(['credentials', typeof localStorage === 'undefined' && typeof navigator.credentials === 'undefined']);
    checks.push(['picker', typeof showOpenFilePicker === 'undefined']);
    for (const [name, action] of [
      ['fs-import', () => import('node:fs')],
      ['process-import', () => import('node:child_process')],
      ['remote-import', () => import('https://example.com/evil.js')],
      ['file-fetch', () => fetch('file:///C:/Windows/win.ini')],
      ['network', () => fetch('https://example.com/')],
      ['socket', () => new Promise((resolve, reject) => { const s = new WebSocket('wss://example.com'); s.onopen = resolve; s.onerror = reject; })],
      ['filesystem-path', async () => (await navigator.storage.getDirectory()).getFileHandle('../../Windows/win.ini', {create:true})],
    ]) { let denied = false; try { await action(); } catch { denied = true; } checks.push([name, denied]); }
    return ${result("{kind:'list',items:checks.map(([id,denied])=>({id,title:id+':'+denied}))}")};
  }`);
  await expect(page.locator('.plugin-list-item')).toHaveCount(12);
  await expect(page.locator('.plugin-view')).not.toContainText(':false');
  const preferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => !w.isVisible()).map(w => (w.webContents as unknown as { getLastWebPreferences(): object }).getLastWebPreferences()));
  expect(preferences[0]).toMatchObject({ sandbox: true, nodeIntegration: false, contextIsolation: true, nodeIntegrationInWorker: false });
});
for (const [name, code, expected] of [
  ['malformed', 'export function render(){ return {bad:true}; }', /Invalid|invalid/],
  ['oversized', `export function render(){ return {text:'x'.repeat(1100000)}; }`, /failed|invalid/],
  ['unsolicited disposal', "export function render(){ self.postMessage({type:'disposed'}); return new Promise(()=>{}); }", /failed|invalid/],
  ['crash', 'export function render(){ throw new Error("failure"); }', /failed|invalid/],
  ['timeout', 'export function render(){ while(true){} }', /timed out/],
  ['stale evidence', `export function render(r){return ${result("{kind:'list',items:[{id:'a',title:'stale',sources:[{projectId:'foreign',revision:r.context.revision,file:'requirements.md',start:0,end:7}]}]}")};}`, /Invalid|invalid/],
] as const) test(`${name} stops the plugin while the document remains usable`, async () => {
  await launch(); await fixture(code);
  await expect(page.locator('.plugin-view [role=status]')).toContainText(expected, { timeout: 15000 });
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await page.getByRole('button', { name: 'Dependency overview', exact: true }).click();
  await expect((await pluginFrame(app)).locator('#dependency-overview')).toBeVisible();
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(text);
});
test('graph nodes and edges expose validated source evidence through shared rendering', async () => {
  await launch(); await fixture(`export function render(r){ const s={projectId:r.context.projectId,revision:r.context.revision,file:'requirements.md',start:2,end:9}; return ${result("{kind:'graph',nodes:[{id:'A',label:'First',sources:[s]},{id:'B',label:'Second'}],edges:[{id:'link',from:'A',to:'B',label:'Depends on',sources:[s]}]}")}; }`, 'graph');
  await expect(page.locator('.dependency-graph-node')).toHaveCount(2);
  await expect(page.locator('.dependency-graph-edge')).toHaveCount(1);
  await page.getByRole('button', { name: 'Inspect A', exact: true }).click();
  await expect(page.locator('.plugin-inspector')).toContainText('First');
  await page.locator('.plugin-inspector button').click(); await expect(page.locator('#document-path')).toHaveText('requirements.md');
});

test('project switching revokes the runtime and reopening uses only the new project', async () => {
  await launch(); await choose((await readFile('.cache/plugin-sdk/example-path.txt', 'utf8')).trim());
  await expect(page.locator('.plugin-list-item')).toContainText('REQ-001');
  const second = path.join(root, 'second'); await mkdir(second); await writeFile(path.join(second, 'requirements.md'), '# REQ-099 - Second project\n');
  await app.evaluate(({ dialog }, directory) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [directory] }); }, second);
  await page.locator('#open-project').click();
  await expect(page.locator('#lens-results .lens-card').first()).toContainText('REQ-099');
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])').click();
  await expect(page.locator('.plugin-list-item')).toContainText('REQ-099');
  await expect(page.locator('.plugin-view')).not.toContainText('REQ-001');
});
test('renderer process crash is reported and close/reopen starts a fresh sandbox', async () => {
  await launch(); await choose((await readFile('.cache/plugin-sdk/example-path.txt', 'utf8')).trim());
  await expect(page.locator('.plugin-list-item')).toContainText('REQ-001');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isVisible())!.webContents.forcefullyCrashRenderer());
  await expect(page.locator('.plugin-view [role=status]')).toContainText('process stopped');
  await page.getByRole('button', { name: 'Close Specification index', exact: true }).click();
  await page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])').click();
  await expect(page.locator('.plugin-list-item')).toContainText('REQ-001');
});

test('closing during module activation releases the pending request and permits a fresh activation', async () => {
  await launch(); await fixture(`await new Promise(resolve=>setTimeout(resolve,1500)); export function render(r){return ${result("{kind:'list',items:[{id:'ok',title:'Activated'}]}")};}`);
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(2);
  await page.getByRole('button', { name: 'Close Test plugin', exact: true }).click();
  await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);
  await page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])').click();
  await expect(page.locator('.plugin-list-item')).toContainText('Activated');
});

test('CRLF files retain valid plugin ranges when opening normalizes the editor text', async () => {
  await launch('# REQ-001 - First\r\n' + 'padding\r\n'.repeat(40) + '# REQ-002');
  await choose((await readFile('.cache/plugin-sdk/example-path.txt', 'utf8')).trim());
  await expect(page.locator('.plugin-list-item')).toHaveCount(2);
  await page.locator('.plugin-list-item').last().getByRole('button').click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('REQ-002');
});

test('unopened CRLF documents use the same plugin ranges before and after source navigation', async () => {
  await launch(text, { 'z-decisions.md': 'padding\r\n'.repeat(40) + '# DD-001\r\nREQ-001' });
  await choose((await readFile('.cache/plugin-sdk/example-path.txt', 'utf8')).trim());
  await expect(page.locator('.plugin-list-item')).toHaveCount(2);
  await page.locator('.plugin-list-item').filter({ hasText: 'DD-001' }).getByRole('button').click();
  await expect(page.locator('#document-path')).toHaveText('z-decisions.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('DD-001');
  await page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])').click();
  await expect(page.locator('.plugin-list-item')).toHaveCount(2);
  expect(await readFile(path.join(project, 'z-decisions.md'), 'utf8')).toBe('padding\r\n'.repeat(40) + '# DD-001\r\nREQ-001');
});

test('installed plugin persists, can be disabled after restart, re-enabled, and uninstalled without changing an unsaved document', async () => {
  await launch(); await fixture(`export function render(r){return ${result("{kind:'list',items:[{id:'ok',title:'Persistent plugin'}]}")};}`);
  await expect(page.locator('.plugin-list-item')).toContainText('Persistent plugin');
  await page.getByRole('tab', { name: 'requirements.md', exact: true }).click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\nUnsaved plugin management check');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); await relaunch();
  await expect(page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])')).toHaveText('Test plugin');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End'); await page.keyboard.type('\nUnsaved plugin management check');
  await page.locator('#plugin-manager-open').click(); await expect(page.locator('#plugin-manager-dialog')).toContainText('test.plugin');
  await page.locator('.plugin-manager-item').filter({ hasText: 'test.plugin' }).getByRole('button', { name: 'Disable' }).click(); await expect(page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])')).toHaveCount(0);
  await page.locator('.plugin-manager-item').filter({ hasText: 'test.plugin' }).getByRole('button', { name: 'Enable' }).click(); await expect(page.locator('#loaded-plugin-views button:not([data-plugin-id="specular.relationships"])')).toHaveCount(1);
  await app.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
  await page.locator('.plugin-manager-item').filter({ hasText: 'test.plugin' }).getByRole('button', { name: 'Uninstall' }).click(); await expect(page.locator('.plugin-manager-item').filter({ hasText: 'test.plugin' })).toHaveCount(0);
  await expect(page.locator('.cm-content')).toContainText('Unsaved plugin management check');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(text);
});
