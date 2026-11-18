import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { analyzeDocument, buildIndex } from '../src/core/documents';
import { compileIdMatcher, validateIdConfiguration } from '../src/core/id-configuration';
import { mapStatuses } from '../src/core/statuses';
import { annotateDates } from '../src/core/dates';
import { assignModules } from '../src/core/modules';
import { assignFeatures } from '../src/core/features';
import { modelsFor } from '../src/renderer/plugin-models';
import type { WorkspaceViewSnapshot } from '../src/renderer/abstraction-views';
import { canonicalSubject, MAX_SUMMARY_INPUT, SUMMARY_INSTRUCTION_VERSION, summaryChanges, summaryCitations, summaryInput, validStoredSummary, validSubject, type StoredSummary } from '../src/core/summaries';
import { readSummary, summaryFile, writeSummary } from '../src/core/summary-store';
import { claudeSummaryArguments, claudeSummaryResult, codexSummaryRunner } from '../src/core/summary-runners';
import { Settings } from '../src/core/settings';
import { validateManifest } from '../packages/plugin-api/src/index';
import type { CodexConnection } from '../src/core/codex-connection';

// Increment 94: the summary service builds input from Specular's models for a subject; plugins only name it.
const configuration = validateIdConfiguration({ version: 1,
  categories: [{ key: 'TASK', name: 'Tasks', role: 'task' }, { key: 'REQ', name: 'Requirements', role: 'requirement' }, { key: 'DD', name: 'Decisions', role: 'design' }],
  rules: [{ key: 'REQ', category: 'REQ', prefix: 'REQ' }, { key: 'DD', category: 'DD', prefix: 'DD' }, { key: 'TASK', category: 'TASK', prefix: 'TASK' }],
  statuses: [{ name: 'Implemented', rules: [{ mode: 'startsWith', value: 'Implemented' }] }],
  features: [{ key: 'auth', name: 'Authentication' }, { key: 'idle', name: 'Idle' }],
  featureRules: [{ key: 'auth', scope: 'folder', path: 'auth', features: ['auth'] }],
});
function models(documents: Record<string, string>) {
  const match = compileIdMatcher(configuration);
  const built = buildIndex(Object.entries(documents).map(([file, text]) => analyzeDocument(file, text, match)));
  const index = annotateDates(mapStatuses(assignFeatures(assignModules(built, configuration), configuration), configuration.statuses ?? []), documents);
  const snapshot: WorkspaceViewSnapshot = { projectId: 'p', revision: 1, ready: true, notice: '', documents, configuration, folders: [], files: Object.keys(documents).map(p => ({ path: p, markdown: true })), index, warnings: [] };
  return modelsFor(snapshot);
}
const base = {
  'auth/tasks.md': '# TASK-1 Build login\n\nImplements REQ-10.\n',
  'auth/requirements.md': '# REQ-10 Login\n\nStatus: Implemented\n\nUsers log in.\n\n# REQ-2 Logout\n\nUsers log out.\n',
  'auth/design.md': '# DD-1 Sessions\n\nTokens expire.\n',
  'other.md': '# REQ-50 Charge\n',
};

