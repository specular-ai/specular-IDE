import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fakeClaude, fakeCodex, PROJECT } from '../helpers/agent-discovery-fixtures';

let app: ElectronApplication, page: Page, project: string;
async function launch(scenario: Parameters<typeof fakeCodex>[0]) {
  const fixture = await fakeCodex(scenario);
  project = path.join(fixture.root, 'project');
  for (const [file, text] of Object.entries(PROJECT)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(fixture.root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#project-heading')).toHaveText('project');
  await page.locator('#show-agent-setup').click();
  await page.locator('#codex-path').fill(fixture.executable); await page.locator('#codex-api-key').fill('sk-fixture');
  await page.locator('#codex-connect').click(); await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status', 'connected', { timeout: 20000 });
  await page.locator('#agent-setup-close').click();
  await page.locator('#project-config-open').click(); await expect(page.getByRole('tab', { name: 'Discover IDs', exact: true })).toHaveAttribute('aria-selected', 'true');
  return fixture;
}
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) await page?.screenshot({ path: info.outputPath('failure.png') }).catch(() => {});
  await app?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {}); await app?.close().catch(() => {});
});

test('agent discovery runs through the Specular MCP server and stages a reviewed selection', async () => {
  test.setTimeout(90000);
  await launch('standard');
  await page.locator('#run-agent-discovery').click();
  const review = page.locator('#agent-discovery-review');
  await expect(review.locator('[data-category="requirements"] h4')).toHaveText('Functional requirements · New', { timeout: 30000 });
  await expect(review.locator('[data-category="requirements"] .agent-discovery-counts')).toHaveText('3 definitions · 4 references · 4 distinct IDs · 0 duplicates · 1 unresolved');
  await expect(review.locator('[data-category="requirements"] .agent-discovery-rationale')).toContainText('Agent rationale (agent-generated): FR-NNN bullets');
  await expect(review.locator('[data-category="tasks"] li')).toHaveText('Pattern: \\bT\\d{3}\\b');
  await expect(page.locator('#agent-discovery-progress .agent-progress-tool').filter({ hasText: 'Evaluated draft' })).toHaveText('2/80 · Evaluated draft 1: 2 categories, 6 definitions, 0 duplicates');
  await expect(page.locator('#agent-discovery-progress .agent-progress-agent')).toHaveText(/^Codex: 1\. Surveyed the spec folders\.\n2\. Next I will .* before submitting it\.$/);
  expect(await page.locator('#agent-discovery-progress').evaluate(list => list.tagName + getComputedStyle(list).listStyleType)).toBe('ULnone');
  await expect(page.locator('#agent-discovery-status')).toContainText('The agent proposed 2 categories');
  await review.getByLabel('Include Tasks').uncheck();
  await page.locator('#agent-discovery-stage').click();
  await expect(page.locator('#agent-discovery-status')).toContainText('Added 1 category and the project-wide ID definition sites to the draft');
  await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.categories.map((c: { key: string }) => c.key)).toContain('requirements');
  expect(saved.categories.map((c: { key: string }) => c.key)).not.toContain('tasks');
  expect(saved.rules.map((r: { key: string }) => r.key)).toContain('fr');
  expect(saved.idDefinitionSites.lists.enabled).toBe(true);
  for (const [file, text] of Object.entries(PROJECT)) expect(await readFile(path.join(project, file), 'utf8')).toBe(text);
});

test('agent discovery proposes statuses, date rules, and gaps that are reviewed and staged separately', async () => {
  test.setTimeout(90000);
  await launch('statuses');
  await page.locator('#run-agent-discovery').click();
  await expect(page.locator('#agent-discovery-status')).toContainText('The agent proposed 2 categories and statuses and date rules', { timeout: 30000 });
  const review = page.locator('#agent-discovery-review'), statuses = review.locator('[data-category="statuses"]'), dates = review.locator('[data-category="dates"]');
  await expect(statuses.locator('h4')).toHaveText('Statuses');
  await expect(statuses.locator('.agent-discovery-current')).toHaveText('Current status sites: paragraphs starting "Status:"; table column "Status". Statuses: none (values are shown as written).');
  await expect(statuses.locator('.agent-discovery-proposed')).toHaveText('Proposed status sites: paragraphs starting "Status:"; table column "Status"; checkboxes ([x] Done, [ ] Open). Statuses: Open · #b45309; Done (exact "Done").');
  await expect(statuses.locator('.agent-discovery-counts')).toHaveText('3 status occurrences (checkboxes 3) · 3 mapped · 0 unmapped. Tasks: 3 with a status, 0 without, 0 in conflict.');
  await expect(statuses.locator('.agent-discovery-rationale')).toHaveText('Agent rationale (agent-generated): Tasks are tracked with checkboxes: [x] is Done and [ ] is Open.');
  await expect(dates.locator('.agent-discovery-proposed')).toHaveText('Proposed date rules: list-entry: list-entry, entry; created: field "Created", milestone.');
  await expect(dates.locator('.agent-discovery-counts')).toHaveText('Dates found: created 1. Enabled rules that find nothing: list-entry.');
  const gaps = review.locator('[data-category="gaps"]');
  await expect(gaps.locator('li')).toHaveText('Task priorities are written as [P] markers that no status site reads. (specs/001-login/tasks.md:3)');
  await gaps.getByRole('button', { name: 'Copy gaps' }).click();
  await expect(page.locator('#agent-discovery-status')).toHaveText('Gaps copied.');
  expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe('- Task priorities are written as [P] markers that no status site reads. (specs/001-login/tasks.md:3)');
  // Stage only the statuses and dates: the categories and ID definition sites stay as they are.
  for (const label of ['Include Functional requirements', 'Include Tasks', 'Include project-wide ID definition sites']) await review.getByLabel(label).uncheck();
  await page.locator('#agent-discovery-stage').click();
  await expect(page.locator('#agent-discovery-status')).toContainText('Added the statuses and the date rules to the draft');
  await page.locator('#config-preview').click(); await expect(page.locator('#config-status')).toContainText('Preview ready');
  await page.locator('#config-apply').click(); await expect(page.locator('#project-configuration-dialog')).not.toBeVisible();
  const saved = JSON.parse(await readFile(path.join(project, '.specular/project.json'), 'utf8'));
  expect(saved.statusSites.checkboxes).toEqual({ enabled: true, markers: { x: 'Done', ' ': 'Open' } });
  expect(saved.statuses.map((s: { name: string }) => s.name)).toEqual(['Open', 'Done']);
  expect(saved.dates.rules.map((r: { key: string }) => r.key)).toEqual(['list-entry', 'created']);
  expect(saved.categories.map((c: { key: string }) => c.key)).not.toContain('tasks');
  expect(saved.idDefinitionSites).toBeUndefined();
  for (const [file, text] of Object.entries(PROJECT)) expect(await readFile(path.join(project, file), 'utf8')).toBe(text);
});

