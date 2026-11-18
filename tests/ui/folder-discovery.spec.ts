import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expandDiscoveryMethods } from './configuration-entries';
import { seedLegacyConfiguration } from './legacy-configuration';

/** Increment 96: Discover by patterns proposes folder-derived features for spec folders. */
let app: ElectronApplication, page: Page, root: string, project: string;
const FILES: Record<string, string> = {
  'specs/001-login/spec.md': '# Login\n\n## REQ-1 Sign in\n',
  'specs/002-export/spec.md': '# Export\n\n## REQ-2 Export reports\n\n## REQ-3 Schedule exports\n',
  '.kiro/specs/x/requirements.md': '# Requirements X\n',
  '.kiro/specs/x/tasks.md': '# Tasks X\n',
  '.kiro/specs/y/bugfix.md': '# Bugfix Y\n',
  'README.md': '# Demo\n',
};
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow(); await expect(page.locator('#project-heading')).toHaveText('project');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())); await app.close(); }
async function open() {
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
}
const entry = (text: string) => page.locator('#discovery-review > .config-entry').filter({ has: page.locator(':scope > summary').filter({ hasText: text }) });
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/folder-discovery-')); project = path.join(root, 'project');
  for (const [file, text] of Object.entries(FILES)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  await seedLegacyConfiguration(project); await launch();
});
test.afterEach(async ({}, info) => { if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {}); if (app) await close().catch(() => {}); });

