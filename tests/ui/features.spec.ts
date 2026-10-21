import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { expandConfigurationEntries } from './configuration-entries';
let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1, categories: [{ key: 'req', name: 'Requirements', idScopes: [{ pattern: 'specs/*' }] }], rules: [{ key: 'req', category: 'req', prefix: 'REQ' }],
  modules: [{ key: 'gui', name: 'GUI' }, { key: 'api', name: 'API' }], moduleOverrides: [{ id: 'REQ-1', scope: 'specs/a', modules: ['gui', 'api'] }] };
const card = () => page.locator('.lens-card').filter({ hasText: 'First' }).first();
const file = () => path.join(project, '.specular/project.json');
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#metric-ids')).toHaveText('2');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); }
async function open() {
  await page.locator('#project-config-open').click(); await page.getByRole('tab', { name: 'Application features', exact: true }).click(); await expandConfigurationEntries(page);
}
async function apply() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); }
async function create() {
  await open();
  for (const name of ['Authentication', 'Audit']) {
    await page.getByRole('button', { name: 'Add feature', exact: true }).click();
    const feature = page.locator('.feature-row').last();
    await expect(feature.getByLabel('Feature name', { exact: true })).toBeFocused(); await feature.getByLabel('Feature name', { exact: true }).fill(name);
    await feature.getByRole('button', { name: 'Add ID override', exact: true }).click();
    await expect(feature.getByLabel('Exact ID', { exact: true })).toBeFocused();
    await feature.getByLabel('Exact ID', { exact: true }).fill('REQ-1'); await feature.getByLabel('ID scope (optional)', { exact: true }).fill('specs/a');
    await feature.getByLabel('Feature name', { exact: true }).focus();
  }
}
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/features-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true });
  for (const child of ['a', 'b']) await mkdir(path.join(project, 'specs', child), { recursive: true });
  await writeFile(file(), JSON.stringify(config));
  await writeFile(path.join(project, 'specs/a/main.md'), '# REQ-1 First\nREQ-1\n'); await writeFile(path.join(project, 'specs/b/main.md'), '# REQ-1 Second\nREQ-1\n'); await launch();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); if (app) await close().catch(() => {}); });

test('features tab follows modules; scoped memberships persist through rename, deletion, clearing and restart', async () => {
  await create();
  const header = page.locator('#config-features > .config-section-heading');
  await expect(header.getByRole('heading', { name: 'Application features', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'Add feature', exact: true })).toBeVisible();
  const tabs = await page.getByRole('tab').allTextContents(); expect(tabs[tabs.indexOf('Application modules') + 1]).toBe('Application features');
  await page.getByRole('tab', { name: 'Application modules', exact: true }).click(); await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Application features', exact: true })).toBeFocused();
  await expect(page.locator('.feature-row').last().getByLabel('Exact ID', { exact: true })).toHaveValue('REQ-1');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await expect(page.locator('#config-results')).toContainText('Features: Authentication, Audit');
  await page.locator('#config-apply').click(); await expect(card().locator('.feature-badge')).toHaveText(['Authentication', 'Audit']);
  await expect(card().locator('.module-badge')).toHaveText(['API', 'GUI']);
  await expect(page.locator('.lens-card').filter({ hasText: 'Second' }).locator('.feature-badge')).toHaveCount(0);
  await close(); await launch(); await expect(card().locator('.feature-badge')).toHaveText(['Authentication', 'Audit']);
  await open(); await page.getByLabel('Feature name', { exact: true }).first().fill('Sign in'); await apply(); await expect(card().locator('.feature-badge')).toHaveText(['Sign in', 'Audit']);
  await open(); await page.getByRole('button', { name: 'Remove feature', exact: true }).first().click(); await apply(); await expect(card().locator('.feature-badge')).toHaveText(['Audit']);
  await open(); await page.locator('.feature-row').getByRole('button', { name: 'Remove ID override', exact: true }).click(); await apply(); await expect(card().locator('.feature-badge')).toHaveCount(0);
  const saved = JSON.parse(await readFile(file(), 'utf8')); expect(saved.featureOverrides).toEqual([{ id: 'REQ-1', scope: 'specs/a', features: [] }]); expect(saved.moduleOverrides).toEqual(config.moduleOverrides); expect(saved.categories).toEqual(config.categories);
});

