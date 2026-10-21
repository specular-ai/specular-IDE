import { failAutosave } from './autosave-fixture';
import { selectConfigurationTab } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

// Increment 82: a labelled-list rule and paragraph definitions, added through Project configuration.
let app: ElectronApplication, page: Page, root: string, project: string;
const scopes = [{ pattern: '.kiro/specs/*' }];
const config = { version: 1,
  categories: [{ key: 'req', name: 'Requirement', role: 'requirement', idScopes: scopes }, { key: 'prop', name: 'Property', role: 'design', idScopes: scopes }],
  rules: [{ key: 'req', category: 'req', pattern: String.raw`\bRequirement \d+\b` }, { key: 'prop', category: 'prop', pattern: String.raw`\bProperty \d+\b` }] };
const tasks = '# Tasks\n\n- [x] 1. Create the module\n  - _Requirements: 1.1, 1.2_\n';
const design = '# Design\n\nProperty 1: Round trip - values survive\n\n**Validates: Requirements 1.1**\n';
const dialog = () => page.locator('#project-configuration-dialog');
const spec = (file: string) => path.join(project, '.kiro/specs/a', file);
async function preview() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); }
const saved = async () => JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/labelled-lists-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await mkdir(path.join(project, '.kiro/specs/a'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config));
  await writeFile(spec('requirements.md'), '# Requirements\n\n### Requirement 1: Create the module\n');
  await writeFile(spec('tasks.md'), tasks); await writeFile(spec('design.md'), design);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#metric-ids')).toHaveText('1'); await failAutosave(app);
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('a labelled-list rule turns cited numbers into references, and paragraph definitions own what follows', async () => {
  await page.locator('#project-config-open').click(); await selectConfigurationTab(page, 'categories');
  const requirement = page.locator('.config-category').first();
  await requirement.getByRole('button', { name: 'Add rule', exact: true }).click();
  await selectConfigurationTab(page, 'categories');
  const rule = requirement.locator('.config-rule').last();
  await rule.getByLabel('Format', { exact: true }).selectOption('list');
  await expect(rule.getByLabel('Format', { exact: true })).toBeFocused();
  await selectConfigurationTab(page, 'categories');
  await expect(rule.getByLabel('ID template', { exact: true })).toHaveValue('Requirement {number}');
  await rule.locator('.config-rule-list-advanced > summary').click();
  await expect(rule.getByLabel('Item pattern', { exact: true })).toHaveValue(String.raw`(?<number>\d+)(?:\.\d+)?`);
  // An empty label is rejected before Apply.
  await preview().catch(() => {});
  await expect(page.locator('#config-error')).toContainText('list label must contain');
  await rule.getByLabel('List label', { exact: true }).fill('Requirements:|Validates: Requirements');
  await preview();
  await expect(page.locator('#config-summary')).toContainText('1 definitions · 4 references · 1 unresolved references');
  // Opening a listed reference selects the cited number.
  await page.locator('#config-filter').selectOption('references');
  await page.locator('#config-results').getByRole('button', { name: /^1\.1 → Requirement 1.* · reference — \.kiro\/specs\/a\/tasks\.md:4/ }).first().click();
  await expect(dialog()).not.toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('1.1');
  // Paragraph definitions are off until enabled for the project.
  await page.locator('#project-config-open').click(); await selectConfigurationTab(page, 'definition-sites');
  const paragraphs = page.locator('#config-definition-sites').getByRole('checkbox', { name: 'Enable paragraph definitions', exact: true });
  await expect(paragraphs).not.toBeChecked(); await paragraphs.check();
  await preview();
  await expect(page.locator('#config-summary')).toContainText('2 definitions · 3 references · 0 unresolved references');
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('2');
  const file = await saved();
  expect(file.rules.at(-1)).toMatchObject({ category: 'req', list: { label: 'Requirements:|Validates: Requirements', id: 'Requirement {number}' } });
  expect(file.idDefinitionSites.paragraphs).toEqual({ enabled: true, mode: 'start' });
  // Switching the format away and back restores the list fields.
  await page.locator('#project-config-open').click(); await selectConfigurationTab(page, 'categories');
  await rule.getByLabel('Format', { exact: true }).selectOption('pattern');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('list');
  await selectConfigurationTab(page, 'categories'); await expect(rule.getByLabel('List label', { exact: true })).toHaveValue('Requirements:|Validates: Requirements');
  expect(await readFile(spec('tasks.md'), 'utf8')).toBe(tasks); expect(await readFile(spec('design.md'), 'utf8')).toBe(design);
});