test('Discover by patterns proposes spec folders as features, stages them through Update, and omits them once derived', async () => {
  await open();
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Found 2 folder-derived feature suggestions.');
  const specs = entry('Folder-derived features: specs/*'), kiro = entry('Folder-derived features: .kiro/specs/*');
  await expect(kiro.locator(':scope > summary')).toHaveText(/^\d+\. Folder-derived features: \.kiro\/specs\/\*Delete$/);
  await specs.locator(':scope > summary').click();
  await expect(specs.locator('.discovery-convention')).toHaveText('Pattern: specs/*. 2 folders: 001-login (1 IDs), 002-export (2 IDs).');
  await expect(specs).toContainText('3 defined IDs would be assigned under the current draft');
  await expect(specs.getByRole('button', { name: 'Login - specs/001-login/spec.md (heading)', exact: true })).toBeVisible();
  // Delete the Kiro suggestion and the ID categories; keep the Spec Kit folders.
  for (const item of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    const title = (await item.locator(':scope > summary').textContent())!;
    if (title.includes('Folder-derived features: specs/*')) continue;
    await item.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await expect(page.locator('#discovery-remaining')).toHaveText('1 suggestions remaining');
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Added 1 folder pattern (specs/*) with 2 new features.');
  // Scanning again omits the derived root.
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Omitted 1 folder pattern already in the draft.');
  await expect(entry('Folder-derived features: specs/*')).toHaveCount(0);
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.folderGenerators).toEqual([{ key: 'generator1', target: 'features', pattern: 'specs/*', exclusions: [] }]);
  expect(saved.features.map((f: { name: string }) => f.name)).toEqual(['001-login', '002-export']);
  await close(); await launch();
  await expect(page.locator('.lens-card[data-id="REQ-2"] .feature-badge')).toHaveText('002-export');
  await expect(page.locator('.lens-card[data-id="REQ-1"] .feature-badge')).toHaveText('001-login');
});

test('a folder suggestion that collides with a manual feature stages nothing and explains why', async () => {
  await mkdir(path.join(project, '.specular'), { recursive: true });
  await writeFile(path.join(project, '.specular/project.json'), JSON.stringify({ version: 1, categories: [{ key: 'requirements', name: 'Requirements', role: 'requirement' }], rules: [{ key: 'req', category: 'requirements', prefix: 'REQ' }], features: [{ key: 'manual', name: '001-login' }] }));
  await page.locator('#refresh').click(); await open();
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Found 2 folder-derived feature suggestions.');
  await entry('Folder-derived features: .kiro/specs/*').locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Cannot add the folder-derived features: 001-login: Name collision.');
  await expect(entry('Folder-derived features: specs/*')).toHaveCount(1);
  await page.getByRole('tab', { name: 'Application features', exact: true }).click();
  await expect(page.locator('#config-folder-features input[aria-label="Folder pattern"]')).toHaveCount(0);
});

test('specifications at more than one depth are proposed as specs/**, and the pattern also works in Application features (96a)', async () => {
  await mkdir(path.join(project, 'specs/group/003-search'), { recursive: true });
  await writeFile(path.join(project, 'specs/group/003-search/spec.md'), '# Search\n\n## REQ-4 Search reports\n');
  await writeFile(path.join(project, 'specs/group/overview.md'), '# Group overview\n');
  await page.locator('#refresh').click(); await open();
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('folder-derived feature');
  const specs = entry('Folder-derived features: specs/**');
  await specs.locator(':scope > summary').click();
  await expect(specs.locator('.discovery-convention')).toHaveText('Pattern: specs/**. 3 folders: 001-login (1 IDs), 002-export (2 IDs), group/003-search (1 IDs).');
  await expect(specs).toContainText('sit at more than one depth');
  for (const item of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    if ((await item.locator(':scope > summary').textContent())!.includes('Folder-derived features: specs/**')) continue;
    await item.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Added 1 folder pattern (specs/**) with 3 new features.');
  await page.getByRole('tab', { name: 'Application features', exact: true }).click();
  await expect(page.locator('#config-folder-features input[aria-label="Folder pattern"]')).toHaveValue('specs/**');
  await expect(page.locator('#config-folder-features h3')).toHaveAttribute('title', /specs\/\*\* gives one per folder holding a specification file/);
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.generatedFolders.map((m: { folder: string }) => m.folder)).toEqual(['specs/001-login', 'specs/002-export', 'specs/group/003-search']);
  await close(); await launch();
  await expect(page.locator('.lens-card[data-id="REQ-4"] .feature-badge')).toHaveText('003-search');
  // Typed by hand: a modules pattern with ** stages its entries through Update.
  await page.locator('#project-config-open').click(); await page.locator('#config-tab-modules').click();
  const modules = page.locator('#config-folder-modules');
  await modules.getByRole('button', { name: 'Add folder pattern', exact: true }).click();
  await modules.getByLabel('Folder pattern', { exact: true }).fill('.kiro/specs/**');
  await modules.getByRole('button', { name: 'Update modules', exact: true }).click();
  await expect(page.locator('#config-status')).toContainText('Folder updates staged');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const modulesSaved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(modulesSaved.modules.map((m: { name: string }) => m.name)).toEqual(['x', 'y']);
});

test('restarting requirement numbers are proposed with a scope per specification, exclusive of a stray report (96b)', async () => {
  for (const folder of ['001-login', '002-export']) await writeFile(path.join(project, 'specs', folder, 'requirements.md'), '# Requirements\n\n### Requirement 1\n\n### Requirement 2\n');
  await mkdir(path.join(project, 'docs'), { recursive: true }); await writeFile(path.join(project, 'docs/report.md'), '# Report\n\n### Requirement 1\n');
  await page.locator('#refresh').click(); await open();
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('candidate groups');
  const requirement = page.locator('#discovery-review > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: '- Requirement' }) });
  await requirement.locator(':scope > summary').click();
  await expect(requirement.locator('.discovery-scopes')).toHaveText('Scopes: specs/*.');
  await expect(requirement).toContainText('Numbering restarts in each specification, so specs/* gives each one its own scope. 1 file outside the specification folders also uses it');
  const exclusive = requirement.getByLabel('Recognize only inside its scopes');
  await expect(exclusive).toBeChecked(); await exclusive.uncheck(); await exclusive.check();
  for (const item of (await page.locator('#discovery-review > .config-entry').all()).reverse()) {
    if ((await item.locator(':scope > summary').textContent())!.includes('- Requirement')) continue;
    await item.locator(':scope > summary').getByRole('button', { name: 'Delete', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Add suggestions to draft', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('Nothing has been saved');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await expect(page.locator('#config-summary')).toContainText('0 duplicate definitions');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.find((c: { name: string }) => c.name === 'Requirement')).toMatchObject({ idScopes: [{ pattern: 'specs/*' }], onlyInScopes: true });
});