test('feature drafts cancel safely, reject invalid assignments and recover from external configuration changes', async () => {
  await create(); await page.locator('#config-cancel').click(); expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual(config);
  await create(); await page.locator('.feature-row').last().getByRole('button', { name: 'Add ID override', exact: true }).click(); await page.locator('#config-preview').click(); await expect(page.locator('#config-error')).toContainText('exact ID'); await expect(page.locator('#config-apply')).toBeDisabled();
  await page.getByRole('button', { name: 'Remove ID override', exact: true }).last().click();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await writeFile(file(), JSON.stringify({ ...config, features: [{ key: 'external', name: 'External' }] }));
  await expect(page.locator('#config-error')).toContainText('changed on disk'); await expect(page.getByLabel('Feature name', { exact: true }).first()).toHaveValue('Authentication'); await expect(page.locator('#config-apply')).toBeDisabled();
  await page.locator('#config-reload').click(); await expect(page.getByLabel('Feature name', { exact: true })).toHaveCount(1); await expandConfigurationEntries(page); await expect(page.getByLabel('Feature name', { exact: true })).toHaveValue('External');
});

test('feature controls fit both themes at minimum window size', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1080, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    await create();
    expect(await page.locator('#project-configuration-dialog').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await page.screenshot({ path: `test-results/features-${theme}.png` }); await page.locator('#config-cancel').click();
  }
});

test('failed feature saves retain the draft and category deletion cleans feature selectors', async () => {
  await create();
  await app.evaluate(({ ipcMain }) => {
    const original = (ipcMain as any)._invokeHandlers.get('workspace:save-configuration'); let first = true;
    ipcMain.removeHandler('workspace:save-configuration'); ipcMain.handle('workspace:save-configuration', (event, ...args) => {
      if (first) { first = false; return { ok: false, message: 'Simulated feature write failure' }; }
      return original(event, ...args);
    });
  });
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await page.locator('#config-apply').click();
  await expect(page.locator('#config-error')).toContainText('write failure'); await expect(page.locator('.feature-row').last().getByLabel('Exact ID', { exact: true })).toHaveValue('REQ-1');
  expect(JSON.parse(await readFile(file(), 'utf8'))).toEqual(config); await expect(card().locator('.feature-badge')).toHaveCount(0);
  await apply(); await expect(card().locator('.feature-badge')).toHaveCount(2);
  await open(); await page.getByRole('tab', { name: 'Categories', exact: true }).click(); await page.locator('#config-delete-categories').click();
  await expect(page.locator('#config-categories')).toBeEmpty(); await apply();
  const saved = JSON.parse(await readFile(file(), 'utf8')); expect(saved.featureOverrides).toEqual([]); expect(saved.features).toHaveLength(2); expect(saved.moduleOverrides).toEqual([]);
});


test('editing and removing assignments inside one feature preserves other features and scoped selectors', async () => {
  await create(); await apply(); await open();
  const first = page.locator('.feature-row').first(), second = page.locator('.feature-row').last();
  await first.getByLabel('ID scope (optional)', { exact: true }).fill('specs/b'); await apply();
  await expect(card().locator('.feature-badge')).toHaveText(['Audit']);
  await expect(page.locator('.lens-card').filter({ hasText: 'Second' }).locator('.feature-badge')).toHaveText(['Authentication']);
  await open(); await first.getByRole('button', { name: 'Remove ID override', exact: true }).click(); await apply();
  await expect(card().locator('.feature-badge')).toHaveText(['Audit']);
  await open(); await second.getByRole('button', { name: 'Add ID override', exact: true }).click();
  await second.getByLabel('Exact ID', { exact: true }).last().fill('REQ-1'); await second.getByLabel('ID scope (optional)', { exact: true }).last().fill('specs/b'); await apply();
  const saved = JSON.parse(await readFile(file(), 'utf8')); expect(saved.featureOverrides).toHaveLength(2); expect(saved.featureOverrides.every((rule: any) => rule.features.length === 1)).toBe(true);
});


