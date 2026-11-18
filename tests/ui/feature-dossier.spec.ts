import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pluginFrame } from './plugin-frame';
import { menuAction } from './menu-action';

// Increment 93: the bundled Feature dossier over the project and physical models.
let app: ElectronApplication, page: Page, root: string, project: string;
const configuration = {
  version: 1,
  categories: [{ key: 'REQ', name: 'Requirements', role: 'requirement' }, { key: 'DD', name: 'Decisions', role: 'design' }, { key: 'TASK', name: 'Tasks', role: 'task' }],
  rules: [{ key: 'REQ', category: 'REQ', prefix: 'REQ' }, { key: 'DD', category: 'DD', prefix: 'DD' }, { key: 'TASK', category: 'TASK', prefix: 'TASK' }],
  statuses: [{ name: 'Proposed', rules: [{ mode: 'startsWith', value: 'Proposed' }] }, { name: 'Implemented', rules: [{ mode: 'startsWith', value: 'Implemented' }], colors: { light: '#116633', dark: '#88dd99' } }],
  features: [{ key: 'auth', name: 'Authentication' }, { key: 'billing', name: 'Billing' }],
  featureRules: [{ key: 'auth', scope: 'folder', path: 'auth', features: ['auth'] }, { key: 'billing', scope: 'folder', path: 'billing', features: ['billing'] }],
};
const files: Record<string, string> = {
  'auth/requirements.md': '# REQ-10 Login\n\nStatus: Implemented on 2026-10-13.\n\nUsers log in through DD-1.\n\n# REQ-2 Second rule\n\nStatus: Proposed\n',
  'auth/design.md': '# DD-1 Session design\n\nUses REQ-10 and REQ-50.\n',
  'auth/tasks.md': '# TASK-1 Build login\n\nImplements REQ-10.\n\n- 2026-10-20: Reviewed TASK-1\n',
  'billing/spec.md': '# REQ-50 Charge\n\nStatus: Implemented on 2026-09-01.\n',
};
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/dossier-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await mkdir(path.join(project, 'auth')); await mkdir(path.join(project, 'billing'));
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(configuration));
  for (const [file, text] of Object.entries(files)) await writeFile(path.join(project, file), text);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#lens-results .lens-card').first()).toBeVisible();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
});
const openDossier = async () => { await page.locator('#loaded-plugin-views button[data-plugin-id="specular.feature-dossier"]').click(); return pluginFrame(app, '#feature-dossier'); };

