import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Review of convention proposals (increments 48, 62, 67), reached through Import proposal JSON since increment 86c removed
 * the single-prompt Discover by AI that fed the same review.
 */
let app: ElectronApplication, page: Page, project: string, userData: string;
const source = '# REF-01 Customer requirements\nREF-02\n\n# R:alpha Interface behavior\n';
const proposal = { version: 1, suggestions: [
  { key: 'ref', category: { key: 'ref', name: 'Customer requirements' }, rule: { key: 'ref', category: 'ref', pattern: '\\bREF-\\d+\\b' }, modules: [], moduleRules: [], evidence: [{ id: 'REF-01', file: 'gui/a.md', offset: 2, end: 8, context: 'heading' }], uncertainty: 'Likely requirements; confirm the category with the author.' },
  { key: 'custom', category: { key: 'custom', name: 'Interface requirements' }, rule: { key: 'custom', category: 'custom', pattern: '\\bR:[a-z]+\\b' }, modules: [{ key: 'gui', name: 'GUI' }], moduleRules: [{ key: 'gui-files', path: 'gui', scope: 'folder', modules: ['gui'] }], evidence: [{ id: 'R:alpha', file: 'gui/a.md', offset: source.indexOf('R:alpha'), end: source.indexOf('R:alpha') + 7, context: 'heading' }], uncertainty: 'Unfamiliar custom format in the GUI folder.' },
] };
async function launch(restart = false) {
  if (!restart) {
    const base = path.resolve('.cache/proposal-review-tests'); await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, 'run-')); project = path.join(root, 'project'); userData = path.join(root, 'user-data');
    await mkdir(path.join(project, 'gui'), { recursive: true }); await writeFile(path.join(project, 'gui/a.md'), source);
  }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: userData } });
  page = await app.firstWindow(); await expect(page.locator('#project-heading')).toHaveText('project');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())); await app.close(); }
async function open() { await page.locator('#project-config-open').click(); await expect(page.getByRole('tab', { name: 'Discover IDs', exact: true })).toHaveAttribute('aria-selected', 'true'); }
async function importProposal(value: unknown) {
  const section = page.getByText('Import proposal JSON (optional)', { exact: true });
  if (!await page.getByLabel('Convention proposal file').isVisible()) await section.click();
  await page.getByLabel('Convention proposal file').setInputFiles({ name: 'proposal.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) });
  await page.getByRole('button', { name: 'Review imported proposal', exact: true }).click();
}
async function unchanged() { await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow(); expect(await readFile(path.join(project, 'gui/a.md'), 'utf8')).toBe(source); }
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  await close().catch(() => {});
});

test('list evidence reaches reviewed definitions and survives restart', async () => {
  const listSource = '- **FR-001**: The application shall save documents.\n- **FR-002**: The application shall restore documents.\n';
  const listProposal = { version: 1, suggestions: [{ key: 'fr', category: { key: 'fr', name: 'Requirements' }, rule: { key: 'fr', category: 'fr', pattern: '\\bFR-\\d+\\b' }, modules: [], moduleRules: [], uncertainty: 'Two explicit requirement records in list items.', evidence: ['FR-001', 'FR-002'].map(id => ({ id, file: 'gui/a.md', offset: listSource.indexOf(id), end: listSource.indexOf(id) + id.length, context: 'list-item' })) }] };
  await launch();
  await writeFile(path.join(project, 'gui/a.md'), listSource); await page.locator('#refresh').click();
  await open(); await importProposal(listProposal);
  await expect(page.locator('#discovery-status')).toContainText('Imported 1 suggestions');
  const row = page.locator('#discovery-review > details').filter({ has: page.locator(':scope > summary').filter({ hasText: 'FR-001' }) });
  await row.locator(':scope > summary').click();
  await expect(row.getByRole('button', { name: 'FR-001 - gui/a.md (list-item)', exact: true })).toBeVisible();
  await row.getByText('ID definition sites', { exact: true }).click();
  await expect(row.getByLabel('Category definition sites', { exact: true })).toHaveValue('inherit');
  await row.getByLabel('Category definition sites', { exact: true }).selectOption('override'); await row.getByLabel('Enable list definitions').check();
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Nothing has been saved');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-summary')).toContainText('2 definitions');
  await page.locator('#config-apply').click(); await expect(page.locator('#metric-ids')).toHaveText('2');
  expect(await readFile(path.join(project, 'gui/a.md'), 'utf8')).toBe(listSource);
  await close(); await launch(true); await expect(page.locator('#metric-ids')).toHaveText('2');
});

