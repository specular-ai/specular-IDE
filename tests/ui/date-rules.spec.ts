import { failAutosave } from './autosave-fixture';
import { expectInternalKeysHidden, selectConfigurationTab } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1, categories: [{ key: 'requirements', name: 'Requirements', role: 'requirement' }], rules: [{ key: 'req', category: 'requirements', prefix: 'REQ' }] };
const spec = '# Feature Specification: Demo\n\n**Created**: 2025-12-12\n**Last Updated**: 2026-06-05\n\n# REQ-1 Login\n\nStatus: Implemented on 2026-10-13.\n\n## [1.0.0] - 2026-01-02\n';
const vendored = '## [9.9.9] - 2020-01-01\n';
const dialog = () => page.locator('#project-configuration-dialog');
const found = (key: string) => page.locator(`#config-date-preview [data-rule-key="${key}"] .config-date-found-title`);
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#lens-results .lens-card').first()).toBeVisible(); await failAutosave(app);
}
async function openDates() { await page.locator('#project-config-open').click(); await selectConfigurationTab(page, 'dates'); }
async function preview() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); }
async function apply() { await preview(); await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible(); }
const saved = async () => JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/date-rules-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await mkdir(path.join(project, 'Vendor/lib'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config)); await writeFile(path.join(project, 'spec.md'), spec); await writeFile(path.join(project, 'Vendor/lib/CHANGELOG.md'), vendored);
  await launch();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('Dates tab shows the default rules, previews per rule, toggles snapshots, excludes folders, and applies', async () => {
  await openDates();
  await expect(page.locator('#config-tab-dates')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.config-date-rule')).toHaveCount(8);
  await expectInternalKeysHidden(page, ['status-date', 'list-entry', 'last-updated', 'last-amended']);
  await preview();
  await expect(found('status-date')).toHaveText('Status value: 1 date');
  await expect(found('heading')).toHaveText('Heading: 2 dates');
  await expect(found('created')).toHaveText('Labelled field: Created: 1 date');
  await expect(found('last-updated')).toHaveText('Labelled field: Last Updated (off): off');
  await expect(found('ratified')).toHaveText('Labelled field: Ratified: 0 dates — check the label or pattern');
  // Turn the snapshot rule on and keep vendored changelogs out.
  await dialog().getByRole('checkbox', { name: 'Enable Labelled field: Last Updated', exact: true }).check();
  await dialog().getByRole('combobox', { name: 'Folder or file to exclude', exact: true }).fill('Vendor');
  await dialog().getByRole('button', { name: 'Add exclusion', exact: true }).click();
  await expect(dialog().getByRole('textbox', { name: 'Excluded path', exact: true })).toHaveValue('Vendor');
  await preview();
  await expect(found('heading')).toHaveText('Heading: 1 date');
  await expect(found('last-updated')).toHaveText('Labelled field: Last Updated: 1 date');
  await expect(page.locator('#config-date-summary')).toContainText('1 Markdown file excluded');
  // An invalid label is explained on its row and blocks Apply until repaired.
  const created = page.locator('.config-date-rule').nth(3);
  await created.getByRole('textbox', { name: 'Field label', exact: true }).fill('Created:');
  await expect(created.locator('.config-date-problem')).toContainText('without colons');
  await expect(page.locator('#config-error')).toBeVisible();
  await expect(page.locator('#config-apply')).toBeDisabled();
  await created.getByRole('textbox', { name: 'Field label', exact: true }).fill('Created');
  await expect(created.locator('.config-date-problem')).toBeHidden();
  await apply();
  const dates = (await saved()).dates;
  assertRule(dates.rules, 'last-updated', { enabled: true, kind: 'snapshot' });
  expect(dates.exclude).toEqual(['Vendor']);
  expect(dates.rules).toHaveLength(8);
  // The saved draft reopens unchanged.
  await openDates();
  await expect(dialog().getByRole('checkbox', { name: 'Enable Labelled field: Last Updated', exact: true })).toBeChecked();
  await expect(dialog().getByRole('textbox', { name: 'Excluded path', exact: true })).toHaveValue('Vendor');
});

test('added rules get internal keys, report empty results, open previewed sources, and restore defaults', async () => {
  await openDates();
  await dialog().getByRole('combobox', { name: 'New date rule site', exact: true }).selectOption('field');
  await dialog().getByRole('button', { name: 'Add date rule', exact: true }).click();
  await expect(page.locator('.config-date-rule')).toHaveCount(9);
  await expect(page.locator('.config-date-rule').last().getByRole('textbox', { name: 'Field label', exact: true })).toBeFocused();
  await page.locator('.config-date-rule').last().getByRole('textbox', { name: 'Field label', exact: true }).fill('Released');
  await preview();
  await expect(page.locator('#config-date-preview .config-date-found-title').last()).toHaveText('Labelled field: Released: 0 dates — check the label or pattern');
  await apply();
  const keys = (await saved()).dates.rules.map((rule: { key: string }) => rule.key);
  expect(keys.at(-1)).toBe('field');
  // Opening a previewed date selects its source line in the editor.
  await openDates(); await preview();
  await page.locator(`#config-date-preview [data-rule-key="created"] .config-result`).first().click();
  await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#document-path')).toHaveText('spec.md');
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('**Created**: 2025-12-12');
  // Restoring defaults removes the dates object, which means the default rules.
  await openDates();
  await dialog().getByRole('button', { name: 'Restore default date rules', exact: true }).click();
  await expect(page.locator('.config-date-rule')).toHaveCount(8);
  await apply();
  expect((await saved()).dates).toBeUndefined();
  expect(await readFile(path.join(project, 'spec.md'), 'utf8')).toBe(spec);
});

function assertRule(rules: { key: string }[], key: string, expected: Record<string, unknown>) {
  expect(rules.find(rule => rule.key === key)).toMatchObject(expected);
}