test('subjects are validated and ID sets are order-independent', () => {
  assert.ok(validSubject({ kind: 'feature', key: 'auth' }));
  assert.ok(validSubject({ kind: 'ids', keys: ['REQ-2', 'REQ-10'], name: 'Login path' }));
  for (const bad of [{ kind: 'feature' }, { kind: 'feature', key: 'a', extra: 1 }, { kind: 'ids', keys: [], name: 'x' }, { kind: 'ids', keys: ['A', 'A'], name: 'x' },
    { kind: 'ids', keys: Array.from({ length: 501 }, (_, i) => `R-${i}`), name: 'x' }, { kind: 'ids', keys: ['A'], name: ' ' }, { kind: 'ids', keys: ['A'], name: 'x'.repeat(129) },
    { kind: 'file', path: 'a.md' }, { kind: 'project' }, null, 'feature']) assert.equal(validSubject(bad), false, JSON.stringify(bad));
  assert.deepEqual(canonicalSubject({ kind: 'ids', keys: ['REQ-2', 'DD-1'], name: ' Path ' }), { kind: 'ids', keys: ['DD-1', 'REQ-2'], name: 'Path' });
  assert.equal(summaryFile({ kind: 'ids', keys: ['B', 'A'], name: 'x' }), summaryFile({ kind: 'ids', keys: ['A', 'B'], name: 'y' }));
  assert.equal(summaryFile({ kind: 'feature', key: 'auth' }), path.join('.specular', 'summaries', 'feature', 'auth.json'));
  assert.match(summaryFile({ kind: 'feature', key: '../x' }), /feature[\\/][0-9a-f]{16}\.json$/);
});

test('feature and ID-set input lists IDs by role, then excerpts within the budget', () => {
  const m = models(base);
  const feature = summaryInput(m, { kind: 'feature', key: 'auth' });
  assert.ok(!('error' in feature));
  assert.equal(feature.name, 'Feature "Authentication"');
  assert.deepEqual(Object.keys(feature.entries), ['REQ-2', 'REQ-10', 'DD-1', 'TASK-1']);
  assert.match(feature.text, /^Subject: Feature "Authentication" \(4 IDs\)\n\nIDs:\n- REQ-2 \[Requirements\] Logout\n- REQ-10 \[Requirements\] Login \(status: Implemented\)\n- DD-1/);
  assert.match(feature.text, /## REQ-10 \(auth\/requirements\.md:1\)\n# REQ-10 Login\nStatus: Implemented/);
  assert.match(feature.text, /\nRecorded links \(an ID mentioned in the section that defines another\):\n- TASK-1 mentions REQ-10 \(1 time\)\n\nDefinitions:/);
  assert.equal(feature.leftOut, 0);
  const set = summaryInput(m, { kind: 'ids', keys: ['TASK-1', 'REQ-50'], name: 'Charge path' });
  assert.ok(!('error' in set));
  assert.deepEqual([set.name, Object.keys(set.entries)], ['Charge path', ['REQ-50', 'TASK-1']]);
  assert.deepEqual(summaryInput(m, { kind: 'ids', keys: ['REQ-404'], name: 'x' }), { error: '1 of the IDs are not in this project.' });
  assert.deepEqual(summaryInput(m, { kind: 'feature', key: 'missing' }), { error: 'That feature is not configured in this project.' });
  assert.deepEqual(summaryInput(m, { kind: 'feature', key: 'idle' }), { error: 'There are no IDs to summarize.' });
  assert.match(String((summaryInput({ project: { ...m.project, ready: false }, physical: m.physical }, { kind: 'feature', key: 'auth' }) as { error: string }).error), /not ready/);
  const long = Array.from({ length: 11 }, () => 'x'.repeat(200)).join('\n');
  const big = models(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`auth/r${i}.md`, `# REQ-${100 + i} Big\n${long}\n`])));
  const bounded = summaryInput(big, { kind: 'feature', key: 'auth' });
  assert.ok(!('error' in bounded));
  assert.ok(bounded.text.length <= MAX_SUMMARY_INPUT);
  assert.ok(bounded.leftOut > 0 && bounded.leftOut < 30);
  assert.match(bounded.text, new RegExp(`\\(${bounded.leftOut} definitions were left out to stay within the size limit\\.\\)`));
});

