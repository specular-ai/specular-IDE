import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import { expectInternalKeysHidden, expandDiscoveryMethods } from './configuration-entries';
import { DEFAULT_ID_DEFINITION_SITES } from '../../src/core/definition-sites';
let app: ElectronApplication, page: Page, root: string, project: string;
const listSource = '- **FR-001**: first requirement\n- *FR-002*: second requirement\n- Mentions FR-001 and USB3 USB4\n';
const original = '# REF-01 Requirement\nREF-01 REF-02 USB3 USB4 2026-09-17\n\n```md\n# CODE-1 Example\n```\n';
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow(); await expect(page.locator('#project-heading')).toHaveText('project');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
async function open() {
  // File-watcher refreshes may still be settling after fixture writes.
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover IDs', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
}
async function scan() { await page.getByRole('button', { name: 'Discover by patterns' }).click(); await expect(page.locator('#discovery-status')).toContainText('Found 3 candidate groups'); }
const candidate = (id: string) => page.locator('#discovery-review > .config-entry').filter({ has: page.locator(':scope > summary').filter({ hasText: id }) });
async function keepRef() {
  for (const entry of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    if ((await entry.locator(':scope > summary').textContent())!.includes('REF-01')) continue;
    await entry.getByRole('button', { name: 'Delete', exact: true }).click();
  }
  const row = candidate('REF-01');
  if (await row.getAttribute('open') === null) await row.locator(':scope > summary').click();
  return row;
}
async function previewApply() { await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready'); await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible(); }
test.beforeEach(async ({}, info) => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/discovery-')); project = path.join(root, 'project'); await mkdir(project);
  await writeFile(path.join(project, 'a.md'), info.title.includes('list review preserves') ? listSource : original); await writeFile(path.join(project, 'b.md'), '# REQ-01 Existing\nREQ-02\n'); await launch();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); if (app) await close().catch(() => {}); });

test('patterns omit singleton and repeated identical identifiers from suggestions', async () => {
  await writeFile(path.join(project, 'a.md'), '# SINGLE1\n' + 'FR1 '.repeat(40) + 'PAIR1 PAIR2\n');
  await page.locator('#refresh').click(); await open();
  await page.getByText('Markdown scope', { exact: true }).click();
  await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
  await page.getByRole('checkbox', { name: 'a.md', exact: true }).check();
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Found 1 candidate groups');
  await expect(page.locator('#discovery-review > .config-entry')).toHaveCount(1);
  await expect(page.locator('#discovery-review')).toContainText('PAIR1');
  await expect(page.locator('#discovery-review')).not.toContainText('SINGLE1');
  await expect(page.locator('#discovery-review')).not.toContainText('FR1');
});

test('expanded candidates and recognition preview remain reachable by scrolling', async () => {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  await open(); await scan();
  await page.getByText('Markdown scope', { exact: true }).click();
  await page.getByText('Import proposal JSON (optional)', { exact: true }).click();
  for (const entry of await page.locator('#discovery-review > .config-entry').all()) {
    await entry.locator(':scope > summary').click();
    await entry.getByText('ID definition sites', { exact: true }).click();
    await entry.getByLabel('Category definition sites', { exact: true }).selectOption('override');
  }
  const body = page.locator('.config-body');
  await body.evaluate(element => { element.scrollTop = 0; });
  const bounds = (await body.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width - 30, bounds.y + bounds.height / 2);
  await page.mouse.wheel(0, 10000);
  await expect(page.locator('#config-preview-title')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('#discovery-review > .config-entry').last().getByRole('button').last()).toBeInViewport();
  await page.locator('#config-preview').click();
  await expect(page.locator('#config-status')).toContainText('Preview ready');
  await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(page.locator('#config-results')).toBeInViewport();
});