test('feature rules and override sections match module layout and persist file/folder inheritance', async () => {
  await open(); await expect(page.getByText('No features defined. Add a feature to assign it to IDs.', { exact: true })).toHaveCount(0);
  await expect(page.locator('.feature-unassigned')).toHaveCSS('border-radius', '6px'); await page.locator('#config-cancel').click();
  await create();
  const first = page.locator('.feature-row').first(), second = page.locator('.feature-row').last();
  const nameBox = await first.getByLabel('Feature name', { exact: true }).boundingBox(), removeBox = await first.getByRole('button', { name: 'Remove feature', exact: true }).boundingBox();
  expect(removeBox!.x).toBeGreaterThan(nameBox!.x + nameBox!.width);
  await expect(first.getByRole('heading', { name: 'ID assignment rules', exact: true })).toBeVisible();
  await expect(first.getByRole('heading', { name: 'ID overrides', exact: true })).toBeVisible();
  await first.getByRole('button', { name: 'Add file rule', exact: true }).click(); await first.getByLabel('Match', { exact: true }).selectOption('folder'); await first.getByLabel('Project-relative path', { exact: true }).fill('specs');
  await second.getByRole('button', { name: 'Add file rule', exact: true }).click(); await second.getByLabel('Project-relative path', { exact: true }).fill('specs/b/main.md'); await apply();
  const secondCard = page.locator('.lens-card').filter({ hasText: 'Second' });
  await expect(secondCard.locator('.feature-badge')).toHaveText(['Authentication', 'Audit']);
  await open(); await first.getByRole('button', { name: 'Remove ID override', exact: true }).click(); await second.getByRole('button', { name: 'Remove ID override', exact: true }).click(); await apply();
  await expect(card().locator('.feature-badge')).toHaveCount(0);
  await open(); await page.locator('.feature-unassigned').getByRole('button', { name: 'Restore file/folder assignments', exact: true }).click(); await apply(); await expect(card().locator('.feature-badge')).toHaveText(['Authentication']);
  await close(); await launch(); await expect(page.locator('.lens-card').filter({ hasText: 'Second' }).locator('.feature-badge')).toHaveText(['Authentication', 'Audit']);
  const saved = JSON.parse(await readFile(file(), 'utf8')); expect(saved.featureRules).toHaveLength(2); expect(saved.moduleOverrides).toEqual(config.moduleOverrides);
  await open(); await page.locator('.config-body').evaluate(element => { element.scrollTop = 0; }); await page.screenshot({ path: 'test-results/feature-rules-layout.png' });
});


test('card feature edits preserve scoped identity, modules and Markdown through clear, reset and restart', async () => {
  await create(); await apply();
  const original = JSON.parse(await readFile(file(), 'utf8'));
  await writeFile(file(), JSON.stringify({ ...original, featureOverrides: [], featureRules: [{ key: 'auth-files', path: 'specs/a', scope: 'folder', features: [original.features[0].key] }] }));
  await page.locator('#refresh').click(); await expect(card().locator('.feature-badge')).toHaveText(['Authentication']);
  const edit = async () => {
    await expect(async () => {
      if (!await page.locator('#feature-assignment-dialog').isVisible()) await card().getByRole('button', { name: /Edit features for/ }).click();
      await expect(page.locator('#feature-assignment-dialog')).toBeVisible({ timeout: 300 });
    }).toPass({ timeout: 10000 });
  };
  await edit(); await expect(page.locator('#feature-assignment-title')).toContainText('specs/a');
  await expect(page.locator('#feature-assignment-current')).toContainText('File/folder assignments');
  await expect(page.locator('#feature-assignment-evidence')).toContainText('specs/a/main.md');
  await page.getByRole('checkbox', { name: '2. Audit', exact: true }).check(); await page.locator('#feature-assignment-cancel').click();
  await expect(card().getByRole('button', { name: /Edit features for/ })).toBeFocused();
  await edit(); await page.getByRole('checkbox', { name: '2. Audit', exact: true }).check(); await page.locator('#feature-assignment-apply').click();
  await expect(card().locator('.feature-badge')).toHaveText(['Authentication', 'Audit']);
  await expect(card().locator('.module-badge')).toHaveText(['API', 'GUI']);
  await expect(page.locator('.lens-card').filter({ hasText: 'Second' }).locator('.feature-badge')).toHaveCount(0);
  let saved = JSON.parse(await readFile(file(), 'utf8')); expect(saved.featureOverrides[0].scope).toBe('specs/a'); expect(saved.moduleOverrides).toEqual(config.moduleOverrides);
  await close(); await launch(); await expect(card().locator('.feature-badge')).toHaveText(['Authentication', 'Audit']);
  await edit(); await expect(page.locator('#feature-assignment-current')).toContainText('Exact-ID override'); await page.locator('#feature-assignment-none').click(); await page.locator('#feature-assignment-apply').click();
  await expect(card().locator('.feature-badge')).toHaveCount(0);
  await edit(); await page.locator('#feature-assignment-inherit').click(); await page.locator('#feature-assignment-apply').click(); await expect(card().locator('.feature-badge')).toHaveText(['Authentication']);
  saved = JSON.parse(await readFile(file(), 'utf8')); expect(saved.featureOverrides).toEqual([]); expect(saved.moduleOverrides).toEqual(config.moduleOverrides);
  expect(await readFile(path.join(project, 'specs/a/main.md'), 'utf8')).toBe('# REQ-1 First\nREQ-1\n');
  await card().locator('.feature-evidence summary').click(); await card().locator('.feature-evidence button').click(); await expect(page.locator('#document-path')).toHaveText('specs/a/main.md');
});