test('reviews unfamiliar IDs and modules, edits regex and color, applies and survives restart', async () => {
  await launch(); await open(); await importProposal(proposal);
  await expect(page.locator('#discovery-status')).toContainText('Imported 2 suggestions'); await unchanged();
  await expect(page.locator('#discovery-remaining')).toHaveText('2 suggestions remaining');
  const rows = page.locator('#discovery-review > details');
  for (const row of await rows.all()) { await row.locator(':scope > summary').click(); }
  await expect(page.locator('#project-configuration-dialog').getByRole('textbox', { name: /key/i })).toHaveCount(0);
  await expect(page.locator('#project-configuration-dialog textarea')).toHaveCount(0);
  await rows.filter({ has: page.locator(':scope > summary').filter({ hasText: 'REF-01' }) }).getByLabel('Suggested regex').fill('\\bREF-[0-9]{2}\\b');
  await page.getByRole('button', { name: 'Add suggestions to draft' }).click();
  await page.getByRole('tab', { name: 'Categories', exact: true }).click();
  const category = page.locator('#config-categories > details').filter({ has: page.locator(':scope > summary').filter({ hasText: 'Customer requirements' }) });
  if (await category.getAttribute('open') === null) await category.locator(':scope > summary').click();
  await category.getByText('Card colors', { exact: true }).click();
  await category.getByLabel('Dark mode hex', { exact: true }).fill('#ffcc00');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  await expect(page.locator('.lens-card[data-id="R:alpha"] .module-badge')).toHaveText('GUI');
  await expect(page.locator('.lens-card[data-id="REF-01"]')).toHaveCSS('border-left-color', 'rgb(255, 204, 0)');
  expect(await readFile(path.join(project, 'gui/a.md'), 'utf8')).toBe(source);
  await close(); await launch(true); await expect(page.locator('#metric-ids')).toHaveText('2');
});

test('a proposal omits categories already staged in the current draft', async () => {
  await launch(); await open(); await importProposal(proposal); await expect(page.locator('#discovery-remaining')).toHaveText('2 suggestions remaining');
  await expect(page.getByLabel('Suggested category', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await importProposal(proposal); await expect(page.locator('#discovery-status')).toContainText('No new categories found');
  await expect(page.locator('#discovery-status')).toContainText('Omitted 2 existing categories');
  await expect(page.locator('#discovery-review > details')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add suggestions to draft', exact: true })).toBeDisabled();
  await page.locator('#config-cancel').click(); await unchanged();
});

test('review-only deletion preserves surviving edits through staging', async () => {
  await launch(); await open(); await importProposal(proposal); await expect(page.locator('#discovery-status')).toContainText('Imported 2 suggestions');
  const rows = page.locator('#discovery-review > details'), ref = rows.filter({ hasText: 'REF-01' }), custom = rows.filter({ hasText: 'R:alpha' });
  await custom.locator(':scope > summary').click(); await custom.getByLabel('Category display name', { exact: true }).fill('Keep reviewed edits');
  await ref.locator(':scope > summary').click(); await ref.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(custom.locator(':scope > summary')).toBeFocused(); await expect(page.locator('#discovery-remaining')).toHaveText('1 suggestions remaining');
  await expect(page.locator('#discovery-review').getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Application modules', exact: true }).click(); await page.getByRole('tab', { name: 'Discover IDs', exact: true }).click();
  await expect(custom.getByLabel('Category display name', { exact: true })).toHaveValue('Keep reviewed edits');
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.some((c: { name: string }) => c.name === 'Keep reviewed edits')).toBe(true);
  expect(saved.categories.some((c: { name: string }) => c.name === 'Customer requirements')).toBe(false);
  await expect(page.locator('.lens-card[data-id="R:alpha"] .module-badge')).toHaveText('GUI');
  expect(await readFile(path.join(project, 'gui/a.md'), 'utf8')).toBe(source);
});

test('Discover IDs has one AI method, and its Agent setup route returns to the configuration', async () => {
  await launch(); await open();
  await expect(page.locator('#discovery-ai')).toHaveCount(0);
  await expect(page.locator('#config-discovery').getByRole('button', { name: 'Agent setup', exact: true })).toHaveCount(1);
  await expect(page.locator('#config-discovery > details > summary')).toHaveText(['Discover with an agent', /^Markdown scope/, 'Discover by patterns', 'Import proposal JSON (optional)']);
  await page.getByLabel('Agent model').fill('retained-model');
  await page.locator('#discovery-agent').getByRole('button', { name: 'Agent setup', exact: true }).click();
  await expect(page.locator('#agent-setup-dialog')).toBeVisible(); await unchanged();
  await page.locator('#agent-setup-close').click();
  await expect(page.locator('#project-configuration-dialog')).toBeVisible();
  await expect(page.getByLabel('Agent model')).toHaveValue('retained-model');
  await page.locator('#discovery-agent').getByRole('button', { name: 'Agent setup', exact: true }).click();
  await page.keyboard.press('Escape'); await expect(page.locator('#project-configuration-dialog')).toBeVisible();
  await page.locator('#config-cancel').click(); await unchanged();
});
