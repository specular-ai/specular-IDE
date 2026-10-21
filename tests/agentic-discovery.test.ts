import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { connect } from 'node:net';
import path from 'node:path';
import { AgentToolbox, AGENT_INSTRUCTIONS, AGENT_TOOLS, CONFIGURATION_GUIDE, globRegex, proposedConfiguration, type AgentToolSnapshot } from '../src/core/agent-tools';
import { categoryChange, datesChanged, sitesChanged, stageAgentProposal, statusesChanged } from '../src/core/agent-proposal';
import { LEGACY_ID_CONFIGURATION, validateIdConfiguration } from '../src/core/id-configuration';
import { McpBridge, mcpResponse } from '../src/core/mcp-server';
import { AGENT_PROMPT, budgetInstructions, DiscoveryRun, runLimits, toolCallLimitError } from '../src/core/discovery-run';
import { CodexConnection } from '../src/core/codex-connection';
import { CodexDiscoveryAdapter } from '../src/core/codex-discovery';
import { ClaudeDiscoveryAdapter, CLAUDE_TOOL_PREFIX, initProblem } from '../src/core/claude-discovery';
import { fakeClaude, fakeCodex, FIRST_STATUS_DRAFT, GOOD_DRAFT, McpClient, PROJECT, proxyLaunch, RATIONALE, scriptedAdapter, SECOND_STATUS_DRAFT, SNAPSHOT, standardScript, STATUS_EXTRA, STATUS_PROJECT, STATUS_SNAPSHOT, toolHost, type AgentScript } from './helpers/agent-discovery-fixtures';

const toolbox = () => new AgentToolbox(structuredClone(SNAPSHOT));

test('tools read only the snapshot\'s Markdown, with bounded, paged output', () => {
  const box = toolbox();
  const overview = box.call('project_overview', {});
  assert.equal(overview.ok, true); assert.equal((overview.value as any).files, 5);
  assert.ok((overview.value as any).folders.some((folder: any) => folder.path === 'specs/001-login' && folder.files === 2));
  for (const path of ['../outside.md', 'C:/Windows/win.ini', 'package.json', '.specular/project.json', 'specs']) {
    const result = box.call('read_markdown', { path });
    assert.equal(result.ok, false, path); assert.match(result.message!, /not an indexable Markdown file/);
  }
  const read = box.call('read_markdown', { path: 'specs/001-login/tasks.md', startLine: 3, endLine: 3 });
  assert.deepEqual([(read.value as any).startLine, (read.value as any).endLine, (read.value as any).text], [3, 3, '- [ ] T001 Implement sign-in (FR-001)\n']);
  const listed = box.call('list_markdown', { glob: 'specs/**/tasks.md', limit: 1 });
  assert.deepEqual([(listed.value as any).total, (listed.value as any).nextOffset], [2, 1]);
  assert.ok(globRegex('specs/*/spec.md').test('specs/001-login/spec.md')); assert.ok(!globRegex('specs/*.md').test('specs/001-login/spec.md'));
});

test('search counts code and HTML matches separately and rejects unusable patterns', () => {
  const box = toolbox();
  const found = box.call('search_markdown', { pattern: '\\bFR-\\d{3}\\b' }).value as any;
  assert.equal(found.totalMatches, 7); assert.equal(found.ignoredMatches, 1); assert.equal(found.examples[0].line > 0, true);
  for (const pattern of ['', '(', 'a*', 'x'.repeat(513)]) assert.equal(box.call('search_markdown', { pattern }).ok, false, pattern);
});

test('evaluation measures categories with the Preview analyzer and pages their matches', () => {
  const box = toolbox();
  const result = box.call('evaluate_configuration', { configuration: GOOD_DRAFT }).value as any;
  assert.equal(result.valid, true);
  const requirements = result.categories.find((c: any) => c.key === 'requirements'), tasks = result.categories.find((c: any) => c.key === 'tasks');
  // FR-001 is defined in both folders; FR-003 is cited but never defined.
  assert.deepEqual([requirements.definitions, requirements.distinctIds, requirements.duplicates, requirements.unresolved], [3, 4, 0, 1]);
  assert.equal(tasks.definitions, 3);
  const example = requirements.examples[0];
  assert.equal(PROJECT[example.path].slice(example.offset, example.end), example.id);
  const page = box.call('list_matches', { evaluationId: result.evaluationId, category: 'requirements', kind: 'unresolved' }).value as any;
  assert.deepEqual(page.matches.map((m: any) => m.id), ['FR-003']);
  assert.equal(box.call('list_matches', { evaluationId: 'e99', category: 'requirements' }).ok, false);
  const invalid = box.call('evaluate_configuration', { configuration: { categories: [{ key: 'x', name: 'X' }], rules: [{ key: 'r', category: 'missing', prefix: 'X' }] } });
  assert.equal(invalid.ok, false); assert.equal((invalid.value as any).valid, false);
});

test('each evaluation analyzes the project with its own draft, not a cached earlier one', () => {
  const box = toolbox();
  const counts = (configuration: unknown) => {
    const result = box.call('evaluate_configuration', { configuration }).value as any;
    const requirements = result.categories.find((c: any) => c.key === 'requirements');
    return [requirements.definitions, requirements.references, requirements.duplicates];
  };
  assert.deepEqual(counts(GOOD_DRAFT), [3, 4, 0]);
  // Without list definition sites, the FR bullets become references.
  assert.deepEqual(counts({ ...GOOD_DRAFT, idDefinitionSites: { ...GOOD_DRAFT.idDefinitionSites, lists: { enabled: false, types: ['unordered', 'ordered'], mode: 'start' } } }), [0, 7, 0]);
  // Without folder scopes, both FR-001 definitions are duplicates.
  assert.deepEqual(counts({ ...GOOD_DRAFT, categories: GOOD_DRAFT.categories.map(({ idScopes, ...category }) => category) })[2], 2);
  assert.deepEqual(counts(GOOD_DRAFT), [3, 4, 0]);
});