for (const method of ['local', 'import'] as const) test(`${method} list review preserves local sites through navigation, deletion, staging and restart`, async () => {
  const source = listSource;
  await open();
  if (method === 'local') {
    await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click();
    await expect(page.locator('#discovery-status')).toContainText('Found 3 candidate groups');
  } else {
    await page.getByText('Import proposal JSON (optional)', { exact: true }).click();
    const sites = structuredClone(DEFAULT_ID_DEFINITION_SITES); sites.lists!.enabled = true;
    const proposal = { version: 1, suggestions: [
      { key: 'fr', category: { key: 'fr', name: 'Requirements', idDefinitionSites: sites }, rule: { key: 'fr', category: 'fr', prefix: 'FR' }, uncertainty: 'Two leading list records.', evidence: [{ file: 'a.md', id: 'FR-001', offset: 4, end: 10, context: 'list-item' }] },
      { key: 'usb', category: { key: 'usb', name: 'Incidental' }, rule: { key: 'usb', category: 'usb', prefix: 'USB', separator: '' }, uncertainty: 'Incidental token.', evidence: [{ file: 'a.md', id: 'USB3', offset: source.indexOf('USB3'), end: source.indexOf('USB3') + 4, context: 'mention' }] },
    ] };
    await page.getByLabel('Convention proposal file').setInputFiles({ name: 'list.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(proposal)) });
    await page.getByRole('button', { name: 'Review imported proposal', exact: true }).click();
  }
  await expect(page.locator('#discovery-remaining')).toHaveText('2 suggestions remaining');
  let row = candidate('FR-001'); await row.locator(':scope > summary').click();
  await row.getByText('ID definition sites', { exact: true }).click();
  await expect(row.getByLabel('Category definition sites', { exact: true })).toHaveValue(method === 'local' ? 'inherit' : 'override');
  if (method === 'import') await expect(row.getByLabel('Enable list definitions')).toBeChecked();
  await row.getByRole('button', { name: 'Restore inheritance', exact: true }).click();
  await row.getByLabel('Category definition sites', { exact: true }).selectOption('override');
  await expect(row.getByLabel('Enable list definitions')).not.toBeChecked();
  await row.getByLabel('Enable list definitions').check(); await row.getByLabel('Enable heading definitions').uncheck();
  await row.getByLabel('Category display name', { exact: true }).fill('List requirements');
  if (method === 'local') await expect(row).toContainText('3 occurrences; 2 definition-like');
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  await page.getByRole('tab', { name: 'Discover IDs', exact: true }).click();
  await candidate('USB3').getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(row.getByLabel('Enable list definitions')).toBeChecked();
  await row.getByRole('button', { name: 'FR-001 - a.md (list-item)', exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText('a.md');
  await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();
  await open(); row = candidate('FR-001');
  await expect(row.getByLabel('Enable list definitions')).toBeChecked();
  await row.getByLabel('Enable list definitions').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/discovery-list-${method}.png` });
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Nothing has been saved');
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const category = page.locator('#config-categories > .config-entry').filter({ has: page.locator(':scope > summary').filter({ hasText: 'List requirements' }) });
  await category.locator(':scope > summary').click(); await category.getByText('ID definition sites', { exact: true }).click();
  await expect(category.getByLabel('Enable list definitions')).toBeChecked(); await expect(category.getByLabel('Enable heading definitions')).not.toBeChecked();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-summary')).toContainText('3 definitions');
  await previewApply(); await expect(page.locator('#metric-ids')).toHaveText('3');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.find((c: any) => c.name === 'List requirements').idDefinitionSites.lists.enabled).toBe(true);
  expect(saved.categories.some((c: any) => c.name === 'USB' || c.name === 'Incidental')).toBe(false);
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(source);
  await close(); await launch(); await expect(page.locator('#metric-ids')).toHaveText('3');
});
test('discover unknown IDs locally, inspect evidence, ignore incidental tokens, edit and persist reviewed rules', async () => {
  await expect(page.locator('#metric-ids')).toHaveText('1'); await open(); await scan();
  await expect(page.locator('#discovery-review')).not.toContainText('CODE-1'); await expect(page.locator('#discovery-review')).not.toContainText('2026');
  await expect(page.getByRole('button', { name: 'Add suggestions to draft' })).toBeEnabled();
  await expect(page.locator('#discovery-review').getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('#discovery-status')).toContainText('Omitted 1 existing category');
  const row = await keepRef(); await expect(row).toContainText('3 occurrences; 1 definition-like');
  await expectInternalKeysHidden(page, ['discovered-1', 'discovered-2', 'discovered-3']);
  await expect(page.getByLabel('Suggested category', { exact: true })).toHaveCount(0);
  await row.getByRole('button', { name: 'REF-01 - a.md (heading)', exact: true }).click(); await expect(page.locator('#document-path')).toHaveText('a.md');
  await open(); await expect(page.locator('#discovery-remaining')).toHaveText('1 suggestions remaining');
  await page.getByRole('button', { name: 'Add suggestions to draft' }).click(); await expect(page.locator('#discovery-status')).toContainText('Nothing has been saved');
  await expectInternalKeysHidden(page, ['discovered-1', 'discovered-2', 'discovered-3']);
  await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
  await previewApply(); await expect(page.locator('#metric-ids')).toHaveText('2');
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')); expect(saved.rules.some((r: any) => r.pattern?.includes('REF'))).toBe(true); expect(saved.rules.some((r: any) => r.pattern?.includes('USB'))).toBe(false);
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(original); await close(); await launch(); await expect(page.locator('#metric-ids')).toHaveText('2');
});

test('only Add suggestions to draft stages retained categories; shared Preview never adds them implicitly', async () => {
  await open(); await scan(); const row = await keepRef();
  await row.getByLabel('Category display name', { exact: true }).fill('Customer requirements');
  await row.getByLabel('Suggested role', { exact: true }).selectOption('requirement');
  await page.getByRole('tab', { name: 'Authored statuses', exact: true }).click();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await expect(page.locator('#config-status')).toContainText('1 discovery suggestions are outside this draft');
  await expect(page.locator('#config-summary')).toContainText('1 definitions');
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  await expect(page.locator('#config-categories')).not.toContainText('Customer requirements');
  await page.getByRole('tab', { name: 'Discover IDs', exact: true }).click();
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#config-apply')).toBeDisabled();
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  // Match the entry's own summary: every category lists the others as parent options (increment 85a).
  const category = page.locator('#config-categories > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: 'Customer requirements' }) });
  await category.locator(':scope > summary').click(); await expect(category.locator('.config-rule')).toHaveCount(1);
  await category.getByText('ID recognition rules', { exact: true }).click();
  await category.locator('.config-category-rule-list > .config-entry > summary').click();
  await expect(category.getByLabel('Regex pattern', { exact: true })).toHaveValue(/REF/);
  await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-summary')).toContainText('2 definitions');
  await previewApply();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.filter((c: any) => c.name === 'Customer requirements')).toHaveLength(1);
  expect(saved.rules.filter((r: any) => r.pattern?.includes('REF'))).toHaveLength(1);
  expect(saved.rules.some((r: any) => r.pattern?.includes('USB'))).toBe(false);
  await close(); await launch(); await expect(page.locator('#metric-ids')).toHaveText('2');
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(original);
});

test('review edits/deletions invalidate preview; invalid retained suggestions cannot be partially staged', async () => {
  await open(); await scan();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-apply')).toBeEnabled();
  const row = await keepRef(); await expect(page.locator('#config-apply')).toBeDisabled();
  await row.getByLabel('Suggested regex').fill('(');
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('regular expression');
  await expect(page.locator('#config-apply')).toBeDisabled(); await expect(page.locator('#discovery-remaining')).toHaveText('1 suggestions remaining');
  await expect(page.locator('.config-category')).toHaveCount(11);
  await page.locator('#config-preview').click(); await expect(page.locator('#config-apply')).toBeEnabled();
  await expect(page.locator('#config-status')).toContainText('outside this draft');
  await row.getByLabel('Suggested regex').fill('REF-\\d+');
  await row.getByLabel('Category display name', { exact: true }).fill('Final requirements');
  await expect(page.locator('#config-apply')).toBeDisabled();
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  await expect(page.locator('#config-categories')).toContainText('Final requirements');
  await page.locator('#config-cancel').click(); await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
  await open(); await expect(page.locator('#config-categories')).not.toContainText('Final requirements');
});

test('scope, cancellation, and source edits invalidate proposals without changing active configuration', async () => {
  await open(); await page.locator('#config-discovery').getByText('Markdown scope', { exact: true }).click(); await page.locator('#config-discovery').getByLabel('b.md', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Discover by patterns' }).click(); await expect(page.locator('#discovery-status')).toContainText('Found 2 candidate groups in 1 files');
  const row = await keepRef(); await row.getByRole('button', { name: 'REF-01 - a.md (heading)' }).click();
  await page.locator('.cm-content').fill(original + '\nChanged source.\n'); await open(); await expect(page.locator('#discovery-status')).toContainText('changed'); await expect(page.locator('.discovery-suggestion')).toHaveCount(0);
  await page.getByRole('button', { name: 'Discover by patterns' }).click(); await page.locator('#discovery-patterns').getByRole('button', { name: 'Cancel discovery' }).click(); await expect(page.locator('#discovery-status')).toContainText('cancelled');
  await page.keyboard.press('Escape'); await expect(page.locator('#metric-ids')).toHaveText('1'); await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
});
test('review imported arbitrary-format proposals and module assignments through the same draft flow', async () => {
  const text = '# R:alpha Custom\n'; await writeFile(path.join(project, 'a.md'), text); await page.locator('#refresh').click(); await open();
  await page.getByText('Import proposal JSON (optional)', { exact: true }).click(); await page.getByLabel('Convention proposal file').setInputFiles({ name: 'proposal.json', mimeType: 'application/json', buffer: Buffer.from('{bad') }); await page.getByRole('button', { name: 'Review imported proposal' }).click(); await expect(page.locator('#discovery-status')).toContainText('invalid JSON');
  const proposal = { version: 1, suggestions: [{ key: 'custom', category: { key: 'custom', name: 'Custom requirement', role: 'requirement' }, rule: { key: 'custom', category: 'custom', pattern: 'R:[a-z]+' }, modules: [{ key: 'gui', name: 'GUI' }], moduleRules: [{ key: 'gui', path: 'a.md', scope: 'file', modules: ['gui'] }], evidence: [{ id: 'R:alpha', file: 'a.md', offset: 2, end: 9, context: 'heading' }], uncertainty: 'Explicit heading; role and module require user review.' }] };
  await page.getByLabel('Convention proposal file').setInputFiles({ name: 'proposal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(proposal)) }); await page.getByRole('button', { name: 'Review imported proposal' }).click(); await expect(page.locator('#discovery-status')).toContainText('Imported 1');
  const row = candidate('R:alpha'); await row.locator(':scope > summary').click(); await expect(row).toContainText('Proposed modules: GUI');
  await expectInternalKeysHidden(page);
  await page.getByRole('button', { name: 'Add suggestions to draft' }).click(); await previewApply(); await expect(page.locator('.lens-card[data-id="R:alpha"] .module-badge')).toHaveText('GUI');
});
test('invalid and equivalent duplicate regex edits cannot be staged', async () => {
  await open(); await scan(); const row = await keepRef(); await row.getByLabel('Suggested regex').fill('('); await page.getByRole('button', { name: 'Add suggestions to draft' }).click(); await expect(page.locator('#discovery-status')).toContainText('regular expression');
  await row.getByLabel('Suggested regex').fill('\\bREQ-\\d+\\b'); await page.getByRole('button', { name: 'Add suggestions to draft' }).click();
  await expect(page.locator('#discovery-status')).toContainText('Cannot add suggestions'); await expect(page.locator('#config-apply')).toBeDisabled();
  await expect(row.locator('.discovery-ambiguous')).toContainText('duplicates an existing convention');
  await page.keyboard.press('Escape'); await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
});
test('expensive proposed regexes are stopped and discovery fits a laptop window', async () => {
  await writeFile(path.join(project, 'a.md'), original + '\n' + 'a'.repeat(40) + '!\n'); await page.locator('#refresh').click();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720)); await open(); await scan(); const row = await keepRef();
  await row.getByLabel('Suggested regex').fill('(a+)+$');
  await page.screenshot({ path: 'test-results/id-discovery-review.png' });
  expect(await page.locator('#project-configuration-dialog').evaluate(e => e.getBoundingClientRect().bottom <= innerHeight && e.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Add suggestions to draft' }).click(); await page.locator('#config-preview').click();
  await expect(page.locator('#config-error')).toContainText('was stopped', { timeout: 15000 }); await expect(page.locator('#config-apply')).toBeDisabled();
  await page.keyboard.press('Escape'); await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
});

test('bulk scope controls include offscreen files, preserve exclusions and validate an empty scope', async () => {
  await Promise.all(Array.from({ length: 30 }, (_, i) => writeFile(path.join(project, 'extra-' + i + '.md'), '# ITEM-' + i + '\n')));
  await mkdir(path.join(project, 'node_modules')); await writeFile(path.join(project, 'node_modules/ignored.md'), '# PRIVATE-1\n');
  await page.locator('#refresh').click(); await open(); await page.getByText('Markdown scope', { exact: true }).click();
  const files = page.locator('#discovery-scope-files input');
  await expect(files).toHaveCount(32); await expect(page.locator('#discovery-scope-files input:checked')).toHaveCount(32);
  await expect(page.locator('#discovery-scope-files')).not.toContainText('ignored.md');
  expect(await page.locator('#discovery-scope-files').evaluate(e => e.scrollHeight > e.clientHeight)).toBe(true);
  const deselect = page.getByRole('button', { name: 'Deselect all', exact: true });
  await deselect.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#discovery-scope-files input:checked')).toHaveCount(0);
  await expect(page.locator('#discovery-scope-summary')).toContainText('0 of 32 Markdown files selected');
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click(); await expect(page.locator('#discovery-status')).toContainText('Select at least one');
  await page.locator('#config-discovery').getByLabel('a.md', { exact: true }).check();
  await expect(page.locator('#discovery-scope-summary')).toContainText(original.length + ' characters');
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click(); await expect(page.locator('#discovery-status')).toContainText('Found 2 candidate groups in 1 files');
  await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.locator('#discovery-scope-files input:checked')).toHaveCount(32);
  await expect(page.locator('#discovery-review')).toBeEmpty(); await expect(page.locator('#discovery-status')).toContainText('Scope changed');
  await files.last().uncheck(); await expect(page.locator('#discovery-scope-files input:checked')).toHaveCount(31);
  await page.getByRole('button', { name: 'Select all', exact: true }).click(); await expect(files.last()).toBeChecked();
  await page.keyboard.press('Escape'); await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
});

test('renamed and staged draft categories are omitted; edited equivalent duplicates cannot be staged', async () => {
  await open(); await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const reqCategory = page.locator('#config-categories > .config-entry').first(); await reqCategory.locator(':scope > summary').click();
  await reqCategory.getByLabel('Name', { exact: true }).fill('Renamed requirements');
  await page.getByRole('tab', { name: 'Discover IDs', exact: true }).click();
  await page.getByText('Markdown scope', { exact: true }).click();
  await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
  await page.locator('#config-discovery').getByLabel('b.md', { exact: true }).check();
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('No new categories found');
  await expect(page.locator('#discovery-status')).toContainText('Omitted 1 existing category');
  await expect(page.locator('#discovery-review > .config-entry')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add suggestions to draft', exact: true })).toBeDisabled();

  await page.locator('#config-discovery').getByLabel('b.md', { exact: true }).uncheck();
  await page.locator('#config-discovery').getByLabel('a.md', { exact: true }).check();
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click();
  await expect(page.locator('#discovery-review > .config-entry')).toHaveCount(2);
  await expect(page.getByLabel('Suggested category', { exact: true })).toHaveCount(0);
  const ref = await keepRef(); await ref.getByLabel('Category display name', { exact: true }).fill('Bad duplicate');
  await ref.getByLabel('Suggested regex', { exact: true }).fill('\\bREQ-\\d+\\b');
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Cannot add suggestions');
  await expect(ref.locator('.discovery-ambiguous')).toContainText('duplicates an existing convention');
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  await expect(page.locator('#config-categories')).not.toContainText('Bad duplicate');
  await page.locator('#config-cancel').click(); await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
});

test('deletion preserves remaining edits and expansion; keyboard focus moves to a surviving entry', async () => {
  await open(); await scan();
  const ref = candidate('REF-01'), usb = candidate('USB3');
  await expect(candidate('REQ-01')).toHaveCount(0);
  await ref.locator(':scope > summary').click(); await ref.getByLabel('Category display name', { exact: true }).fill('Edited requirements');
  await ref.getByLabel('Suggested regex', { exact: true }).fill('REF-[0-9]{2}'); await ref.locator(':scope > summary').click();
  await usb.locator(':scope > summary').click(); await usb.getByLabel('Category display name', { exact: true }).fill('Edited technical IDs');
  await usb.getByLabel('Suggested role', { exact: true }).selectOption('design');
  await expect(ref).not.toHaveAttribute('open', ''); await ref.getByRole('button', { name: 'Delete', exact: true }).focus(); await page.keyboard.press('Enter');
  await expect(usb.locator(':scope > summary')).toBeFocused(); await expect(page.locator('#discovery-remaining')).toHaveText('1 suggestions remaining');
  await expect(usb).toHaveAttribute('open', ''); await expect(usb.getByLabel('Category display name', { exact: true })).toHaveValue('Edited technical IDs');
  await expect(usb.getByLabel('Suggested role', { exact: true })).toHaveValue('design');
  for (const name of ['Categories', 'Application modules', 'Discover IDs']) await page.getByRole('tab', { name, exact: true }).click();
  await expect(ref).toHaveCount(0); await expect(page.locator('#discovery-remaining')).toHaveText('1 suggestions remaining');
  await usb.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Discover by patterns', exact: true })).toBeFocused();
  await expect(page.locator('#discovery-remaining')).toHaveText('0 suggestions remaining');
  await expect(page.getByRole('button', { name: 'Add suggestions to draft', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Delete all suggestions', exact: true })).toBeDisabled();
  await expect(page.locator('.config-category')).toHaveCount(11); await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
  await scan(); await expect(page.locator('#discovery-review > .config-entry')).toHaveCount(2);
});

test('deleting a new review leaves staged/configured categories intact and supports both themes at minimum size', async () => {
  await open(); await scan(); const row = await keepRef(); await row.getByLabel('Category display name', { exact: true }).fill('Staged requirements');
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await scan(); await expect(page.locator('#discovery-review > .config-entry')).toHaveCount(1);
  await expect(candidate('REF-01')).toHaveCount(0); await expect(candidate('REQ-01')).toHaveCount(0); await expect(candidate('USB3')).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete all suggestions', exact: true }).click(); await expect(page.locator('#discovery-review')).toBeEmpty();
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  await expect(page.locator('#config-categories')).toContainText('Staged requirements'); await expect(page.locator('.config-category')).toHaveCount(12);
  await previewApply(); const stored = await readFile(path.join(project, '.specular/project.json'), 'utf8');
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 720));
  for (const theme of ['dark', 'light']) {
    if (theme === 'light') await page.locator('#theme-switch').click();
    await open(); await scan(); if (!await page.locator('#discovery-scope-files').isVisible()) await page.getByText('Markdown scope', { exact: true }).click();
    await page.getByRole('button', { name: 'Deselect all', exact: true }).focus(); await page.keyboard.press('Enter');
    await expect(page.locator('#discovery-scope-summary')).toContainText('0 of 2');
    await page.getByRole('button', { name: 'Select all', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.screenshot({ path: 'test-results/discovery-scope-' + theme + '.png' });
    await scan(); const usb = candidate('USB3'); await expect(usb).not.toHaveAttribute('open', '');
    await usb.locator(':scope > summary').click(); await expect(usb.getByLabel('Category display name', { exact: true })).toBeVisible();
    await expect(usb.getByLabel('Suggested category', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: 'test-results/discovery-new-category-' + theme + '.png' });
    await usb.locator(':scope > summary').click();
    await expect(usb.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true })).toBeVisible();
    await usb.getByRole('button', { name: 'Delete', exact: true }).focus(); await page.keyboard.press('Enter');
    await page.screenshot({ path: 'test-results/discovery-delete-' + theme + '.png' });
    await expect(page.locator('#discovery-remaining')).toHaveText('0 suggestions remaining');
    expect(await page.locator('#project-configuration-dialog').evaluate(e => e.scrollWidth <= e.clientWidth && e.getBoundingClientRect().bottom <= innerHeight)).toBe(true);
    await page.keyboard.press('Escape'); expect(await readFile(path.join(project, '.specular/project.json'), 'utf8')).toBe(stored);
  }
  expect(await readFile(path.join(project, 'a.md'), 'utf8')).toBe(original);
});

test('import deletion drops only the discarded proposal including its modules and rules; empty import cannot stage', async () => {
  await open(); await page.getByText('Import proposal JSON (optional)', { exact: true }).click();
  const imported = { version: 1, suggestions: [
    { key: 'custom', category: { key: 'custom', name: 'Imported requirements' }, rule: { key: 'custom', category: 'custom', pattern: 'REF-\\d+' }, evidence: [{ id: 'REF-01', file: 'a.md', offset: 2, end: 8, context: 'heading' }], uncertainty: 'Explicit heading.' },
    { key: 'discard', category: { key: 'discard', name: 'Discard me' }, rule: { key: 'discard', category: 'discard', pattern: 'REQ-\\d+' }, modules: [{ key: 'discard', name: 'Discarded module' }], moduleRules: [{ key: 'discard', path: 'b.md', scope: 'file', modules: ['discard'] }], evidence: [{ id: 'REQ-01', file: 'b.md', offset: 2, end: 8, context: 'heading' }], uncertainty: 'Already configured.' },
  ] };
  const load = async (value: unknown) => {
    await page.getByLabel('Convention proposal file').setInputFiles({ name: 'proposal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
    await page.getByRole('button', { name: 'Review imported proposal', exact: true }).click();
  };
  await load({ version: 1, suggestions: [] }); await expect(page.locator('#discovery-status')).toContainText('proposal contained no suggestions');
  await expect(page.getByRole('button', { name: 'Add suggestions to draft', exact: true })).toBeDisabled();
  await load(imported); await expect(page.locator('#discovery-remaining')).toHaveText('2 suggestions remaining');
  await expect(page.getByLabel('Suggested category', { exact: true })).toHaveCount(0);
  await expect(candidate('REQ-01').locator('.discovery-ambiguous')).toContainText('proposed rule is different or wider');
  const ref = candidate('REF-01'); await ref.locator(':scope > summary').click(); await ref.getByLabel('Category display name', { exact: true }).fill('Keep imported edits');
  const discarded = candidate('REQ-01'); await discarded.locator(':scope > summary').click(); await discarded.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(ref.getByLabel('Category display name', { exact: true })).toHaveValue('Keep imported edits');
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click(); await previewApply();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.some((c: any) => c.name === 'Keep imported edits')).toBe(true);
  expect(saved.categories.some((c: any) => c.name === 'Discard me')).toBe(false); expect(saved.modules ?? []).toEqual([]);
  expect(saved.rules.filter((r: any) => r.prefix === 'REQ')).toHaveLength(1);
});

test('folder scope recursively selects collapsed descendants and shows partial ancestor selection', async () => {
  await mkdir(path.join(project, 'docs/nested'), { recursive: true });
  await mkdir(path.join(project, 'other'), { recursive: true });
  await writeFile(path.join(project, 'docs/top.md'), '# TOP-1\nTOP-2\n');
  await writeFile(path.join(project, 'docs/nested/deep.md'), '# DEEP-1\nDEEP-2\n');
  await writeFile(path.join(project, 'other/outside.md'), '# OUT-1\n');
  await page.locator('#refresh').click(); await open(); await page.getByText('Markdown scope', { exact: true }).click();
  const docs = page.getByRole('checkbox', { name: 'Folder docs', exact: true });
  const nested = page.getByRole('checkbox', { name: 'Folder docs/nested', exact: true });
  const deep = page.getByRole('checkbox', { name: 'docs/nested/deep.md', exact: true });
  await expect(page.locator('#discovery-scope-summary')).toContainText('5 of 5');
  await expect(page.locator('#discovery-scope-files details[open]')).toHaveCount(0);
  await page.locator('details[data-folder="docs"] > summary > span').click();
  await page.locator('details[data-folder="docs/nested"] > summary > span').click();
  await deep.uncheck(); await expect(docs).toBeChecked({ indeterminate: true }); await expect(nested).not.toBeChecked();
  await page.locator('details[data-folder="docs"] > summary > span').click();
  await expect(deep).not.toBeVisible();
  await docs.check(); await expect(page.locator('#discovery-scope-files input[data-scope-file]:checked')).toHaveCount(5);
  await expect(page.locator('details[data-folder="docs"]')).not.toHaveAttribute('open');
  await docs.uncheck(); await expect(page.locator('#discovery-scope-summary')).toContainText('3 of 5');
  await expect(page.locator('input[data-scope-file="other/outside.md"]')).toBeChecked();
  await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
  await docs.check(); await expect(page.locator('#discovery-scope-summary')).toContainText('2 of 5');
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Found 2 candidate groups in 2 files');
  await expect(page.locator('#discovery-review')).toContainText('DEEP-1');
  await expect(page.locator('#discovery-review')).not.toContainText('OUT-1');
  await page.locator('details[data-folder="docs"] > summary > span').click();
  await expect(nested).toBeChecked(); await expect(deep).toBeChecked();
  await page.screenshot({ path: 'test-results/discovery-folder-scope.png' });
});

test('Select all covers large scopes for patterns and keeps the local occurrence limit intact', async () => {
  await Promise.all(Array.from({ length: 200 }, (_, i) => writeFile(path.join(project, 'limit-' + i + '.md'), 'Nothing here.\n')));
  await page.locator('#refresh').click(); await open(); await page.getByText('Markdown scope', { exact: true }).click();
  await page.getByRole('button', { name: 'Deselect all', exact: true }).click(); await page.getByRole('button', { name: 'Select all', exact: true }).click();
  await expect(page.locator('#discovery-scope-files input:checked')).toHaveCount(202);
  // Without Discover by AI (86c) the scope has no 200-file or 120,000-character limit.
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click(); await expect(page.locator('#discovery-status')).toContainText('in 202 files');
  await page.locator('#config-cancel').click();
  await writeFile(path.join(project, 'a.md'), 'REF-1 '.repeat(20001)); await page.locator('#refresh').click(); await open();
  if (!await page.locator('#discovery-scope-files').isVisible()) await page.getByText('Markdown scope', { exact: true }).click();
  await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
  await page.locator('#config-discovery').getByLabel('a.md', { exact: true }).check();
  await page.getByRole('button', { name: 'Discover by patterns', exact: true }).click(); await expect(page.locator('#discovery-status')).toContainText('20,000 occurrences');
  await expect(page.locator('#discovery-review')).toBeEmpty(); await expect(page.getByRole('button', { name: 'Add suggestions to draft', exact: true })).toBeDisabled();
  await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
});
