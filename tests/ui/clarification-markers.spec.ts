import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Increment 99b: open clarification markers appear in Issues with their question and owning ID. */
let app: ElectronApplication, page: Page;
const CONFIGURATION = { version: 1, categories: [{ key: 'fr', name: 'Functional requirement', role: 'requirement' }], rules: [{ key: 'fr', category: 'fr', pattern: '\\bFR-\\d{3}\\b' }],
  idDefinitionSites: { headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: false, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered'], mode: 'start' } } };
const FILES: Record<string, string> = {
  '.specular/project.json': JSON.stringify(CONFIGURATION),
  'specs/001-login/spec.md': '# Login\n\n## Requirements\n\n- **FR-001**: Users MUST sign in via [NEEDS CLARIFICATION: auth method not specified]\n- **FR-002**: Users MUST sign out.\n\n- [x] No [NEEDS CLARIFICATION: leftover] markers remain\n',
};
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.cache/ui-tests/clarifications-')), project = path.join(root, 'project');
  for (const [file, text] of Object.entries(FILES)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow();
  await expect(page.locator('#workspace')).toBeVisible();
});
test.afterEach(async () => {
  if (app) { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
});

test('Issues lists an open clarification with its question and requirement, and opens it', async () => {
  await expect(page.locator('#metric-pending')).toHaveText('1');
  await page.locator('#pending-tab').click();
  const row = page.locator('#lens-results .lens-row');
  await expect(row).toHaveCount(1);
  await expect(row.locator('strong')).toHaveText('Needs clarification');
  await expect(row.locator('span')).toHaveText('auth method not specified');
  await expect(row.locator('small')).toHaveText('specs/001-login/spec.md:5 · in FR-001');
  await page.locator('#id-search').fill('fr-001');
  await expect(row).toHaveCount(1);
  await page.locator('#id-search').fill('');
  await row.click();
  await expect(page.locator('#document-path')).toHaveText('specs/001-login/spec.md');
  await expect(page.locator('#cursor-status')).toContainText('Ln 5,');
});
