import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { selectConfigurationTab } from './configuration-entries';
import { pluginFrame } from './plugin-frame';

let app: ElectronApplication, page: Page, project: string, root: string;
const first = 'specs/002-swift-version-compat', second = 'specs/003-test-architecture';
const initial = { version: 1,
  categories: [{ key: 'FR', name: 'Requirements', role: 'requirement' }, { key: 'DD', name: 'Design', role: 'design' }],
  rules: [{ key: 'FR', category: 'FR', prefix: 'FR' }, { key: 'DD', category: 'DD', prefix: 'DD' }],
  modules: [{ key: 'swift', name: 'Swift' }, { key: 'test', name: 'Tests' }],
  moduleRules: [{ key: 'swift', path: first, scope: 'folder', modules: ['swift'] }, { key: 'test', path: second, scope: 'folder', modules: ['test'] }] };
const sources: Record<string, string> = {
  [`${first}/spec.md`]: '# FR-001 Swift\nStatus: Draft\n\nDD-001\n',
  [`${first}/contracts/api.md`]: '# DD-001 Swift design\nFR-001\n',
  [`${second}/spec.md`]: '# FR-001 Tests\nStatus: Confirmed\n\nDD-001\n',
  [`${second}/contracts/api.md`]: '# DD-001 Test design\nFR-001\n',
  'specs/readme.md': 'FR-001\n', 'readme.md': 'FR-001\n',
};
const card = (scope: string, id = 'FR-001') => page.locator('.lens-card').filter({ has: page.locator('.lens-row strong', { hasText: `${id} · ${scope}` }) });
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#metric-ids')).toHaveText('4');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
async function configure() { await page.locator('#project-config-open').click(); await selectConfigurationTab(page, 'categories'); }
async function addScopes() { for (const button of await page.locator('.config-add-scope').all()) await button.click(); }
async function preview() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await expect(page.locator('#config-apply')).toBeEnabled(); }
async function apply() { await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); }
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/scopes-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(initial));
  for (const [file, text] of Object.entries(sources)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  await launch();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); await close().catch(() => {}); });