test('changes report added, removed, and edited IDs and a new instruction version', () => {
  const before = summaryInput(models(base), { kind: 'feature', key: 'auth' });
  const after = summaryInput(models({ ...base,
    'auth/requirements.md': '# REQ-10 Sign in\n\nStatus: Implemented\n\nUsers log in.\n\n# REQ-3 Reset\n\nReset passwords.\n',
    'auth/design.md': '# DD-1 Sessions\n\nStatus: Implemented\n\nTokens expire hourly.\n' }), { kind: 'feature', key: 'auth' });
  assert.ok(!('error' in before) && !('error' in after));
  assert.deepEqual(summaryChanges(before.entries, before.entries, SUMMARY_INSTRUCTION_VERSION), { added: [], removed: [], changed: [], instruction: false });
  assert.deepEqual(summaryChanges(before.entries, after.entries, SUMMARY_INSTRUCTION_VERSION), {
    added: ['REQ-3'], removed: ['REQ-2'], changed: [{ key: 'DD-1', fields: ['status', 'excerpt'] }, { key: 'REQ-10', fields: ['title', 'excerpt'] }], instruction: false });
  assert.equal(summaryChanges(before.entries, before.entries, SUMMARY_INSTRUCTION_VERSION - 1).instruction, true);
});

test('citations are split into project IDs and unknown text', () => {
  const m = models(base);
  assert.deepEqual(summaryCitations('Login [REQ-10] uses [DD-1, TASK-1]; see [REQ-99] and [note].', m), { citedIds: ['REQ-10', 'DD-1', 'TASK-1'], unknownCitations: ['REQ-99', 'note'] });
});

