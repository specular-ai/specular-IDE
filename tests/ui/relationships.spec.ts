import { failAutosave } from './autosave-fixture';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
const plugin = () => pluginFrame(app);

let app: ElectronApplication, page: Page, project: string, root: string;
const requirements = '# Requirements\n\n| ID | Description |\n| --- | --- |\n| REQ-001 | First requirement |\n| REQ-002 | Second requirement |\n| REQ-003 | No relationships |\n';
const design = '# DD-001 - First decision\nReferences REQ-001 and `REQ-001`.\n## Details\nRelated to REQ-002.\n## DD-002 - Nested decision\nReferences REQ-002.\n# General notes\nUnowned REQ-001.\n';
async function launch(extra: Record<string, string> = {}) {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/relationships-'));
  project = path.join(root, 'project'); await mkdir(project);
  for (const [file, text] of Object.entries({ 'requirements.md': requirements, 'design.md': design.replace(/\n/g, '\r\n'), ...extra })) await writeFile(path.join(project, file), text);
  const env = Object.fromEntries(Object.entries(process.env).filter(([k, v]) => k !== 'ELECTRON_RUN_AS_NODE' && v !== undefined)) as Record<string, string>;
  const args = ['--project=' + project];
  app = await electron.launch({ ...(process.env.SPECULAR_TEST_PACKAGED ? { executablePath: path.resolve('out', `Specular-${process.platform}-${process.arch}`, 'Specular.exe'), args } : { args: ['.', ...args] }), env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await failAutosave(app); await expect(page.locator('#workspace')).toBeVisible(); await expect(page.locator('#lens-results .lens-card').first()).toBeVisible();
}
async function relationships(id: string) {
  await page.locator('#id-search').fill(id);
  await page.getByRole('button', { name: `Relationships for ${id}`, exact: true }).first().click();
  await expect(page.locator('#references-title')).toHaveText(id + ' relationships');
}
const group = (id: string) => page.locator('.relationship-group[data-id="' + id + '"]');
test.afterEach(async ({}, info) => {
  if (app) { if (info.status !== info.expectedStatus) await page.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('card actions expose grouped directional evidence and all occurrences; navigation preserves the focused relationship', async () => {
  await launch(); await relationships('REQ-001');
  await expect(page.locator('.relationship-group')).toHaveCount(1); await expect(group('DD-001').locator('summary')).toContainText('2 mentions');
  await group('DD-001').locator('summary').press('Enter');
  await expect(group('DD-001').locator('.relationship-evidence')).toHaveCount(2);
  await expect(group('DD-001')).toContainText('DD-001 references REQ-001');
  await page.locator('#toggle-source').click();
  await expect(page.locator('#source-panel')).toBeHidden();
  await group('DD-001').locator('.relationship-evidence').first().click();
  await expect(page.locator('#source-panel')).toBeVisible();
  await expect(page.locator('#editor .cm-content')).toBeFocused();
  await expect(page.locator('#document-path')).toHaveText('design.md');
  await expect(page.locator('#references-title')).toHaveText('REQ-001 relationships');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('REQ-001');
  await page.screenshot({ path: 'test-results/relationships-evidence.png' });
  await relationships('DD-001'); await expect(page.locator('.relationship-group')).toHaveCount(2);
  await group('REQ-002').locator('summary').click(); await group('REQ-002').locator('.relationship-definition').click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  await relationships('REQ-001'); await page.locator('#references-results').getByRole('button', { name: 'All occurrences', exact: true }).click();
  await expect(page.locator('#references-title')).toContainText('3 references'); await expect(page.locator('#references-results .reference-row')).toHaveCount(4);
  await page.getByRole('button', { name: 'All occurrences of REQ-001', exact: true }).click(); await expect(page.locator('#references-results')).toContainText('design.md:8');
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(requirements);
  expect(await readFile(path.join(project, 'design.md'), 'utf8')).toBe(design.replace(/\n/g, '\r\n'));
});

test('unsaved reference edits invalidate old buttons immediately and refresh without a save', async () => {
  await launch(); await page.locator('[data-file="requirements.md"]').click(); await relationships('REQ-001'); await group('DD-001').locator('summary').click();
  await group('DD-001').locator('.relationship-evidence').first().evaluate(button => { (globalThis as any).oldEvidence = button; });
  await page.locator('#editor .cm-content').fill(requirements.replace('First requirement', 'First requirement references DD-002'));
  await page.evaluate(() => (globalThis as any).oldEvidence.click());
  await expect(page.locator('#document-path')).toHaveText('requirements.md'); await expect(page.locator('#toast')).toContainText('index changed');
  await expect(page.locator('.relationship-group')).toHaveCount(2); await expect(group('DD-002').locator('summary')).toContainText('referenced by REQ-001');
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(requirements);
  await page.locator('#editor .cm-content').fill(requirements);
  await expect(page.locator('.relationship-group')).toHaveCount(1);
});

test('missing and duplicate definitions are explicit, empty relationships remain distinct from occurrences', async () => {
  await launch({ 'extra.md': '# DD-004\nREQ-001 and REQ-404.\n# DD-004\nREQ-002.\n' });
  await relationships('REQ-001'); await group('DD-004').locator('summary').click();
  await expect(group('DD-004')).toContainText('2 definitions; no target chosen'); await expect(group('DD-004').locator('.relationship-definition')).toHaveCount(0);
  await expect(group('DD-004').locator('.relationship-evidence')).toHaveCount(1);
  await relationships('DD-004'); await expect(page.locator('#references-results')).toContainText('These references are ambiguous');
  await group('REQ-404').locator('summary').click(); await expect(group('REQ-404')).toContainText('Missing definition');
  await expect(group('REQ-404').locator('.relationship-definition')).toHaveCount(0);
  await relationships('REQ-003'); await expect(page.locator('#references-results')).toContainText('No owned requirement/design or design/task references');
});

test('project switch clears relationship evidence, and a new project cannot reuse old locations', async () => {
  await launch(); await relationships('REQ-001'); await group('DD-001').locator('summary').click();
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'requirements.md'), '# REQ-001\nA different specification.\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other'); await expect(page.locator('#references-panel')).toBeHidden();
  await relationships('REQ-001'); await expect(page.locator('#references-results')).toContainText('No owned requirement/design or design/task references');
  await expect(page.locator('.relationship-evidence')).toHaveCount(0);
});

test('Specular documents expose DD-031 evidence at minimum window size and refresh after an external edit', async () => {
  test.skip(!existsSync('design.md'), 'The development documents are not part of the public distribution.');
  await launch({ 'requirements.md': await readFile('requirements.md', 'utf8'), 'design.md': await readFile('design.md', 'utf8') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  await relationships('REQ-127'); await group('DD-031').locator('summary').click();
  await expect(group('DD-031').locator('.relationship-evidence')).not.toHaveCount(0);
  await group('DD-031').locator('.relationship-evidence').first().click(); await expect(page.locator('#document-path')).toHaveText('design.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('REQ-127');
  await page.screenshot({ path: 'test-results/relationships-real-project.png' });
  await writeFile(path.join(project, 'design.md'), '# DD-031\nNo recorded requirement references.\n');
  await expect(group('DD-031')).toHaveCount(0);
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
});


async function map(id: string) {
  await page.locator('#id-search').fill(id);
  await page.getByRole('button', { name: `Explore map for ${id}`, exact: true }).first().click();
  await expect(page.locator('[aria-label="Relationships view"]')).toBeVisible();
}
const mapNode = async (id: string) => (await plugin()).locator(`.map-node[data-id="${id}"]`);

test('map tab supports keyboard evidence, source return, focus history, and closing without closing documents', async () => {
  await launch(); await page.locator('[data-file="requirements.md"]').click(); await map('REQ-002');
  await expect((await plugin()).locator('.map-node')).toHaveCount(3);
  await expect(page.getByRole('tab', { name: 'Relationships', exact: true })).toHaveAttribute('aria-selected', 'true');
  const edge = (await plugin()).getByRole('button', { name: 'Inspect connection REQ-002 and DD-001', exact: true });
  await edge.press('Enter');
  await expect((await plugin()).locator('#map-evidence')).toContainText('DD-001 references REQ-002');
  await (await plugin()).locator('.map-evidence-source').first().click();
  await expect(page.locator('[aria-label="Relationships view"]')).toBeHidden(); await expect(page.locator('#document-path')).toHaveText('design.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('REQ-002');
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click();
  await expect((await plugin()).locator('#map-focus')).toHaveValue('REQ-002'); await expect((await plugin()).locator('#map-evidence')).toContainText('DD-001 references REQ-002');
  await (await mapNode('DD-001')).getByRole('button', { name: 'Focus DD-001', exact: true }).click();
  await expect((await plugin()).locator('.map-node')).toHaveCount(3); await expect((await plugin()).locator('#map-focus')).toHaveValue('DD-001');
  await (await plugin()).getByRole('button', { name: 'Back to previous focus', exact: true }).click(); await expect((await plugin()).locator('#map-focus')).toHaveValue('REQ-002');
  await (await mapNode('DD-002')).getByRole('button', { name: 'Open DD-002 definition', exact: true }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('DD-002');
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click(); await page.keyboard.press('Control+w');
  await expect(page.getByRole('tab', { name: 'Relationships', exact: true })).toHaveCount(0); await expect(page.locator('#document-path')).toHaveText('design.md');
  await expect(page.getByRole('tab', { name: 'requirements.md', exact: true })).toBeVisible();
});

test('map filters connection evidence, handles empty and missing focus, and preserves filters on source return', async () => {
  await launch({ 'other.md': '# DD-003\nREQ-001\n' }); await map('REQ-001');
  await (await plugin()).locator('#map-file').selectOption('other.md'); await expect((await plugin()).locator('.map-node')).toHaveCount(2);
  await expect((await plugin()).locator('.map-scope')).toContainText('1 of 2 connections');
  await (await plugin()).locator('.map-connection').click(); await (await plugin()).locator('.map-evidence-source').click();
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click(); await expect((await plugin()).locator('#map-file')).toHaveValue('other.md');
  await (await plugin()).locator('#map-focus').fill('REQ-002'); await (await plugin()).locator('#map-focus').press('Enter');
  await expect((await plugin()).locator('.map-status')).toHaveText('No connections match this file filter.');
  await (await plugin()).locator('#map-file').selectOption(''); await expect((await plugin()).locator('.map-connection')).toHaveCount(2);
  await (await plugin()).locator('#map-focus').fill('REQ-404'); await (await plugin()).locator('#map-focus').press('Enter');
  await expect((await plugin()).locator('body')).toContainText('Missing definition: REQ-404');
  await expect((await plugin()).locator('.map-status')).toContainText('No owned requirement/design or design/task references');
  await (await plugin()).locator('#map-focus').fill(''); await (await plugin()).locator('#map-focus').press('Enter'); await expect((await plugin()).locator('.map-status')).toContainText('Choose an ID with a requirement, design or task role');
});

test('map refreshes unsaved evidence and rejects old source buttons', async () => {
  await launch(); await page.locator('[data-file="requirements.md"]').click(); await map('REQ-001');
  await (await plugin()).locator('.map-connection').click();
  await (await plugin()).locator('.map-evidence-source').first().evaluate(button => { (globalThis as any).oldMapEvidence = button; });
  await page.getByRole('tab', { name: 'requirements.md', exact: true }).click();
  await page.locator('#editor .cm-content').fill(requirements.replace('First requirement', 'First requirement DD-002'));
  await expect.poll(() => app.context().pages().filter(p => p.url().includes('/custom.html')).length).toBe(0);
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click(); await expect((await plugin()).locator('.map-connection')).toHaveCount(2);
  await (await plugin()).locator('.map-connection[data-id="DD-002"]').click(); await expect((await plugin()).locator('#map-evidence')).toContainText('REQ-001 references DD-002');
  await (await plugin()).locator('.map-evidence-source').click(); await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  expect(await readFile(path.join(project, 'requirements.md'), 'utf8')).toBe(requirements);
});

test('large neighborhoods are paged and duplicate endpoints never choose a definition', async () => {
  const extra = Array.from({ length: 25 }, (_, i) => `# DD-${100 + i}\nREQ-001\n`).join('\n') + '\n# DD-100\nREQ-001\n';
  await launch({ 'large.md': extra }); await map('REQ-001');
  await expect((await plugin()).locator('.map-scope')).toContainText('26 of 26'); await expect((await plugin()).locator('.map-connection')).toHaveCount(6);
  await expect((await mapNode('DD-100')).getByRole('button', { name: 'Open DD-100 definition', exact: true })).toBeDisabled();
  await (await plugin()).locator('.map-connection[data-id="DD-100"]').click(); await expect((await plugin()).locator('#map-evidence')).toContainText('2 definitions; no target chosen');
  await expect((await plugin()).locator('.map-evidence-source')).toHaveCount(2);
  await (await plugin()).getByRole('button', { name: 'Next connections', exact: true }).click(); await expect((await plugin()).locator('.map-connection')).toHaveCount(6);
  for (let i = 0; i < 3; i++) await (await plugin()).getByRole('button', { name: 'Next connections', exact: true }).click();
  await expect((await plugin()).locator('.map-connection')).toHaveCount(2);
  await expect((await plugin()).getByRole('button', { name: 'Next connections', exact: true })).toBeDisabled(); await expect((await mapNode('DD-124'))).toBeVisible();
});

test('map fits the minimum window, updates externally, and resets on project switch', async () => {
  test.skip(!existsSync('design.md'), 'The development documents are not part of the public distribution.');
  await launch({ 'requirements.md': await readFile('requirements.md', 'utf8'), 'design.md': await readFile('design.md', 'utf8') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720)); await map('REQ-127');
  await expect((await mapNode('DD-031'))).toBeVisible();
  expect(await page.locator('[aria-label="Relationships view"]').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await (await plugin()).locator('.map-graph').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/relationship-map-minimum.png' });
  await (await plugin()).locator('.map-connection[data-id="DD-031"]').click(); await expect((await plugin()).locator('.map-evidence-source').first()).toBeVisible();
  await writeFile(path.join(project, 'design.md'), '# DD-031\nNo references.\n'); await expect((await plugin()).locator('.map-connection')).toHaveCount(0);
  const other = path.join(root, 'other'); await mkdir(other); await writeFile(path.join(other, 'requirements.md'), '# REQ-001\nOther project.\n');
  await app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, other);
  await page.locator('#open-project').click(); await expect(page.locator('#project-heading')).toHaveText('other');
  await expect(page.getByRole('tab', { name: 'Relationships', exact: true })).toHaveCount(0);
  await map('REQ-001'); await expect((await plugin()).locator('.map-status')).toContainText('No owned requirement/design or design/task references'); await expect((await plugin()).locator('#map-file')).toHaveValue('');
});


test('map retains both authored directions and stays active when the last document is closed', async () => {
  await launch({ 'requirements.md': requirements.replace('First requirement', 'First requirement DD-001') });
  await page.locator('[data-file="requirements.md"]').click(); await map('REQ-001');
  const edge = (await plugin()).getByRole('button', { name: 'Inspect connection REQ-001 and DD-001', exact: true });
  await expect(edge.locator('path')).toHaveAttribute('marker-start', 'url(#map-arrow-start)'); await expect(edge.locator('path')).toHaveAttribute('marker-end', 'url(#map-arrow-end)');
  await edge.click(); await expect((await plugin()).locator('.map-evidence-source')).toHaveCount(3);
  await page.getByRole('button', { name: 'Close requirements.md', exact: true }).click();
  await expect(page.locator('[aria-label="Relationships view"]')).toBeVisible();
  const closeLabels = await page.locator('#tabs .tab-close').evaluateAll(buttons => buttons.map(button => button.getAttribute('aria-label')!));
  for (const label of closeLabels) {
    if (label !== 'Close Relationships') await page.getByRole('button', { name: label, exact: true }).click();
  }
  await expect(page.locator('[aria-label="Relationships view"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close Relationships', exact: true }).click();
  await expect(page.locator('#document-empty')).toBeVisible();
  await map('REQ-001'); await (await mapNode('REQ-001')).getByRole('button', { name: 'Open REQ-001 definition', exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
});

const tasks = '# TASK-001 - Authored completed task\nDD-001 and DD-001, TASK-002 and REQ-001.\n\n| ID | Work |\n| --- | --- |\n| TASK-002 | DD-001 and DD-002 |\n| TASK-003 | Unlinked task |\n\n# Notes\nUnowned TASK-001.\n';
test('task map exposes both hops, reverse browsing, evidence refresh and a three-column minimum-window layout', async () => {
  await launch({ 'tasks.md': tasks });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  await page.locator('[data-file="tasks.md"]').click(); await map('REQ-001');
  await expect((await plugin()).locator('.map-node')).toHaveCount(4);
  await expect((await mapNode('TASK-001'))).toBeVisible(); await expect((await mapNode('TASK-002'))).toBeVisible();
  const bounds = await Promise.all(['REQ-001', 'DD-001', 'TASK-001'].map(async id => (await mapNode(id)).boundingBox()));
  expect(bounds[0]!.x + bounds[0]!.width).toBeLessThan(bounds[1]!.x);
  expect(bounds[1]!.x + bounds[1]!.width).toBeLessThan(bounds[2]!.x);
  expect(await page.locator('[aria-label="Relationships view"]').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  await (await plugin()).locator('.map-graph').scrollIntoViewIfNeeded(); await page.screenshot({ path: 'test-results/task-map-minimum.png' });
  await (await plugin()).getByRole('button', { name: 'Inspect connection REQ-001 and DD-001', exact: true }).click();
  await expect((await plugin()).locator('#map-evidence')).toContainText('DD-001 references REQ-001');
  const hop = (await plugin()).getByRole('button', { name: 'Inspect connection DD-001 and TASK-001', exact: true });
  await hop.press('Enter');
  await expect((await plugin()).locator('#map-evidence h3')).toHaveText('Evidence: DD-001 / TASK-001');
  await expect((await plugin()).locator('.map-evidence-source')).toHaveCount(2);
  await (await plugin()).locator('.map-evidence-source').first().click();
  await expect(page.locator('#document-path')).toHaveText('tasks.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('DD-001');
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click();
  await (await mapNode('TASK-001')).getByRole('button', { name: 'Focus TASK-001', exact: true }).click();
  await expect((await mapNode('REQ-001'))).toBeVisible(); await expect((await mapNode('REQ-002'))).toBeVisible();
  await (await plugin()).getByRole('button', { name: 'Inspect connection TASK-001 and DD-001', exact: true }).click();
  await (await plugin()).locator('.map-evidence-source').first().evaluate(button => { (globalThis as any).oldTaskEvidence = button; });
  await page.getByRole('tab', { name: 'tasks.md', exact: true }).click();
  await page.locator('#editor .cm-content').fill(tasks.replace('DD-001 and DD-001', 'DD-002'));
  await expect.poll(() => app.context().pages().filter(p => p.url().includes('/custom.html')).length).toBe(0);
  await page.getByRole('tab', { name: 'Relationships', exact: true }).click();
  await expect((await mapNode('DD-002'))).toBeVisible(); await expect((await mapNode('REQ-001'))).toHaveCount(0);
  expect(await readFile(path.join(project, 'tasks.md'), 'utf8')).toBe(tasks);
});

test('task navigation works from preview, source, Index and captured briefs', async () => {
  await launch({ 'tasks.md': tasks, 'notes.md': 'TASK-002\n' });
  await page.locator('[data-file="notes.md"]').click();
  await page.locator('#preview .id-link[data-id="TASK-002"]').click();
  await expect(page.locator('#document-path')).toHaveText('tasks.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('TASK-002');
  await page.locator('[data-file="notes.md"]').click();
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+Home'); await page.keyboard.press('F12');
  await expect(page.locator('#document-path')).toHaveText('tasks.md');
  await relationships('TASK-002'); await expect(page.locator('.relationship-group')).toHaveCount(2);
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+a');
  await page.locator('#prepare-brief').click(); await expect(page.locator('#brief-ids')).toContainText('TASK-001');
  await page.locator('#brief-instruction').fill('Review the authored tasks.'); await page.locator('#brief-create').click();
  expect(await page.locator('#brief-output').inputValue()).toContain('TASK-003');
  await page.locator('#brief-close').click();
  await map('TASK-003'); await expect((await plugin()).locator('.map-node')).toHaveCount(1);
  await expect((await plugin()).locator('.map-status')).toContainText('No owned requirement/design or design/task references');
});

test('task expansion is bounded, keeps intermediate decisions and exposes missing and duplicate task endpoints', async () => {
  const large = Array.from({ length: 14 }, (_, i) => `# TASK-${100 + i}\nDD-001.\n`).join('\n');
  await launch({ 'tasks.md': tasks + '\n# TASK-001\nDD-001.\n' + large, 'design.md': design + '\n# DD-004\nREQ-001 and TASK-404.\n' });
  await map('REQ-001'); await expect((await mapNode('DD-001'))).toBeVisible();
  await expect((await plugin()).locator('.map-through-scope')).toContainText('17 second-hop connections');
  await expect((await mapNode('TASK-001')).getByRole('button', { name: 'Open TASK-001 definition', exact: true })).toBeDisabled();
  await (await plugin()).getByRole('button', { name: 'Inspect connection DD-001 and TASK-001', exact: true }).click();
  await expect((await plugin()).locator('#map-evidence')).toContainText('2 definitions; no target chosen');
  await (await plugin()).getByRole('button', { name: 'Next second-hop connections', exact: true }).click();
  await expect((await mapNode('DD-001'))).toBeVisible(); await expect((await mapNode('REQ-001'))).toBeVisible();
  await (await plugin()).getByRole('button', { name: 'Next second-hop connections', exact: true }).click();
  await expect((await mapNode('TASK-404')).getByRole('button', { name: 'Open TASK-404 definition', exact: true })).toBeDisabled();
  await (await plugin()).getByRole('button', { name: 'Inspect connection DD-004 and TASK-404', exact: true }).click();
  await expect((await plugin()).locator('#map-evidence')).toContainText('Missing definition: TASK-404');
  await (await plugin()).locator('#map-file').selectOption('tasks.md');
  await expect((await plugin()).locator('.map-through-scope')).toContainText('0 second-hop connections');
  await expect((await plugin()).locator('.map-status')).toHaveText('No connections match this file filter.');
});