test('a feature dossier shows IDs by role, statuses, excerpts, links, dates, and files that open their sources', async () => {
  await expect(page.locator('#loaded-plugin-views button[data-plugin-id="specular.feature-dossier"]')).toHaveText('Feature dossier');
  let frame = await openDossier();
  const picker = frame.getByLabel('Feature', { exact: true });
  await expect(picker).toHaveValue('auth');
  await expect(picker.locator('option')).toHaveText(['Authentication (4 IDs)', 'Billing (1 ID)']);
  await expect(frame.locator('.dossier-summary h2')).toHaveText('Authentication');
  await expect(frame.locator('.dossier-counts')).toHaveText('4 IDs: 2 Requirements · 1 Decisions · 1 Tasks');
  await expect(frame.locator('.dossier-legend li')).toHaveText(['Proposed 1', 'Implemented 1', 'No status 2']);
  await expect(frame.locator('.dossier-section > summary')).toHaveText(['Requirements (2)', 'Decisions (1)', 'Tasks (1)']);
  await expect(frame.locator('.dossier-id .dossier-id-label')).toHaveText(['REQ-2', 'REQ-10', 'DD-1', 'TASK-1']);
  const requirement = frame.locator('.dossier-id[data-key="REQ-10"]');
  await requirement.locator('summary').click();
  await expect(requirement.locator('pre')).toHaveText('# REQ-10 Login\nStatus: Implemented on 2026-10-13.');
  await expect(requirement.locator('.dossier-links').first()).toContainText('↔ DD-1 · 2 mentions');
  await requirement.getByRole('button', { name: '↔ DD-1 · 2 mentions' }).click();
  await expect(frame.locator('.dossier-id[data-key="DD-1"]')).toHaveAttribute('open', '');
  await expect(frame.locator('.dossier-id[data-key="DD-1"] > summary')).toBeFocused();
  await expect(frame.locator('.dossier-dates .dossier-date')).toHaveText(['2026-10-20 · TASK-1 · Reviewed TASK-1', '2026-10-13 · REQ-10 · Implemented on 2026-10-13.']);
  await expect(frame.locator('.dossier-file')).toHaveText(['auth/design.md · 1 definition', 'auth/requirements.md · 2 definitions', 'auth/tasks.md · 1 definition']);
  await frame.page().screenshot({ path: 'test-results/feature-dossier-dark.png' });
  await frame.locator('.dossier-id[data-key="DD-1"]').getByRole('button', { name: '→ REQ-50 · 1 mention' }).click();
  await expect(page.locator('#document-path')).toHaveText('billing/spec.md');
  frame = await openDossier();
  await expect(frame.locator('.dossier-id[data-key="REQ-10"]')).toHaveAttribute('open', '');
  await frame.getByRole('button', { name: 'Open auth/requirements.md:1' }).click();
  await expect(page.locator('#document-path')).toHaveText('auth/requirements.md');
  frame = await openDossier(); await frame.locator('.dossier-date').first().click();
  await expect(page.locator('#document-path')).toHaveText('auth/tasks.md');
  frame = await openDossier(); await frame.locator('.dossier-file').first().click();
  await expect(page.locator('#document-path')).toHaveText('auth/design.md');
  frame = await openDossier(); await frame.getByLabel('Feature', { exact: true }).selectOption('billing');
  await expect(frame.locator('.dossier-id .dossier-id-label')).toHaveText(['REQ-50']);
  await expect(frame.locator('.dossier-legend li')).toHaveText(['Implemented 1']);
  await expect(frame.locator('.dossier-segment')).toHaveCSS('background-color', 'rgb(136, 221, 153)');
  await page.locator('#theme-switch').click();
  await expect(frame.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(frame.locator('.dossier-segment')).toHaveCSS('background-color', 'rgb(17, 102, 51)');
  await frame.page().screenshot({ path: 'test-results/feature-dossier-light.png' });
});

test('the dossier follows edits and configuration, falls back to the picker, and works without Relationships', async () => {
  await menuAction(app, 'plugin-manager');
  await page.locator('.plugin-manager-item').filter({ hasText: 'specular.relationships' }).getByRole('button', { name: 'Disable', exact: true }).click();
  await page.locator('#plugin-manager-close').click();
  let frame = await openDossier();
  await expect(frame.locator('.dossier-id .dossier-id-label')).toHaveText(['REQ-2', 'REQ-10', 'DD-1', 'TASK-1']);
  await writeFile(path.join(project, 'auth/tasks.md'), files['auth/tasks.md'] + '\n# TASK-2 Logout\n\nStatus: Proposed\n');
  await page.locator('#refresh').click();
  await expect(frame.locator('.dossier-id .dossier-id-label')).toHaveText(['REQ-2', 'REQ-10', 'DD-1', 'TASK-1', 'TASK-2']);
  await expect(frame.locator('.dossier-legend li')).toHaveText(['Proposed 2', 'Implemented 1', 'No status 2']);
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify({ ...configuration, features: [{ key: 'billing', name: 'Billing' }], featureRules: [configuration.featureRules[1]] }));
  await page.locator('#refresh').click();
  await expect(frame.getByLabel('Feature', { exact: true })).toHaveValue('');
  await expect(frame.locator('.dossier-empty')).toContainText('Choose a feature');
  await frame.getByLabel('Feature', { exact: true }).selectOption('billing');
  await expect(frame.locator('.dossier-id .dossier-id-label')).toHaveText(['REQ-50']);
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify({ ...configuration, features: [], featureRules: [] }));
  await page.locator('#refresh').click();
  await expect(frame.locator('.dossier-empty')).toContainText('No features are configured');
});