test('submissions need a valid, evaluated configuration and a rationale per category', () => {
  const box = toolbox();
  assert.equal(box.call('submit_proposal', { configuration: GOOD_DRAFT, rationale: { requirements: 'x' } }).ok, false);
  assert.equal(box.call('submit_proposal', { configuration: GOOD_DRAFT, rationale: { ...RATIONALE, other: 'x' } }).ok, false);
  assert.equal(box.call('submit_proposal', { configuration: { categories: [] }, rationale: {} }).ok, false);
  assert.equal(box.proposal, undefined);
  assert.equal(box.call('submit_proposal', { configuration: GOOD_DRAFT, rationale: RATIONALE, summary: 'ok' }).ok, true);
  assert.deepEqual(box.proposal!.configuration.categories.map(c => c.key), ['requirements', 'tasks']);
  assert.equal(box.proposal!.evaluation.categories[0].definitions, 3);
  assert.deepEqual(box.proposal!.gaps, []); assert.equal(box.proposal!.statusRationale, undefined);
  // Only recognition, status, and date fields come from the draft (87); an omitted status or date field keeps the current value, and null restores the default.
  const base = { ...structuredClone(SNAPSHOT.configuration), statuses: [{ name: 'Done' }], modules: [{ key: 'core', name: 'Core' }] } as any;
  assert.deepEqual(proposedConfiguration(base, GOOD_DRAFT).statuses, base.statuses);
  assert.deepEqual(proposedConfiguration(base, { ...GOOD_DRAFT, statuses: [{ name: 'Open' }] }).statuses, [{ name: 'Open' }]);
  assert.equal(proposedConfiguration(base, { ...GOOD_DRAFT, statuses: null }).statuses, undefined);
  assert.deepEqual(proposedConfiguration(base, { ...GOOD_DRAFT, modules: [] }).modules, base.modules);
});

const statusBox = () => new AgentToolbox(structuredClone(STATUS_SNAPSHOT));
test('evaluation measures statuses per site and category, maps values, and pages unmapped and missing statuses', () => {
  const box = statusBox();
  const first = box.call('evaluate_configuration', { configuration: FIRST_STATUS_DRAFT }).value as any;
  assert.equal(first.valid, true, JSON.stringify(first));
  // Three status paragraphs under FR headings and three checkbox markers; the decorated Spec Kit values map to nothing yet.
  assert.deepEqual([first.statuses.occurrences, first.statuses.sites, first.statuses.mapped, first.statuses.unmapped], [6, { paragraphs: 3, checkboxes: 3 }, 3, 3]);
  assert.deepEqual(first.statuses.categories.map((c: any) => [c.key, c.withStatus, c.withoutStatus, c.conflicts]), [['requirements', 3, 0, 0], ['tasks', 3, 1, 0]]);
  const planned = first.statuses.values.find((v: any) => v.value === '🔜 Planned');
  assert.deepEqual([planned.count, planned.status, planned.example.path, planned.example.line], [1, undefined, 'specs/001-login/spec.md', 5]);
  assert.equal(first.statuses.values.find((v: any) => v.value === 'Done').status, 'Done');
  const unmapped = box.call('list_matches', { evaluationId: first.evaluationId, category: 'requirements', kind: 'unmapped' }).value as any;
  assert.deepEqual(unmapped.matches.map((m: any) => [m.id, m.value, m.site, m.status.line]), [['FR-001', '🔜 Planned', 'paragraphs', 5], ['FR-002', '✅ Complete', 'paragraphs', 9], ['FR-003', 'Draft', 'paragraphs', 13]]);
  assert.deepEqual((box.call('list_matches', { evaluationId: first.evaluationId, category: 'tasks', kind: 'without-status' }).value as any).matches.map((m: any) => m.id), ['T004']);
  // The defaults find both changelogs' entries, and several default rules find nothing.
  assert.equal(first.dates.rules.find((r: any) => r.key === 'list-entry').dates, 2);
  assert.ok(['status-date', 'heading', 'ratified', 'date'].every(key => first.dates.emptyRules.includes(key)), first.dates.emptyRules.join());
  // The second draft maps every value, keeps only useful date rules, and excludes the vendored changelog.
  const second = box.call('evaluate_configuration', { configuration: SECOND_STATUS_DRAFT }).value as any;
  assert.deepEqual([second.statuses.mapped, second.statuses.unmapped, second.statuses.unusedStatuses], [6, 0, []]);
  assert.equal(second.statuses.values.find((v: any) => v.value === '✅ Complete').status, 'Done');
  assert.deepEqual(second.dates.rules.map((r: any) => [r.key, r.dates]), [['list-entry', 1], ['created', 1], ['last-updated', 0]]);
  assert.deepEqual([second.dates.emptyRules, second.dates.exclusions], [['last-updated'], [{ path: 'vendor', files: 1 }]]);
  const created = (box.call('list_matches', { evaluationId: second.evaluationId, dateRule: 'created' }).value as any).matches;
  assert.deepEqual(created.map((m: any) => [m.path, m.line, m.date, STATUS_PROJECT[m.path].slice(m.offset, m.end)]), [['specs/001-login/spec.md', 15, '2026-01-05', '2026-01-05']]);
  assert.equal(box.call('list_matches', { evaluationId: second.evaluationId, dateRule: 'missing' }).ok, false);
  assert.equal(box.call('list_matches', { evaluationId: second.evaluationId }).ok, false);
});

test('ambiguous status mappings and invalid status or date settings are rejected', () => {
  const box = statusBox();
  const ambiguous = box.call('evaluate_configuration', { configuration: { ...FIRST_STATUS_DRAFT, statuses: [{ name: 'Planned', rules: [{ mode: 'regex', value: 'Planned' }] }, { name: 'Soon', rules: [{ mode: 'startsWith', value: '🔜' }] }] } });
  assert.equal(ambiguous.ok, false); assert.match(ambiguous.message!, /Ambiguous status mapping for "🔜 Planned": Planned, Soon/);
  for (const configuration of [
    { ...GOOD_DRAFT, statusSites: { paragraphs: { enabled: true } } },
    { ...GOOD_DRAFT, statusSites: { ...FIRST_STATUS_DRAFT.statusSites, checkboxes: { enabled: true, markers: { xx: 'Done' } } } },
    { ...GOOD_DRAFT, statuses: [{ name: 'Done', colors: { light: 'green' } }] },
    { ...GOOD_DRAFT, dates: { rules: [{ key: 'Created', site: 'field', label: 'Created' }] } },
    { ...GOOD_DRAFT, dates: { rules: [{ key: 'created', site: 'field' }] } },
    { ...GOOD_DRAFT, dates: { rules: [], exclude: ['../outside'] } },
  ]) {
    const result = box.call('evaluate_configuration', { configuration });
    assert.equal(result.ok, false, JSON.stringify(configuration)); assert.equal((result.value as any).valid, false);
  }
});

