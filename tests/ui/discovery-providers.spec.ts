import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expandDiscoveryMethods } from './configuration-entries';

/** Increment 97b: providers by tool in the Discover tab, a project profile in .specular/profiles/, and a switch that survives restart. */
let app: ElectronApplication, page: Page, root: string, project: string;
const tasks = (title: string) => `# Tasks: ${title}\n\n## Phase 1: Setup (Shared Infrastructure)\n\n- [ ] T001 Create the project\n- [ ] T002 [P] Configure linting\n\n## Phase 2: Foundational (Blocking Prerequisites)\n\n- [ ] T003 Add the database\n\n## Phase 3: User Story 1 - Sign in (Priority: P1)\n\n- [ ] T004 [US1] Sign in\n\n## Phase 5: Polish & Cross-Cutting Concerns\n\n- [ ] T006 Update docs\n`;
const adr = (n: number) => `## Decision ${n}: Use SQLite\n\n### Consequences\n\n1. One file\n2. No server\n`;
const FILES: Record<string, string> = { '.specify/memory/constitution.md': '# Constitution\n', 'specs/001-a/tasks.md': tasks('A'), 'specs/002-b/tasks.md': tasks('B'), 'specs/003-c/tasks.md': tasks('C'),
  'docs/decisions/a.md': '# Decisions\n\n' + adr(1), 'docs/decisions/b.md': '# Decisions\n\n' + adr(2) + '\n' + adr(3) };
const PROFILE = { schema: 1, id: 'team-decisions', tool: 'Team ADRs', versions: 'docs/decisions template v2',
  detectors: [{ id: 'consequences', kind: 'list-section', heading: 'Consequences', within: 'numbered-keyword', min: 3 }],
  proposals: [{ detector: 'consequences', key: '{{parent}}-consequences', name: 'Consequence', numberedItems: { id: 'Consequence {parent}.{item}' }, scope: 'parent', uncertainty: [{ text: '{{items}} consequences under {{keyword}} headings.' }] }] };
async function launch() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } }); page = await app.firstWindow(); await expect(page.locator('#project-heading')).toHaveText('project');
}
async function close() { await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(w => w.destroy())).catch(() => {}); await app.close().catch(() => {}); }
async function openDiscover() {
  await expect(async () => {
    if (!await page.locator('#project-configuration-dialog').isVisible()) await page.locator('#project-config-open').click();
    await expect(page.getByRole('tab', { name: 'Discover', exact: true })).toHaveAttribute('aria-selected', 'true', { timeout: 300 });
  }).toPass({ timeout: 10000 });
  await expandDiscoveryMethods(page);
  const providers = page.locator('#discovery-providers');
  if (await providers.getAttribute('open') === null) await providers.locator(':scope > summary').click();
}
const entry = (text: string) => page.locator('#discovery-review > .config-entry').filter({ has: page.locator(':scope > summary', { hasText: text }) });
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true }); root = await mkdtemp(path.resolve('.cache/ui-tests/discovery-providers-')); project = path.join(root, 'project');
  for (const [file, text] of Object.entries(FILES)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  await mkdir(path.join(project, '.specular/profiles'), { recursive: true });
  await writeFile(path.join(project, '.specular/profiles/adr.json'), JSON.stringify(PROFILE));
  await writeFile(path.join(project, '.specular/profiles/broken.json'), '{');
  await launch();
});
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  if (app) await close();
});

test('providers are listed by tool with switches; a project profile proposes under its tool; switches that differ from applicability are saved and survive restart', async () => {
  await openDiscover();
  const list = page.locator('#discovery-provider-list');
  await expect(list.locator('li label')).toHaveText(['Kiro', 'Spec Kit', 'Trae', 'Team ADRs']);
  await expect(list.locator('li').filter({ hasText: 'Team ADRs' })).toContainText('.specular/profiles/adr.json · docs/decisions template v2');
  await expect(list.locator('.discovery-provider-error')).toHaveText('Skipped: .specular/profiles/broken.json is not valid JSON.');
  // 97d: providers are on where they apply.
  await expect(list.locator('li').filter({ hasText: 'Spec Kit' }).locator('.discovery-provider-applies')).toHaveText(' · detected: 1 file, such as .specify/memory/constitution.md');
  await expect(list.locator('li').filter({ hasText: 'Kiro' }).locator('.discovery-provider-applies')).toHaveText(' · not detected');
  await expect(list.locator('li').filter({ hasText: 'Trae' }).locator('.discovery-provider-applies')).toHaveText(' · not detected');
  await expect(list.locator('li').filter({ hasText: 'Team ADRs' }).locator('.discovery-provider-applies')).toHaveText(' · applies to every project');
  // Each provider takes one line without a bullet: its description sits to the right of the name.
  await expect(list).toHaveCSS('list-style-type', 'none');
  for (const tool of ['Kiro', 'Spec Kit', 'Trae']) {
    const item = list.locator('li').filter({ hasText: tool }), name = (await item.locator('label').boundingBox())!, description = (await item.locator('.config-hint').first().boundingBox())!;
    expect(Math.abs(name.y + name.height / 2 - (description.y + description.height / 2))).toBeLessThan(4); expect(description.x).toBeGreaterThan(name.x + name.width - 1);
  }
  await expect(page.getByRole('checkbox', { name: 'Use the Kiro provider', exact: true })).not.toBeChecked();
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('candidate groups');
  await expect(page.locator('#discovery-status')).toContainText('Skipped a discovery provider: .specular/profiles/broken.json is not valid JSON.');
  const consequence = entry('Consequence · Team ADRs');
  await consequence.locator(':scope > summary').click();
  await expect(consequence.locator('.discovery-provider')).toHaveText('Proposed by the Team ADRs profile.');
  await expect(consequence).toContainText('6 consequences under Decision headings.');
  await expect(entry('T001').locator('.discovery-tags')).toHaveCount(1);
  // Spec Kit off: the next scan leaves the tasks untagged.
  await page.getByRole('checkbox', { name: 'Use the Spec Kit provider', exact: true }).uncheck();
  await expect(page.locator('#discovery-status')).toContainText('Spec Kit provider off. Discover again to use the change.');
  await page.getByRole('button', { name: 'Run heuristic discovery', exact: true }).click();
  await expect(page.locator('#discovery-status')).toContainText('candidate groups');
  await expect(entry('T001')).toHaveCount(1);
  await expect(entry('T001').locator('.discovery-tags')).toHaveCount(0);
  // Kiro on where it does not apply is stored as enabled; turning it off again would store nothing.
  await page.getByRole('checkbox', { name: 'Use the Kiro provider', exact: true }).check();
  // Apply saves the switches; they survive restart.
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  expect(JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8')).discoveryProviders).toEqual({ disabled: ['spec-kit'], enabled: ['kiro'] });
  await close(); await launch(); await openDiscover();
  await expect(page.getByRole('checkbox', { name: 'Use the Spec Kit provider', exact: true })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Use the Kiro provider', exact: true })).toBeChecked();
});
