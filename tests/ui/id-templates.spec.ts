import { failAutosave } from './autosave-fixture';
import { selectConfigurationTab } from './configuration-entries';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';

// Increment 89: an ID template on a regex rule makes US1 a reference to User Story 1.
let app: ElectronApplication, page: Page, root: string, project: string;
const config = { version: 1,
  categories: [{ key: 'story', name: 'User story', idScopes: [{ pattern: 'specs/*' }] }],
  rules: [{ key: 'story', category: 'story', pattern: String.raw`\bUser Story \d+\b` }] };
const tasks = '# Tasks\n\n- [ ] T001 [US1] Build the summary\n- [ ] T002 After US1, export it\n';
const dialog = () => page.locator('#project-configuration-dialog');
const folder = (file: string) => path.join(project, 'specs/001-a', file);
async function preview() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); }
const saved = async () => JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/id-templates-')); project = path.join(root, 'project');
  await mkdir(path.join(project, '.specular'), { recursive: true }); await mkdir(path.join(project, 'specs/001-a'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify(config));
  await writeFile(folder('spec.md'), '# Feature\n\n### User Story 1 - Generate the summary (Priority: P1)\n');
  await writeFile(folder('tasks.md'), tasks);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#metric-ids')).toHaveText('1'); await failAutosave(app);
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('a templated regex rule turns aliases into references to the templated ID', async () => {
  await page.locator('#project-config-open').click(); await selectConfigurationTab(page, 'categories');
  const story = page.locator('.config-category').first();
  await story.getByRole('button', { name: 'Add rule', exact: true }).click();
  await selectConfigurationTab(page, 'categories');
  const rule = story.locator('.config-rule').last();
  await rule.getByLabel('Format', { exact: true }).selectOption('pattern');
  await selectConfigurationTab(page, 'categories');
  await rule.getByLabel('Regex pattern', { exact: true }).fill(String.raw`\bUS(?<n>\d+)\b`);
  // A placeholder the pattern does not capture is rejected before Apply.
  await rule.getByLabel('ID template (optional)', { exact: true }).fill('User Story {m}');
  await preview().catch(() => {});
  await expect(page.locator('#config-error')).toContainText('uses {m}, which the pattern does not capture');
  await rule.getByLabel('ID template (optional)', { exact: true }).fill('User Story {n}');
  await preview();
  await expect(page.locator('#config-summary')).toContainText('1 definitions · 2 references · 0 unresolved references');
  // The preview shows the matched text next to the ID, and opening it selects the alias.
  await page.locator('#config-filter').selectOption('references');
  const result = page.locator('#config-results').getByRole('button', { name: /^US1 → User Story 1 · specs\/001-a · reference — specs\/001-a\/tasks\.md:3/ });
  await expect(result).toHaveCount(1);
  await result.click();
  await expect(dialog()).not.toBeVisible();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe('US1');
  await page.locator('#project-config-open').click(); await selectConfigurationTab(page, 'categories');
  // Switching the format away and back restores the template.
  await rule.getByLabel('Format', { exact: true }).selectOption('prefix');
  await selectConfigurationTab(page, 'categories'); await rule.getByLabel('Format', { exact: true }).selectOption('pattern');
  await selectConfigurationTab(page, 'categories'); await expect(rule.getByLabel('ID template (optional)', { exact: true })).toHaveValue('User Story {n}');
  await preview();
  await page.locator('#config-apply').click(); await expect(dialog()).not.toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('1');
  expect((await saved()).rules.at(-1)).toMatchObject({ category: 'story', pattern: String.raw`\bUS(?<n>\d+)\b`, id: 'User Story {n}' });
  expect(await readFile(folder('tasks.md'), 'utf8')).toBe(tasks);
});