test('submissions that change statuses or dates need their rationale, and gaps need examples in the project', () => {
  const box = statusBox(), submit = (extra: Record<string, unknown>) => box.call('submit_proposal', { configuration: SECOND_STATUS_DRAFT, rationale: RATIONALE, ...extra });
  assert.match(submit({ dateRationale: 'x' }).message!, /changes the status settings; give a statusRationale/);
  assert.match(submit({ statusRationale: 'x' }).message!, /changes the date settings; give a dateRationale/);
  const reasons = { statusRationale: 'Spec Kit status fields and Kiro checkboxes.', dateRationale: 'Created fields and changelog entries.' };
  assert.match(submit({ ...reasons, gaps: [{ description: 'x', examples: [{ path: '../secret.md', line: 1 }] }] }).message!, /not an indexable Markdown file/);
  assert.match(submit({ ...reasons, gaps: [{ description: 'x', examples: [{ path: 'CHANGELOG.md', line: 99 }] }] }).message!, /line 99 is not in CHANGELOG\.md/);
  assert.match(submit({ ...reasons, gaps: [{ examples: [] }] }).message!, /Gap 1 needs a description/);
  assert.match(submit({ ...reasons, gaps: Array.from({ length: 21 }, () => ({ description: 'x' })) }).message!, /at most 20 entries/);
  assert.equal(box.proposal, undefined);
  const accepted = submit({ ...reasons, gaps: [{ description: 'Priorities in task text.', examples: [{ path: 'specs/001-login/tasks.md', line: 3 }] }] });
  assert.equal(accepted.ok, true, accepted.message); assert.equal(accepted.summary, 'Submitted a proposal with 2 categories, statuses, dates, 1 gap');
  assert.deepEqual([box.proposal!.statusRationale, box.proposal!.dateRationale, box.proposal!.gaps], [reasons.statusRationale, reasons.dateRationale, [{ description: 'Priorities in task text.', examples: [{ path: 'specs/001-login/tasks.md', line: 3 }] }]]);
  assert.equal(box.proposal!.evaluation.statuses.unmapped, 0);
  // A draft without status or date fields needs neither rationale.
  const ids = statusBox(); assert.equal(ids.call('submit_proposal', { configuration: GOOD_DRAFT, rationale: RATIONALE }).ok, true);
  assert.deepEqual([ids.proposal!.statusRationale, ids.proposal!.dateRationale], [undefined, undefined]);
});

test('staging includes statuses and dates as wholes, independently of the categories', () => {
  const draft = validateIdConfiguration({ version: 1, categories: [{ key: 'requirements', name: 'Requirements' }], rules: [{ key: 'req', category: 'requirements', prefix: 'REQ' }], statuses: [{ name: 'Old' }], dates: { rules: [], exclude: ['docs'] } });
  const proposed = proposedConfiguration(draft, SECOND_STATUS_DRAFT);
  assert.deepEqual([statusesChanged(draft, proposed), datesChanged(draft, proposed), statusesChanged(draft, proposedConfiguration(draft, GOOD_DRAFT))], [true, true, false]);
  const statuses = stageAgentProposal(draft, proposed, [], false, { statuses: true });
  assert.deepEqual([statuses.categories, statuses.rules, statuses.dates], [draft.categories, draft.rules, draft.dates]);
  assert.deepEqual(statuses.statuses!.map(s => s.name), ['Planned', 'Open', 'In progress', 'Done', 'Draft']); assert.equal(statuses.statusSites!.checkboxes!.enabled, true);
  const dates = stageAgentProposal(draft, proposed, ['requirements'], false, { dates: true });
  assert.deepEqual([dates.statuses, dates.dates!.exclude, dates.categories[0].name], [draft.statuses, ['vendor'], 'Functional requirements']);
  // Restoring the default removes the field.
  const cleared = stageAgentProposal(draft, proposedConfiguration(draft, { ...GOOD_DRAFT, statuses: null, dates: null }), [], false, { statuses: true, dates: true });
  assert.deepEqual([cleared.statuses, cleared.dates], [undefined, undefined]);
});

test('the instructions and schema guide cover statuses, dates, gaps, and the 86 live-run refinements', () => {
  for (const text of [/Statuses and dates:/, /Before submitting, even when the draft measures well, list the kinds of documents you have not read/, /Gaps are conventions the configuration cannot express/]) assert.match(AGENT_INSTRUCTIONS, text);
  for (const text of [/STATUS SITES/, /"checkboxes"/, /STATUSES:/, /DATES:/, /bare numbered checklist tasks/, /null restores the default/]) assert.match(CONFIGURATION_GUIDE, text);
  assert.match(AGENT_PROMPT, /statuses and dates/);
});