test('records round-trip under .specular/summaries and mismatched or invalid files are ignored', async () => {
  await mkdir(path.resolve('.cache', 'unit-tests'), { recursive: true });
  const root = await mkdtemp(path.resolve('.cache', 'unit-tests', 'summaries-'));
  try {
    const record: StoredSummary = { version: 1, subject: { kind: 'ids', keys: ['REQ-2', 'REQ-10'], name: 'Pair' }, name: 'Pair', text: 'About [REQ-10].', generatedAt: '2026-10-23T10:00:00.000Z',
      agent: 'claude', instructionVersion: 1, entries: { 'REQ-10': { title: 'a', status: 'b', excerpt: 'c' } }, citedIds: ['REQ-10'], unknownCitations: [] };
    await writeSummary(root, record);
    const file = path.join(root, summaryFile(record.subject));
    assert.match(file, /[\\/]\.specular[\\/]summaries[\\/]ids[\\/][0-9a-f]{16}\.json$/);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).subject, { kind: 'ids', keys: ['REQ-10', 'REQ-2'], name: 'Pair' });
    assert.equal((await readSummary(root, { kind: 'ids', keys: ['REQ-10', 'REQ-2'], name: 'Pair' }))?.text, 'About [REQ-10].');
    assert.equal(await readSummary(root, { kind: 'feature', key: 'auth' }), undefined);
    await assert.rejects(() => writeSummary(root, { ...record, agent: 'other' as 'claude' }), /Invalid summary record/);
    assert.equal(validStoredSummary({ ...record, entries: { A: { title: 1 } } }), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('consent is remembered per project in settings', async () => {
  const root = await mkdtemp(path.resolve('.cache', 'unit-tests', 'consent-'));
  try {
    const file = path.join(root, 'settings.json'), project = path.join(root, 'project');
    const settings = await Settings.load(file);
    assert.equal(settings.summaryConsent(project), false);
    assert.deepEqual(await settings.saveSummaryConsent(project, true), { ok: true });
    assert.equal((await Settings.load(file)).summaryConsent(project), true);
    await settings.saveSummaryConsent(project, false);
    assert.equal((await Settings.load(file)).summaryConsent(project), false);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('Claude Code runs without tools or MCP servers, and its JSON result is read', () => {
  const args = claudeSummaryArguments('prompt.md', 'sonnet');
  assert.deepEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', '']);
  assert.ok(args.includes('--strict-mcp-config') && !args.includes('--mcp-config') && !args.includes('--allowedTools'));
  assert.deepEqual(args.slice(-4), ['--system-prompt-file', 'prompt.md', '--model', 'sonnet']);
  assert.equal(claudeSummaryResult('noise\n{"type":"result","subtype":"success","is_error":false,"result":" A summary. "}\n'), 'A summary.');
  assert.throws(() => claudeSummaryResult('{"type":"result","subtype":"error_max_turns","is_error":true}'), /Claude Code stopped: error_max_turns/);
  assert.throws(() => claudeSummaryResult('not json'), /no readable result/);
});

/** A scripted Codex app-server: answers thread/start and turn/start, then plays the given notifications. */
function fakeCodex(items: { type: string; text?: string }[], status = 'completed') {
  const listeners = new Set<(method: string, value: unknown) => void>();
  const requests: { method: string; params: any }[] = [];
  const emit = (method: string, value: unknown) => { for (const l of [...listeners]) l(method, value); };
  const client = { request: async (method: string, params: any) => {
    requests.push({ method, params });
    if (method === 'thread/start') return { thread: { id: 't1', ephemeral: true }, approvalPolicy: 'never', sandbox: { type: 'readOnly', networkAccess: false } };
    if (method === 'turn/start') {
      setTimeout(() => { for (const item of items) emit('item/completed', { threadId: 't1', item }); if (status) emit('turn/completed', { threadId: 't1', turn: { id: 'u1', status } }); }, 5);
      return { turn: { id: 'u1', status: 'inProgress' } };
    }
    return {};
  } };
  const connection = { runtime: () => ({ client, cwd: 'runtime' }), prepareProject: async (cwd: string) => cwd, subscribe: (l: (m: string, v: unknown) => void) => { listeners.add(l); return () => listeners.delete(l); } };
  return { connection: connection as unknown as CodexConnection, requests };
}
test('Codex runs one read-only turn without tools, and stops on any tool item, cancellation, or timeout', async () => {
  const ok = fakeCodex([{ type: 'reasoning' }, { type: 'agentMessage', text: ' Login is specified. ' }]);
  assert.equal(await codexSummaryRunner(ok.connection)({ instructions: 'I', input: 'X', signal: new AbortController().signal }), 'Login is specified.');
  const start = ok.requests.find(r => r.method === 'thread/start')!.params;
  assert.deepEqual([start.sandbox, start.approvalPolicy, start.ephemeral, start.config.mcp_servers, start.config.features.shell_tool, start.developerInstructions], ['read-only', 'never', true, undefined, false, 'I']);
  assert.match(ok.requests.find(r => r.method === 'turn/start')!.params.input[0].text, /^<content>\nX\n<\/content>$/);
  await assert.rejects(() => codexSummaryRunner(fakeCodex([{ type: 'commandExecution' }]).connection)({ instructions: 'I', input: 'X', signal: new AbortController().signal }), /"commandExecution" item/);
  const controller = new AbortController(), pending = codexSummaryRunner(fakeCodex([], '').connection)({ instructions: 'I', input: 'X', signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await assert.rejects(() => pending, /cancelled/);
  await assert.rejects(() => codexSummaryRunner(fakeCodex([], '').connection)({ instructions: 'I', input: 'X', signal: new AbortController().signal, timeoutMs: 30 }), /did not answer within 0 seconds/);
});

test('summary.generate needs customApi 2, both models, and a custom view', () => {
  const manifest = { manifestVersion: 1, id: 'test.summary', version: '1.0.0', api: '>=0.2.0 <0.3.0', entry: 'index.js', customApi: 2, capabilities: ['workspace.read', 'summary.generate'], models: ['project@1', 'physical@1'], views: [{ id: 'v', title: 'V', kind: 'custom' }] };
  assert.equal(validateManifest(manifest).ok, true);
  assert.equal(validateManifest({ ...manifest, capabilities: ['workspace.read'] }).ok, true);
  for (const bad of [{ customApi: 1 }, { customApi: undefined }, { models: ['project@1'] }, { views: [{ id: 'v', title: 'V', kind: 'list' }] }, { customApi: 3 }])
    assert.equal(validateManifest({ ...manifest, ...bad }).ok, false, JSON.stringify(bad));
});