test('scope Preview/Apply, local navigation, Relationships, card overrides and restart', async () => {
  test.setTimeout(90_000);
  await configure(); await addScopes(); await preview();
  await expect(page.locator('#config-summary')).toContainText('0 duplicate definitions');
  await expect(page.locator('#config-summary')).toContainText('2 unresolved references');
  await expect(page.locator('#config-changes')).toContainText('occurrences change ID scope');
  await page.locator('#config-tab-categories').click();
  await page.locator('.config-category-scopes').first().scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/id-scopes-configuration.png' });
  await apply();
  await expect(card(first)).toHaveCount(1); await expect(card(second)).toHaveCount(1);
  await expect(card(first).locator('.module-badge')).toHaveText('Swift');
  await expect(card(second).locator('.module-badge')).toHaveText('Tests');
  await expect(card(first)).toContainText('Draft'); await expect(card(second)).toContainText('Confirmed');
  await card(first, 'DD-001').locator('.lens-row').click();
  await expect(page.locator('#document-path')).toHaveText(`${first}/contracts/api.md`);
  await page.locator('#preview .id-link').filter({ hasText: 'FR-001' }).click();
  await expect(page.locator('#document-path')).toHaveText(`${first}/spec.md`);
  await expect(page.locator('#references-title')).toContainText(`FR-001 · ${first}`);
  await expect(page.locator('#references-results')).not.toContainText(second);
  await card(second, 'DD-001').locator('.lens-row').click();
  await expect(page.locator('#document-path')).toHaveText(`${second}/contracts/api.md`);
  await page.locator('#preview .id-link').filter({ hasText: 'FR-001' }).click();
  await expect(page.locator('#document-path')).toHaveText(`${second}/spec.md`);
  await card(first).getByRole('button', { name: 'Relationships for', exact: false }).click();
  await expect(page.locator('#references-results')).toContainText(`DD-001 · ${first}`);
  await expect(page.locator('#references-results')).not.toContainText(second);
  await card(first).getByRole('button', { name: 'Explore map for', exact: false }).click();
  const frame = await pluginFrame(app);
  await expect(frame.locator('#map-focus')).toHaveValue(`FR-001 · ${first}`);
  await expect(frame.locator('.map-node')).toHaveCount(2);
  await expect(frame.locator('.map-node')).not.toContainText(['@[', '@[']);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const overview = await pluginFrame(app, '#dependency-overview');
  await expect(overview.locator('.dependency-graph-node')).toHaveCount(4);
  await expect(overview.locator('.dependency-graph-node .dependency-scope')).toHaveCount(4);
  await expect(overview.locator('.dependency-graph-node .dependency-scope').first()).toHaveCSS('font-size', '9px');
  await overview.getByRole('button', { name: `Inspect FR-001 · ${first}`, exact: true }).click();
  await overview.getByRole('button', { name: `Trace to DD-001 · ${first}`, exact: true }).click();
  await expect(overview.locator('.dependency-route')).toHaveText(`FR-001 · ${first} → DD-001 · ${first}`);
  await overview.page().screenshot({ path: 'test-results/id-scopes-relationships.png' });
  await page.getByRole('button', { name: 'Focus', exact: true }).click();
  await (await pluginFrame(app, '#relationship-focus')).getByRole('button', { name: `Open DD-001 · ${first} definition`, exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText(`${first}/contracts/api.md`);
  await card(first).getByRole('button', { name: 'Edit modules for', exact: false }).click();
  await page.locator('#module-assignment-none').click(); await page.locator('#module-assignment-apply').click();
  await expect(card(first).locator('.module-badge')).toHaveText('Unassigned'); await expect(card(second).locator('.module-badge')).toHaveText('Tests');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.moduleOverrides).toEqual([{ id: 'FR-001', scope: first, modules: [] }]);
  await close(); await launch();
  await expect(card(first).locator('.module-badge')).toHaveText('Unassigned'); await expect(card(second)).toContainText('Confirmed');
  await page.screenshot({ path: 'test-results/id-scopes-lens.png' });
  await configure(); for (const toggle of await page.getByLabel('Enable folder scope 1', { exact: true }).all()) await toggle.uncheck(); await preview();
  await expect(page.locator('#config-summary')).toContainText('4 duplicate definitions');
  await page.locator('#config-cancel').click(); await expect(card(first)).toHaveCount(1);
  for (const [file, text] of Object.entries(sources)) expect(await readFile(path.join(project, file), 'utf8')).toBe(text);
});

test('project references stay unresolved, new folders participate, and changed sources invalidate scope previews', async () => {
  await configure(); await addScopes(); await preview(); await apply();
  // The project-scope references must never navigate to either scoped definition.
  await page.locator('#file-search').fill('readme');
  await page.locator('.file-row[data-file="readme.md"]').click();
  await page.locator('#preview .id-link').click();
  await expect(page.locator('#document-path')).toHaveText('readme.md');
  await expect(page.locator('#references-results')).not.toContainText(first);
  await expect(page.locator('#references-results')).not.toContainText(second);
  const third = 'specs/004-new'; await mkdir(path.join(project, third)); await writeFile(path.join(project, third, 'spec.md'), '# FR-001 New\n');
  await page.locator('#refresh').click(); await expect(card(third)).toHaveCount(1);
  await configure(); await page.getByLabel('Scope pattern', { exact: true }).first().fill('../*');
  await expect(page.locator('#config-error')).toContainText('is invalid'); await expect(page.locator('#config-apply')).toBeDisabled();
  await page.getByLabel('Scope pattern', { exact: true }).first().fill('specs/*'); await preview();
  await writeFile(path.join(project, third, 'spec.md'), '# FR-001 Changed externally\n');
  await page.locator('#config-apply').click();
  await expect(page.locator('#project-configuration-dialog')).toBeVisible();
  await expect(page.locator('#config-error')).toContainText('changed');
  await expect(page.locator('#config-apply')).toBeDisabled();
});

test('categories own independent patterns and both rule sections collapse without losing draft state', async () => {
  await page.locator('#project-config-open').click(); await page.locator('#config-tab-categories').click();
  for (const summary of await page.locator('#config-categories > .config-entry > summary').all()) await summary.click();
  let requirements = page.locator('.config-category').first(), design = page.locator('.config-category').nth(1);
  const scopes = requirements.locator('.config-category-scopes'), rules = requirements.locator('.config-category-rules');
  await expect(page.locator('#config-category-removal-hint')).toHaveCount(0);
  await expect(page.locator('#config-panel-categories > section')).toHaveCount(0);
  await expect(scopes).not.toHaveAttribute('open'); await expect(rules).not.toHaveAttribute('open');
  await requirements.getByRole('button', { name: 'Add scope pattern', exact: true }).click();
  await expect(design.getByLabel('Scope pattern', { exact: true })).toHaveCount(0);
  await scopes.locator(':scope > summary').focus(); await page.keyboard.press('Enter');
  await expect(scopes.getByLabel('Scope pattern', { exact: true })).toBeHidden();
  await expect(rules.getByRole('button', { name: 'Add rule', exact: true })).toBeVisible();
  await expect(rules.locator('.config-category-rule-list')).toBeHidden();
  // Adding/removing another category rerenders the draft; disclosure state belongs to this category.
  await page.locator('#config-add-category').click();
  await page.getByRole('button', { name: 'Remove category 3', exact: true }).click();
  await expect(scopes).not.toHaveAttribute('open'); await expect(rules).not.toHaveAttribute('open');
  await scopes.locator(':scope > summary').click();
  await expect(scopes.getByLabel('Scope pattern', { exact: true })).toHaveValue('specs/*');
  await page.screenshot({ path: 'test-results/category-scopes-dark.png' });
  await preview(); await expect(page.locator('#config-summary')).toContainText('2 duplicate definitions'); await apply();
  await expect(card(first)).toHaveCount(1); await expect(card(second)).toHaveCount(1);
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.idScopes).toBeUndefined(); expect(saved.categories[0].idScopes).toEqual([{ pattern: 'specs/*' }]); expect(saved.categories[1].idScopes).toBeUndefined();
  await card(first).getByRole('button', { name: 'Explore map for', exact: false }).click();
  const frame = await pluginFrame(app, '#relationship-focus');
  await expect(frame.locator('#map-focus')).toHaveValue(`FR-001 · ${first}`);
  await expect(frame.locator('.map-node')).toHaveCount(2);
  await close(); await launch();
  await page.locator('#theme-switch').click(); await configure();
  requirements = page.locator('.config-category').first(); design = page.locator('.config-category').nth(1);
  await expect(requirements.getByLabel('Scope pattern', { exact: true })).toHaveValue('specs/*');
  await expect(design.getByLabel('Scope pattern', { exact: true })).toHaveCount(0);
  await requirements.locator('.config-category-rules > summary').click();
  await requirements.locator('.config-category-scopes').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/category-scopes-light.png' });
});