test('the MCP protocol lists read-only tools and reports tool errors as results', async () => {
  const call = async (name: string, args: unknown) => toolbox().call(name, args);
  const init = await mcpResponse({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, call) as any;
  assert.equal(init.result.protocolVersion, '2025-06-18'); assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
  const list = await mcpResponse({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, call) as any;
  assert.deepEqual(list.result.tools.map((t: any) => t.name), AGENT_TOOLS.map(t => t.name));
  assert.ok(list.result.tools.every((t: any) => t.annotations.readOnlyHint === true));
  const failed = await mcpResponse({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_markdown', arguments: { path: '../x.md' } } }, call) as any;
  assert.equal(failed.result.isError, true);
  assert.equal((await mcpResponse({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'shell' } }, call) as any).error.code, -32602);
  assert.equal((await mcpResponse({ jsonrpc: '2.0', id: 5, method: 'resources/list' }, call) as any).error.code, -32601);
  assert.equal(await mcpResponse({ jsonrpc: '2.0', method: 'notifications/initialized' }, call), undefined);
});

test('the pipe rejects connections without the run token', async () => {
  const reasons: string[] = [];
  const bridge = new McpBridge(async (name, args) => toolbox().call(name, args), reason => reasons.push(reason));
  await bridge.start();
  try {
    const closed = await new Promise<string>(resolve => {
      const socket = connect(bridge.path, () => socket.write(JSON.stringify({ token: 'f'.repeat(64) }) + '\n' + JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) + '\n'));
      let data = ''; socket.on('data', chunk => { data += chunk; }); socket.on('close', () => resolve(data)); socket.on('error', () => undefined);
    });
    assert.equal(closed, ''); assert.match(reasons[0], /invalid run token/);
    const client = McpClient.start({ ...(await proxyLaunch()), env: { SPECULAR_MCP_PIPE: bridge.path, SPECULAR_RUN_TOKEN: bridge.token } });
    assert.equal((await client.initialize()).result.serverInfo.name, 'specular');
    assert.equal((await client.tool('project_overview')).value.files, 5);
    client.stop(); await client.closed;
    const missing = McpClient.start({ ...(await proxyLaunch()), env: { SPECULAR_MCP_PIPE: bridge.path } });
    assert.equal(await missing.closed, 2);
  } finally { await bridge.stop(); }
});

test('the tool worker stops a slow regex and recovers for the next call', async () => {
  const host = await toolHost({ documents: { 'a.md': 'a'.repeat(40) + '!' }, configuration: SNAPSHOT.configuration }, 1000);
  try {
    const slow = await host.call('search_markdown', { pattern: '(a+)+$' });
    assert.equal(slow.result.ok, false); assert.match(slow.result.message!, /exceeded 1 seconds/);
    assert.equal((await host.call('project_overview', {})).result.ok, true);
  } finally { await host.dispose(); }
});

async function runWith(script: AgentScript, options: { toolCalls?: number; wallMs?: number; snapshot?: AgentToolSnapshot; followUp?: Parameters<typeof scriptedAdapter>[1] } = {}) {
  const progress: string[] = [], adapter = scriptedAdapter(script, options.followUp);
  const run = new DiscoveryRun({ adapter, host: await toolHost(structuredClone(options.snapshot ?? SNAPSHOT)), proxy: await proxyLaunch(), progress: m => progress.push(m),
    limits: { wallMs: options.wallMs ?? 60_000, toolCalls: options.toolCalls ?? 60, callMs: 20_000 } });
  const result = await run.start(); await run.stopped();
  return { result, progress, adapter };
}

test('a scripted agent surveys, evaluates two drafts, and submits a proposal that ends the run', async () => {
  const { result, progress, adapter } = await runWith(standardScript);
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.proposal!.configuration.categories.map(c => c.name), ['Functional requirements', 'Tasks']);
  assert.equal(result.proposal!.rationale.tasks, RATIONALE.tasks); assert.equal(result.proposal!.summary, 'Spec Kit requirements and tasks.');
  assert.equal(result.toolCalls, 7);
  assert.ok(progress.some(m => /^5\/60 · Evaluated draft 2: 2 categories/.test(m)), progress.join('\n'));
  assert.ok(progress.some(m => /Submitted a proposal: rejected/.test(m)));
  // The agent process was stopped when the proposal arrived.
  assert.notEqual(adapter.clients[0].child.exitCode ?? adapter.clients[0].child.signalCode, null);
});

test('a scripted agent completes its statuses from the unmapped-value report and submits statuses, dates, and gaps', async () => {
  const unmapped: string[][] = [];
  const { result, progress } = await runWith(async client => {
    await client.tool('project_overview');
    const first = await client.tool('evaluate_configuration', { configuration: FIRST_STATUS_DRAFT });
    unmapped.push(first.value.statuses.values.filter((v: any) => !v.status).map((v: any) => v.value));
    await client.tool('list_matches', { evaluationId: first.value.evaluationId, category: 'requirements', kind: 'unmapped' });
    const second = await client.tool('evaluate_configuration', { configuration: SECOND_STATUS_DRAFT });
    unmapped.push(second.value.statuses.values.filter((v: any) => !v.status).map((v: any) => v.value));
    await client.tool('submit_proposal', { configuration: SECOND_STATUS_DRAFT, rationale: RATIONALE, ...STATUS_EXTRA, gaps: [{ description: 'Task T004 has no checkbox.', examples: [{ path: 'specs/001-login/tasks.md', line: 6 }] }] });
    await new Promise(resolve => setTimeout(resolve, 5000));
  }, { snapshot: STATUS_SNAPSHOT });
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(unmapped, [['✅ Complete', '🔜 Planned', 'Draft'], []]);
  assert.match(result.message, /^The agent proposed 2 categories and statuses and date rules after 5 tool calls\./);
  assert.deepEqual(result.proposal!.configuration.statuses!.map(s => s.name), ['Planned', 'Open', 'In progress', 'Done', 'Draft']);
  assert.equal(result.proposal!.gaps[0].description, 'Task T004 has no checkbox.');
  assert.ok(progress.includes('5/60 · Submitted a proposal with 2 categories, statuses, dates, 1 gap'), progress.join('\n'));
});

test('runs without a valid proposal end with a clear message', async () => {
  const noSubmit = await runWith(async client => { await client.tool('project_overview'); });
  assert.equal(noSubmit.result.ok, false); assert.match(noSubmit.result.message, /finished without submitting a proposal\. No configuration was changed\./);
  const limited = await runWith(async client => { for (let i = 0; i < 5; i++) await client.tool('project_overview'); }, { toolCalls: 3 });
  assert.equal(limited.result.ok, false); assert.match(limited.result.message, /exceeded 3 tool calls/);
  const slow = await runWith(async () => { await new Promise(resolve => setTimeout(resolve, 5000)); }, { wallMs: 500 });
  assert.equal(slow.result.ok, false); assert.match(slow.result.message, /exceeded 0 minutes|exceeded/);
  const violation = await runWith(async (client, run) => { await client.tool('project_overview'); run.violation('the agent ran a shell command.'); });
  assert.equal(violation.result.ok, false); assert.match(violation.result.message, /Stopped: the agent ran a shell command/);
});

test('run limits follow the chosen tool-call limit, and invalid limits are rejected', () => {
  assert.deepEqual([runLimits().toolCalls, runLimits().wallMs], [80, 800_000]);
  assert.deepEqual([runLimits(20).wallMs, runLimits(90).wallMs, runLimits(200).wallMs], [10 * 60_000, 15 * 60_000, 30 * 60_000]);
  for (const value of [20, 60, 200]) assert.equal(toolCallLimitError(value), undefined);
  for (const value of [19, 201, 60.5, '60', NaN, null]) assert.match(toolCallLimitError(value)!, /whole number from 20 to 200/);
  assert.match(budgetInstructions(runLimits(90)), /allows 90 tool calls in total/);
});

test('the agent is told its budget, warned near the limit, and may still submit after it', async () => {
  const notices: (string | undefined)[] = []; let instructions = '', prompt = '';
  const { result, progress } = await runWith(async (client, run) => {
    instructions = run.instructions; prompt = run.prompt;
    for (let i = 0; i < 8; i++) notices.push((await client.tool('project_overview')).notice);
    const rejected = await client.tool('submit_proposal', { configuration: GOOD_DRAFT, rationale: { requirements: 'Only one.' } });
    if (!rejected.isError) throw new Error('Expected the incomplete rationale to be rejected.');
    notices.push(rejected.notice);
    await client.tool('submit_proposal', { configuration: GOOD_DRAFT, rationale: RATIONALE });
    await new Promise(resolve => setTimeout(resolve, 5000));
  }, { toolCalls: 8 });
  assert.equal(result.ok, true, result.message);
  assert.match(instructions, /allows 8 tool calls in total, submit_proposal included/); assert.match(instructions, /when 2 or fewer calls remain/);
  assert.match(prompt, /You have 8 tool calls\./);
  // A quarter of 8 calls: the warning starts with 2 calls remaining.
  assert.deepEqual(notices.slice(0, 5), [undefined, undefined, undefined, undefined, undefined]);
  assert.equal(notices[5], '[Specular: 2 of 8 tool calls remain. Stop surveying and submit your best evaluated draft with submit_proposal.]');
  assert.match(notices[6]!, /1 of 8 tool calls remains\. Your next call should be submit_proposal/);
  assert.match(notices[7]!, /the 8 tool calls are used\. Only submit_proposal is accepted now, at most 2 more times/);
  assert.match(notices[8]!, /at most 1 more times/);
  assert.equal(progress.filter(m => m.startsWith('Warned the agent')).length, 1);
  assert.ok(progress.includes('Warned the agent: 2 tool calls remain.'), progress.join('\n'));
  assert.ok(progress.some(m => m.startsWith('8+1/8+2 · ')) && progress.some(m => m.startsWith('8+2/8+2 · Submitted a proposal')), progress.join('\n'));
});

test('after the tool-call limit, other tools and a third submission end the run', async () => {
  const other = await runWith(async client => {
    for (let i = 0; i < 4; i++) await client.tool('project_overview');
    await client.tool('project_overview');
  }, { toolCalls: 4 });
  assert.equal(other.result.ok, false); assert.match(other.result.message, /exceeded 4 tool calls without submitting a proposal\. No configuration was changed\./);
  const third = await runWith(async client => {
    for (let i = 0; i < 4; i++) await client.tool('project_overview');
    for (let i = 0; i < 3; i++) await client.tool('submit_proposal', { configuration: GOOD_DRAFT, rationale: {} });
  }, { toolCalls: 4 });
  assert.equal(third.result.ok, false); assert.match(third.result.message, /exceeded 4 tool calls/);
  assert.equal(third.result.toolCalls, 7);
});

test('cancelling a run stops the agent and its tools', async () => {
  const adapter = scriptedAdapter(async client => { await client.tool('project_overview'); await new Promise(resolve => setTimeout(resolve, 10_000)); });
  const run = new DiscoveryRun({ adapter, host: await toolHost(structuredClone(SNAPSHOT)), proxy: await proxyLaunch(), progress: () => {} });
  const pending = run.start();
  while (!adapter.clients.length) await new Promise(resolve => setTimeout(resolve, 20));
  await new Promise(resolve => setTimeout(resolve, 1500));
  await run.cancel();
  const result = await pending;
  assert.equal(result.ok, false); assert.match(result.message, /Discovery cancelled\. No configuration was changed\./);
  await adapter.clients[0].closed;
});

async function codexRun(scenario: Parameters<typeof fakeCodex>[0]) {
  const fixture = await fakeCodex(scenario);
  const userData = path.join(fixture.root, 'user-data'); await mkdir(userData, { recursive: true });
  const connection = new CodexConnection(userData, () => {});
  assert.equal((await connection.connect(fixture.executable, 'sk-test')).status, 'connected');
  const progress: string[] = [];
  const run = new DiscoveryRun({ adapter: new CodexDiscoveryAdapter(connection, { stopMs: 3000 }), host: await toolHost(structuredClone(SNAPSHOT)), proxy: await proxyLaunch(), model: 'fixture-model', progress: (m, kind) => progress.push(`${kind ?? 'status'}: ${m}`) });
  try {
    const result = await run.start(); await run.stopped();
    const log = (await readFile(fixture.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    return { result, progress, log };
  } finally { await connection.disconnect(); }
}

test('Codex discovery runs on a read-only thread whose only tools are the Specular MCP server', async () => {
  const { result, progress, log } = await codexRun('standard');
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.proposal!.configuration.rules.map(r => r.key), ['fr', 't']);
  const start = log.find(entry => entry.method === 'thread/start').params;
  assert.deepEqual([start.sandbox, start.approvalPolicy, start.ephemeral, start.model], ['read-only', 'never', true, 'fixture-model']);
  assert.deepEqual(Object.keys(start.config.mcp_servers), ['specular']);
  assert.equal(start.config.features.shell_tool, false); assert.equal(start.config.features.unified_exec, false);
  assert.match(start.developerInstructions, /only use the Specular tools/);
  assert.match(start.developerInstructions, /allows 80 tool calls in total/); assert.match(log.find(entry => entry.method === 'turn/start').params.input[0].text, /You have 80 tool calls/);
  assert.equal(path.basename(start.cwd), 'workspace', 'the thread works in Specular\'s empty runtime workspace, not the project');
  assert.ok(log.some(entry => entry.method === 'turn/interrupt'), 'the turn is interrupted after the submission');
  assert.ok(progress.includes('tool: 3/80 · Submitted a proposal with 2 categories'), progress.join('\n'));
  // The agent's commentary is reported separately and in full, so its own numbering does not mix with tool calls.
  assert.ok(progress.includes('agent: 1. Surveyed the spec folders.\n2. Next I will evaluate a draft with FR and T rules, then check its matches for codes that are not records before submitting it.'), progress.join('\n'));
});

test('the fake Codex and Claude Code agents propose a checkbox site, statuses, date rules, and a gap', async () => {
  for (const { result, progress } of [await codexRun('statuses'), await claudeRun('statuses')]) {
    assert.equal(result.ok, true, result.message);
    const { configuration, evaluation, gaps } = result.proposal!;
    assert.deepEqual([configuration.statusSites!.checkboxes, configuration.statuses!.map(s => s.name), configuration.dates!.rules.map(r => r.key)], [{ enabled: true, markers: { x: 'Done', ' ': 'Open' } }, ['Open', 'Done'], ['list-entry', 'created']]);
    // T001 and T001 are open in their folders and T002 is done; the README's Created field is the only dated field.
    assert.deepEqual([evaluation.statuses.sites, evaluation.statuses.mapped, evaluation.dates.rules.map(r => r.dates)], [{ checkboxes: 3 }, 3, [0, 1]]);
    assert.deepEqual([result.proposal!.statusRationale, gaps.length], [STATUS_EXTRA.statusRationale, 1]);
    assert.ok(progress.includes('tool: 3/80 · Submitted a proposal with 2 categories, statuses, dates, 1 gap'), progress.join('\n'));
  }
});

test('Codex discovery stops on built-in tools, other MCP servers, and missing submissions', async () => {
  const violation = await codexRun('violation');
  assert.equal(violation.result.ok, false); assert.match(violation.result.message, /Codex attempted a shell command/);
  assert.equal(violation.result.proposal, undefined);
  const extra = await codexRun('extra-server');
  assert.equal(extra.result.ok, false); assert.match(extra.result.message, /unexpected MCP servers \(specular, other\)/);
  assert.ok(!extra.log.some(entry => entry.method === 'turn/start'));
  const silent = await codexRun('no-submit');
  assert.equal(silent.result.ok, false); assert.match(silent.result.message, /finished without submitting a proposal/);
});

test('staging adds or replaces selected categories with their rules and keeps the rest of the draft', () => {
  const draft = validateIdConfiguration({ version: 1, categories: [{ key: 'requirements', name: 'Requirements' }, { key: 'decisions', name: 'Decisions' }], rules: [{ key: 'fr', category: 'decisions', prefix: 'DEC' }, { key: 'req', category: 'requirements', prefix: 'REQ' }], statuses: [{ name: 'Done' }] });
  const proposed = proposedConfiguration(draft, GOOD_DRAFT);
  assert.deepEqual(['requirements', 'tasks'].map(key => categoryChange(draft, proposed, key)), ['changed', 'new']);
  assert.equal(categoryChange(proposed, proposed, 'tasks'), 'unchanged'); assert.equal(sitesChanged(draft, proposed), true);
  const staged = stageAgentProposal(draft, proposed, ['requirements'], false);
  assert.deepEqual(staged.categories.map(c => [c.key, c.name]), [['requirements', 'Functional requirements'], ['decisions', 'Decisions']]);
  // The proposal's rule key collides with a kept rule of another category, so it is renamed.
  assert.deepEqual(staged.rules.map(r => [r.key, r.category]), [['fr', 'decisions'], ['fr-2', 'requirements']]);
  assert.equal(staged.idDefinitionSites, undefined); assert.deepEqual(staged.statuses, draft.statuses);
  assert.deepEqual(stageAgentProposal(draft, proposed, [], true).idDefinitionSites, GOOD_DRAFT.idDefinitionSites);
  const nested = proposedConfiguration(draft, { categories: [{ key: 'requirement', name: 'Requirement', idDefinitionSites: { headings: { enabled: true, levels: [3], mode: 'keyword', keyword: 'Requirement' }, tables: { enabled: false, column: 'ID', mode: 'exact' } } }, { key: 'scenario', name: 'Scenario', parent: 'requirement', idDefinitionSites: { headings: { enabled: true, levels: [4], mode: 'keyword', keyword: 'Scenario' }, tables: { enabled: false, column: 'ID', mode: 'exact' } } }], rules: [] });
  assert.throws(() => stageAgentProposal(draft, nested, ['scenario'], false), /Scenario refers to Requirement\. Select Requirement too\./);
  assert.deepEqual(stageAgentProposal(draft, nested, ['scenario', 'requirement'], false).categories.map(c => c.key), ['requirements', 'decisions', 'requirement', 'scenario']);
});

async function claudeRun(scenario: Parameters<typeof fakeClaude>[0]) {
  const fixture = await fakeClaude(scenario), progress: string[] = [];
  const runRoot = path.join(fixture.root, 'runs');
  const run = new DiscoveryRun({ adapter: new ClaudeDiscoveryAdapter({ executable: fixture.executable, runRoot }), host: await toolHost(structuredClone(SNAPSHOT)), proxy: await proxyLaunch(), model: 'sonnet', progress: (m, kind) => progress.push(`${kind ?? 'status'}: ${m}`) });
  const result = await run.start(); await run.stopped();
  let invocation: any; try { invocation = JSON.parse(await readFile(fixture.invocation, 'utf8')); } catch { invocation = undefined; }
  return { result, progress, invocation, runRoot };
}

test('Claude Code discovery runs headless with only the Specular MCP tools and no settings', async () => {
  const { result, progress, invocation, runRoot } = await claudeRun('standard');
  assert.equal(result.ok, true, result.message);
  assert.deepEqual(result.proposal!.configuration.categories.map(c => c.key), ['requirements', 'tasks']);
  const args: string[] = invocation.args, value = (flag: string) => args[args.indexOf(flag) + 1];
  assert.deepEqual([value('--tools'), value('--permission-mode'), value('--permission-prompts'), value('--setting-sources'), value('--allowedTools'), value('--input-format'), value('--output-format'), value('--model')], ['', 'dontAsk', 'none', '', 'mcp__specular', 'stream-json', 'stream-json', 'sonnet']);
  for (const flag of ['-p', '--strict-mcp-config', '--restricted', '--no-session-persistence', '--disable-slash-commands']) assert.ok(args.includes(flag), flag);
  assert.deepEqual(invocation.cwdEntries, [], 'Claude Code works in an empty directory, not the project');
  assert.match(invocation.systemPrompt, /only use the Specular tools/); assert.match(invocation.prompt, /submit_proposal/);
  assert.match(invocation.systemPrompt, /allows 80 tool calls in total/); assert.match(invocation.prompt, /You have 80 tool calls/);
  assert.ok(progress.includes('agent: 1. Survey first.\n2. Then evaluate.'), progress.join('\n'));
  assert.ok(progress.includes('tool: 3/80 · Submitted a proposal with 2 categories'), progress.join('\n'));
  assert.deepEqual(await readdir(runRoot), [], 'the run directory with its MCP configuration is removed');
});

test('Claude Code discovery stops on other tools and reports sign-in and missing submissions', async () => {
  const extra = await claudeRun('extra-tool');
  assert.equal(extra.result.ok, false); assert.match(extra.result.message, /Claude Code offered other tools \(Bash\)/);
  const violation = await claudeRun('violation');
  assert.equal(violation.result.ok, false); assert.match(violation.result.message, /Claude Code attempted the tool "Bash"/);
  const signedOut = await claudeRun('signed-out');
  assert.equal(signedOut.result.ok, false); assert.match(signedOut.result.message, /Claude Code stopped: Not logged in/);
  const silent = await claudeRun('no-submit');
  assert.equal(silent.result.ok, false); assert.match(silent.result.message, /finished without submitting a proposal/);
  const missing = new DiscoveryRun({ adapter: new ClaudeDiscoveryAdapter({ executable: path.resolve('.cache/agent-discovery-tests/missing/claude.exe'), runRoot: path.resolve('.cache/agent-discovery-tests/missing-runs') }), host: await toolHost(structuredClone(SNAPSHOT)), proxy: await proxyLaunch(), progress: () => {} });
  const unavailable = await missing.start(); await missing.stopped();
  assert.match(unavailable.message, /Claude Code is not available/);
});

test('the init check accepts exactly the Specular tools from the Specular server in dontAsk mode', () => {
  const tools = AGENT_TOOLS.map(tool => CLAUDE_TOOL_PREFIX + tool.name), servers = [{ name: 'specular', status: 'connected' }];
  assert.equal(initProblem({ tools, mcp_servers: servers, permissionMode: 'dontAsk', slash_commands: [] }), undefined);
  assert.match(initProblem({ tools: tools.slice(1), mcp_servers: servers, permissionMode: 'dontAsk' })!, /did not offer the Specular tools/);
  assert.match(initProblem({ tools, mcp_servers: [...servers, { name: 'other', status: 'connected' }], permissionMode: 'dontAsk' })!, /unexpected MCP servers \(specular, other\)/);
  assert.match(initProblem({ tools, mcp_servers: [{ name: 'specular', status: 'failed' }], permissionMode: 'dontAsk' })!, /unexpected MCP servers/);
  assert.match(initProblem({ tools, mcp_servers: servers, permissionMode: 'bypassPermissions' })!, /permission mode "bypassPermissions"/);
  assert.match(initProblem({ tools, mcp_servers: servers, permissionMode: 'dontAsk', slash_commands: ['review'] })!, /commands or skills/);
});

test('cancelling a Claude Code run stops its process tree', async () => {
  const fixture = await fakeClaude('slow'), progress: string[] = [];
  const run = new DiscoveryRun({ adapter: new ClaudeDiscoveryAdapter({ executable: fixture.executable, runRoot: path.join(fixture.root, 'runs') }), host: await toolHost(structuredClone(SNAPSHOT)), proxy: await proxyLaunch(), progress: m => progress.push(m) });
  const pending = run.start();
  while (!progress.some(m => m.startsWith('1/80'))) await new Promise(resolve => setTimeout(resolve, 50));
  const { pid } = JSON.parse(await readFile(fixture.invocation, 'utf8'));
  await run.cancel();
  assert.match((await pending).message, /Discovery cancelled/);
  assert.throws(() => process.kill(pid, 0), 'the fake claude process was terminated');
});

// Increment 92: agent runs that submit their best draft.
const repeated = Array.from({ length: 12 }, (_, i) => `## R-${i + 1} Item`).join('\n\n') + '\n';
const repeatBox = () => new AgentToolbox({ documents: { 'a.md': repeated, 'b.md': repeated }, configuration: structuredClone(LEGACY_ID_CONFIGURATION) });
const repeatDraft = (extra: object = {}) => ({ categories: [{ key: 'r', name: 'Records', ...extra }], rules: [{ key: 'r', category: 'r', prefix: 'R' }] });

test('submit_proposal submits an evaluated draft by evaluationId and questions a clearly worse draft once', () => {
  const box = repeatBox();
  const good = box.call('evaluate_configuration', { configuration: repeatDraft({ definitionPaths: ['a.md'] }) }) as any;
  const bad = box.call('evaluate_configuration', { configuration: repeatDraft() }) as any;
  assert.deepEqual([good.value.evaluationId, good.value.categories[0].duplicates, good.value.categories[0].unresolved], ['e1', 0, 0]);
  assert.ok(bad.value.categories[0].duplicates >= 12, JSON.stringify(bad.value.categories));
  const rationale = { r: 'R-N headings define records.' };
  assert.match(box.call('submit_proposal', { evaluationId: 'e99', rationale }).message!, /Unknown or expired evaluationId "e99"/);
  assert.match(box.call('submit_proposal', { evaluationId: 'e1', configuration: repeatDraft(), rationale }).message!, /either a configuration or an evaluationId/);
  const questioned = box.call('submit_proposal', { evaluationId: 'e2', rationale }) as any;
  assert.equal(questioned.ok, false);
  assert.match(questioned.message, /draft e2 has \d+ problems \(\d+ duplicates, 0 unresolved references\), clearly more than draft e1 with 0 .*"evaluationId": "e1".*submit it again with "evaluationId": "e2"/);
  assert.deepEqual([questioned.value.best.evaluationId, questioned.value.submitted.evaluationId], ['e1', 'e2']);
  assert.equal(box.proposal, undefined);
  // Resubmitting keeps the agent's choice: the check runs once per run.
  const kept = box.call('submit_proposal', { evaluationId: 'e2', rationale });
  assert.equal(kept.ok, true, kept.message); assert.equal(kept.summary, 'Submitted draft 2 with 1 categories');
  assert.equal(box.proposal!.evaluation.id, 'e2'); assert.equal(box.proposal!.configuration.categories[0].definitionPaths, undefined);
});

test('a better or similar draft is accepted at once, by evaluationId or by configuration', () => {
  const box = repeatBox(), rationale = { r: 'R-N headings define records.' };
  box.call('evaluate_configuration', { configuration: repeatDraft() });
  box.call('evaluate_configuration', { configuration: repeatDraft({ definitionPaths: ['a.md'] }) });
  const better = box.call('submit_proposal', { evaluationId: 'e2', rationale });
  assert.equal(better.ok, true, better.message); assert.deepEqual(box.proposal!.configuration.categories[0].definitionPaths, ['a.md']);
  const similar = repeatBox();
  similar.call('evaluate_configuration', { configuration: repeatDraft({ definitionPaths: ['a.md'] }) });
  const submitted = similar.call('submit_proposal', { configuration: repeatDraft({ definitionPaths: ['a.md', 'docs'] }), rationale });
  assert.equal(submitted.ok, true, submitted.message); assert.equal(similar.proposal!.evaluation.id, 'e2');
});

test('the guide and schema describe submission by evaluationId', () => {
  assert.match(AGENT_INSTRUCTIONS, /submit it with its evaluationId instead of a configuration/);
  const submit = AGENT_TOOLS.find(tool => tool.name === 'submit_proposal')!;
  assert.deepEqual((submit.inputSchema as any).required, ['rationale']); assert.ok((submit.inputSchema as any).properties.evaluationId);
});

test('an agent that ends without submitting is asked once to submit its best draft', async () => {
  const evaluate = async (client: McpClient) => { await client.tool('evaluate_configuration', { configuration: GOOD_DRAFT }); };
  const followed = await runWith(evaluate, { followUp: async (client, text) => {
    await client.tool('submit_proposal', { evaluationId: /"evaluationId": "(e\d+)"/.exec(text)![1], rationale: RATIONALE });
    await new Promise(resolve => setTimeout(resolve, 5000));
  } });
  assert.equal(followed.result.ok, true, followed.result.message);
  assert.equal(followed.result.followUp, true); assert.equal(followed.adapter.followUps.length, 1);
  assert.match(followed.adapter.followUps[0], /without calling submit_proposal.*draft e1 \(2 categories, 0 duplicates, \d+ unresolved references\).*59 of 60 tool calls remain/);
  assert.ok(followed.progress.some(m => /Asked it once to submit its best evaluated draft, e1/.test(m)), followed.progress.join('\n'));
  assert.equal(followed.result.best!.evaluationId, 'e1');
  const ignored = await runWith(evaluate);
  assert.equal(ignored.result.ok, false); assert.equal(ignored.adapter.followUps.length, 1);
  assert.match(ignored.result.message, /finished without submitting a proposal, also after a follow-up request\. Its best evaluated draft was draft e1 \(2 categories, 0 duplicates, \d+ unresolved references\)\. No configuration was changed\./);
  // Without a valid evaluation there is nothing to submit, so no follow-up.
  const unmeasured = await runWith(async client => { await client.tool('evaluate_configuration', { configuration: { categories: [], rules: 'x' } }); });
  assert.equal(unmeasured.result.ok, false); assert.equal(unmeasured.adapter.followUps.length, 0);
  assert.match(unmeasured.result.message, /finished without submitting a proposal\. No configuration was changed\./);
});

test('the run keeps the draft with the fewest problems as the best one', async () => {
  const { result } = await runWith(async client => {
    await client.tool('evaluate_configuration', { configuration: GOOD_DRAFT });
    await client.tool('evaluate_configuration', { configuration: { ...GOOD_DRAFT, categories: GOOD_DRAFT.categories.map(({ idScopes, ...c }) => c) } });
  });
  assert.equal(result.best!.evaluationId, 'e1', result.message);
});

test('Codex and Claude Code get one follow-up turn in the same conversation', async () => {
  const codex = await codexRun('follow-up');
  assert.equal(codex.result.ok, true, codex.result.message); assert.equal(codex.result.followUp, true);
  assert.equal(codex.log.filter(entry => entry.method === 'turn/start').length, 2);
  assert.match(codex.log.find(entry => entry.followUp).followUp, /"evaluationId": "e1"/);
  const silentCodex = await codexRun('no-submit');
  assert.match(silentCodex.result.message, /also after a follow-up request\. Its best evaluated draft was draft e1/);
  const claude = await claudeRun('follow-up');
  assert.equal(claude.result.ok, true, claude.result.message); assert.equal(claude.result.proposal!.evaluation.id, 'e1');
  assert.equal(claude.progress.filter(m => m === 'status: Claude Code is surveying the project…').length, 1, claude.progress.join('\n'));
  const silentClaude = await claudeRun('no-submit');
  assert.match(silentClaude.result.message, /also after a follow-up request\. Its best evaluated draft was draft e1/);
});