test('the dossier generates, labels, links, and refreshes a feature summary, and can cancel a run (94b)', async () => {
  // The agent call is stubbed: the first run answers at once; a run started while `hold` is set waits for Cancel.
  await app.evaluate(({ ipcMain }) => {
    const g = globalThis as any; g.summaryRequests = [];
    ipcMain.removeHandler('summary:run'); ipcMain.removeHandler('summary:cancel');
    ipcMain.handle('summary:run', (_event, request) => {
      g.summaryRequests.push(request);
      if (g.hold) return new Promise(resolve => { g.release = () => resolve({ ok: false, message: 'Summary generation was cancelled.' }); });
      return { ok: true, text: `Authentication covers [REQ-10] through [DD-1], depends on billing [REQ-50], and mentions [REQ-99]. Run ${g.summaryRequests.length}.` };
    });
    ipcMain.handle('summary:cancel', () => { g.release?.(); });
  });
  let frame = await openDossier();
  const box = frame.locator('.dossier-generated');
  await expect(box).toContainText('No summary yet.');
  await frame.getByLabel('Agent', { exact: true }).selectOption('codex');
  await frame.getByRole('button', { name: 'Generate summary' }).click();
  await page.locator('#summary-consent-allow').click();
  await expect(box.locator('.dossier-summary-text')).toHaveText('Authentication covers [REQ-10] through [DD-1], depends on billing [REQ-50], and mentions [REQ-99]. Run 1.');
  await expect(box.locator('.dossier-summary-label')).toContainText(/^Generated by Codex on .+ from the recorded specifications\. Not recorded content\.$/);
  await expect(box.locator('.dossier-summary-unknown')).toHaveText('Cites 1 ID not in the project: REQ-99.');
  await expect(box.locator('.dossier-summary-stale')).toHaveCount(0);
  expect((await app.evaluate(() => (globalThis as any).summaryRequests))[0]).toMatchObject({ agent: 'codex' });
  await box.getByRole('button', { name: 'DD-1', exact: true }).click();
  await expect(frame.locator('.dossier-id[data-key="DD-1"]')).toHaveAttribute('open', '');
  await box.getByRole('button', { name: 'REQ-50', exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText('billing/spec.md');
  frame = await openDossier();
  await expect(frame.locator('.dossier-generated .dossier-summary-text')).toContainText('Run 1.');
  await expect(frame.getByLabel('Agent', { exact: true })).toHaveValue('codex');
  await writeFile(path.join(project, 'auth/tasks.md'), files['auth/tasks.md'] + '\n# TASK-2 Logout\n');
  await page.locator('#refresh').click();
  await expect(frame.locator('.dossier-summary-stale')).toHaveText('Out of date: 1 ID added since it was generated.');
  // Below the summary card, collapsible, with its state shown while collapsed and kept across a source visit.
  await expect(frame.locator('.dossier-summary + .dossier-generated')).toHaveCount(1);
  await frame.locator('.dossier-generated > summary').click();
  await expect(frame.locator('.dossier-generated')).not.toHaveAttribute('open', '');
  await expect(frame.locator('.dossier-generated-hint')).toHaveText('Out of date');
  // Saving and refreshing yields two quick revisions; a click between them carries a stale revision and is rejected by design.
  await expect(async () => { await frame.locator('.dossier-file').first().click(); await expect(page.locator('#document-path')).toHaveText('auth/design.md', { timeout: 1000 }); }).toPass();
  frame = await openDossier();
  await expect(frame.locator('.dossier-generated')).not.toHaveAttribute('open', '');
  await frame.locator('.dossier-generated > summary').click();
  await frame.getByRole('button', { name: 'Regenerate' }).click();
  await expect(frame.locator('.dossier-summary-text')).toContainText('Run 2.'); await expect(frame.locator('.dossier-summary-stale')).toHaveCount(0);
  await app.evaluate(() => { (globalThis as any).hold = true; });
  await frame.getByRole('button', { name: 'Regenerate' }).click();
  await expect(frame.locator('.dossier-summary-controls')).toContainText('Generating…');
  await frame.getByRole('button', { name: 'Cancel' }).click();
  await expect(frame.locator('.dossier-summary-error')).toHaveText('Summary generation was cancelled.');
  await expect(frame.locator('.dossier-summary-text')).toContainText('Run 2.');
  await frame.page().screenshot({ path: 'test-results/feature-dossier-summary.png' });
});