test('the tool-call limit is validated, sent to the run, and stated to the agent', async () => {
  test.setTimeout(90000);
  const fixture = await launch('standard');
  const limit = page.getByLabel('Tool-call limit'), hint = page.locator('#agent-discovery-tool-calls-hint'), run = page.locator('#run-agent-discovery');
  await expect(limit).toHaveValue('80');
  // Agent, model, and limit share one row at the default window size.
  const tops = await Promise.all(['Agent', 'Agent model', 'Tool-call limit'].map(async label => (await page.getByLabel(label, { exact: true }).boundingBox())!.y));
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(4);
  await expect(hint).toHaveText('A run stops after 80 tool calls or 13 minutes. The agent is told its limit and warned near the end.');
  for (const value of ['300', '19', '', '25.5']) {
    await limit.fill(value);
    await expect(run).toBeDisabled(); await expect(hint).toHaveText('The tool-call limit must be a whole number from 20 to 200.');
  }
  await limit.fill('200'); await expect(hint).toContainText('200 tool calls or 30 minutes');
  await limit.fill('25'); await expect(run).toBeEnabled(); await expect(hint).toContainText('25 tool calls or 10 minutes');
  await run.click();
  await expect(page.locator('#agent-discovery-progress .agent-progress-tool').filter({ hasText: 'Evaluated draft' })).toHaveText('2/25 · Evaluated draft 1: 2 categories, 6 definitions, 0 duplicates', { timeout: 30000 });
  await expect(page.locator('#agent-discovery-status')).toContainText('The agent proposed 2 categories');
  await expect(limit).toBeEnabled(); await expect(limit).toHaveValue('25');
  const log = (await readFile(fixture.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  expect(log.find(entry => entry.method === 'thread/start').params.developerInstructions).toContain('this run allows 25 tool calls in total');
});

test('a run that uses a built-in tool stops without a proposal or changes', async () => {
  test.setTimeout(90000);
  await launch('violation');
  await page.locator('#run-agent-discovery').click();
  await expect(page.locator('#agent-discovery-status')).toContainText('Codex attempted a shell command', { timeout: 30000 });
  await expect(page.locator('#agent-discovery-status')).toContainText('No configuration was changed.');
  await expect(page.locator('#agent-discovery-review')).toBeEmpty();
  await expect(page.locator('#run-agent-discovery')).toBeEnabled();
  await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
});

test('Claude Code runs from the path in Agent setup and its proposal is reviewed the same way', async () => {
  test.setTimeout(90000);
  const fixture = await fakeClaude('standard');
  project = path.join(fixture.root, 'project');
  for (const [file, text] of Object.entries(PROJECT)) { await mkdir(path.dirname(path.join(project, file)), { recursive: true }); await writeFile(path.join(project, file), text); }
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key !== 'ELECTRON_RUN_AS_NODE' && value !== undefined)) as Record<string, string>;
  app = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(fixture.root, 'user-data') } });
  page = await app.firstWindow(); await expect(page.locator('#project-heading')).toHaveText('project');
  await page.locator('#show-agent-setup').click(); await page.locator('#claude-path').fill(fixture.executable); await page.locator('#agent-setup-close').click();
  await page.locator('#project-config-open').click();
  await page.getByLabel('Agent', { exact: true }).selectOption('claude');
  await page.getByLabel('Agent model').fill('sonnet');
  await page.locator('#run-agent-discovery').click();
  const review = page.locator('#agent-discovery-review');
  await expect(review.locator('[data-category="tasks"] h4')).toHaveText('Tasks · New', { timeout: 30000 });
  await expect(page.locator('#agent-discovery-progress .agent-progress-agent')).toHaveText('Claude Code: 1. Survey first.\n2. Then evaluate.');
  const invocation = JSON.parse(await readFile(fixture.invocation, 'utf8'));
  expect(invocation.args[invocation.args.indexOf('--model') + 1]).toBe('sonnet');
  await page.locator('#agent-discovery-stage').click();
  await expect(page.locator('#agent-discovery-status')).toContainText('Added 2 categories');
  await expect(access(path.join(project, '.specular/project.json'))).rejects.toThrow();
});
