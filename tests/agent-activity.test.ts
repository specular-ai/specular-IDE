import assert from 'node:assert/strict';
import test from 'node:test';
import type { ActivityModel, AgentSession, PhysicalModel, ToolCall } from '../packages/plugin-api/src/index';
import { callTarget, commandGroup, commandGroups, durationText, filterSessions, groupCalls, REPEATED_FAILURES, resources, totals } from '../bundled-plugins/agent-activity/src/activity';

// Increment 95b: the Agent activity view's grouping, counts, and filters over activity@1.
const at = (day: number, minute = 0) => new Date(2026, 9, day, 10, minute).toISOString();
const call = (c: Partial<ToolCall> & Pick<ToolCall, 'kind'>, minute = 0, day = 20): ToolCall =>
  ({ at: at(day, minute), tool: c.kind === 'command' ? 'Bash' : 'Read', paths: [], outside: 0, outcome: 'ok', ...c });
const session = (id: string, agent: AgentSession['agent'], day: number, calls: ToolCall[], ended = 30): AgentSession =>
  ({ id, agent, started: at(day), ended: at(day, ended), cwd: '', turns: [{ index: 0, started: at(day), toolCalls: calls }], toolCalls: calls.length,
    failures: calls.filter(c => c.outcome === 'error' || c.outcome === 'denied').length, truncated: false });
const model = (sessions: AgentSession[]): ActivityModel => ({ name: 'activity', version: 1, revision: 1, ready: true, warnings: [], provenance: { extractor: 'test', extractorVersion: '1' },
  enabled: true, sessions, sources: [] });
const physical = (files: string[]): PhysicalModel => ({ name: 'physical', version: 1, revision: 1, ready: true, warnings: [], provenance: { extractor: 'test', extractorVersion: '1' },
  folders: [], files: files.map(path => ({ path, markdown: true })), documents: files.map(file => ({ file, text: '# x\n' })) });

test('commands are grouped by their first words after folder changes, environment, and program paths', () => {
  const cases: [string, string][] = [
    ['npm test', 'npm test'], ['npm test -- --watch', 'npm test'], ['npm run build', 'npm run build'], ['npm run test:ui -- tests/ui/x.spec.ts', 'npm run test:ui'],
    ['npx playwright test tests/ui/activity.spec.ts', 'npx playwright test'], ['npx tsc --noEmit', 'npx tsc'],
    ['git status', 'git status'], ['git commit -m "feat: x"', 'git commit'], ['git -C repo log', 'git log'], ['git -c safe.directory=C:/x status --short; git diff', 'git status'],
    ['git --no-pager diff --stat', 'git diff'], ["echo 'a; b' | grep a", 'echo'], ['grep -rn "x|y" src', 'grep'], ['npm test \\\n  -- --grep x', 'npm test'],
    ["@'\nfrom pathlib import Path; print(1)\n'@ | python -", 'python'], ["$p='plan.md'; $t=Get-Content $p; Set-Content $p $t", 'Set-Content'],
    ['for f in a b; do cat $f; done', 'for'], ['& "C:\\Program Files\\nodejs\\npm.cmd" run build', 'npm run build'], ['(Get-Command gh).Source', 'Get-Command'],
    ["python - <<'EOF'\nimport re; print(2)\nEOF", 'python'], ['set -e; npm ci', 'npm ci'], ['sudo apt install x', 'apt install'],
    ['f=$(ls -d results/*/x.md | head -1); grep -n "a" "$f" | head', 'grep'], ["@'\nfrom pathlib import Path\np=Path('a.ts');s=p.read_text(encoding='utf-8').replace('x…", 'PowerShell here-string'],
    ['{ ls; pwd; }', 'ls'], ['ls examples', 'ls'], ['Get-ChildItem out -Recurse', 'Get-ChildItem'], ["(Get-Date).ToString('HH:mm')", 'Get-Date'], ['if(-not (Test-Path x)) { mkdir x }', 'if'],
    ['cd /c/work/specular && npm test', 'npm test'], ['cd "C:\\a b" && cd sub && git diff --stat', 'git diff'], ['pushd x; npx vitest run', 'npx vitest run'],
    ['Set-Location C:\\x; npm test', 'npm test'], ['CI=1 FORCE_COLOR=0 npm test', 'npm test'], ['export NODE_ENV=test && node scripts/x.mjs', 'node'],
    ["$env:CI='1'; npm test", 'npm test'], ['node_modules/.bin/vitest run', 'vitest run'], ['C:\\tools\\git.exe status', 'git status'],
    ['cat README.md', 'cat'], ['ls -la src', 'ls'], ['grep -rn foo src | head -20', 'grep'], ['Get-Content README.md', 'Get-Content'],
    ['python -m pytest', 'python'], ['cd sub', 'cd sub'], ['  ', ''],
  ];
  for (const [command, group] of cases) assert.equal(commandGroup(command), group, command);
});

test('command groups count calls, failures, sessions, and the last outcome, and mark repeated failures within one session', () => {
  const failing = (minute: number, exitCode = 1, day = 20) => call({ kind: 'command', command: 'npm test', outcome: 'error', exitCode }, minute, day);
  const a = session('a', 'claude', 20, [failing(1), failing(2), call({ kind: 'command', command: 'cd x && npm test -- --grep y', outcome: 'denied' }, 3), call({ kind: 'command', command: 'npm test' }, 4), call({ kind: 'command', command: 'git status' }, 5)]);
  const b = session('b', 'codex', 21, [failing(1, 2, 21), failing(2, 1, 21), call({ kind: 'read', paths: ['README.md'] }, 3, 21)]);
  const groups = commandGroups([a, b]);
  assert.deepEqual(groups.map(g => [g.name, g.count, g.failures, g.sessions, g.repeated]), [['npm test', 6, 5, 2, 1], ['git status', 1, 0, 1, 0]]);
  assert.equal(REPEATED_FAILURES, 3);
  const npm = groups[0];
  assert.deepEqual(npm.last, { at: at(21, 2), outcome: 'error', exitCode: 1, command: 'npm test' });
  // Two failures in each of two sessions are not a repeated failure.
  assert.equal(commandGroups([session('c', 'claude', 20, [failing(1), failing(2)]), session('d', 'claude', 21, [failing(1), failing(2)])])[0].repeated, 0);
  // A call without command text (a read) is not a command.
  assert.equal(commandGroups([b]).reduce((n, g) => n + g.count, 0), 2);
  assert.deepEqual(groupCalls([a, b], 'npm test', 3).map(x => [x.session.id, x.call.at]), [['b', at(21, 2)], ['b', at(21, 1)], ['a', at(20, 4)]]);
});

test('resources count reads, writes, and other mentions per project file, with sessions, last access, spec files, and outside paths', () => {
  const a = session('a', 'claude', 20, [
    call({ kind: 'read', paths: ['specs/login.md'] }, 1), call({ kind: 'write', paths: ['specs/login.md'] }, 2), call({ kind: 'read', paths: ['specs/login.md', 'specs/login.md'] }, 3),
    call({ kind: 'search', paths: ['src/a.ts'], outside: 2 }, 4), call({ kind: 'read', paths: [], outside: 1 }, 5)]);
  const b = session('b', 'codex', 21, [call({ kind: 'write', paths: ['src/a.ts'] }, 7, 21), call({ kind: 'command', command: 'cat specs/login.md', paths: ['specs/login.md'] }, 8, 21)]);
  const r = resources([a, b], physical(['specs/login.md', 'README.md']));
  assert.equal(r.outside, 3);
  assert.deepEqual(r.files, [
    { path: 'specs/login.md', reads: 2, writes: 1, other: 1, sessions: 2, last: at(21, 8), spec: true },
    { path: 'src/a.ts', reads: 0, writes: 1, other: 1, sessions: 2, last: at(21, 7), spec: false },
  ]);
  assert.deepEqual(resources([a]).files.map(f => f.spec), [false, false]);
});

test('filters select sessions by agent, overlapping local days, and session, and totals follow them', () => {
  const sessions = [session('new', 'codex', 22, [call({ kind: 'read' })]), session('mid', 'claude', 21, [call({ kind: 'command', outcome: 'error' })]),
    { ...session('long', 'claude', 18, []), ended: at(20, 5) }];
  const m = model(sessions), ids = (f: Parameters<typeof filterSessions>[1]) => filterSessions(m, f).map(s => s.id);
  assert.deepEqual(ids({}), ['new', 'mid', 'long']);
  assert.deepEqual(ids({ agent: 'claude' }), ['mid', 'long']);
  assert.deepEqual(ids({ from: '2026-10-21' }), ['new', 'mid']);
  assert.deepEqual(ids({ to: '2026-10-21' }), ['mid', 'long']);
  assert.deepEqual(ids({ from: '2026-10-19', to: '2026-10-19' }), ['long'], 'a session spanning the range overlaps it');
  assert.deepEqual(ids({ from: '2026-10-21', to: '2026-10-21', agent: 'codex' }), []);
  assert.deepEqual(ids({ session: 'claude:mid' }), ['mid']);
  assert.deepEqual(ids({ session: 'codex:mid' }), []);
  assert.deepEqual(ids({ from: 'not a day' }), ['new', 'mid', 'long']);
  assert.deepEqual(totals(filterSessions(m, { agent: 'claude' })), { sessions: 2, turns: 2, toolCalls: 1, failures: 1 });
});

test('durations and call descriptions', () => {
  assert.equal(durationText(at(20), at(20, 0)), '1 s');
  assert.equal(durationText(at(20), at(20, 42)), '42 min');
  assert.equal(durationText(at(20), new Date(Date.parse(at(20)) + 125 * 60_000).toISOString()), '2 h 05 min');
  assert.equal(durationText(at(20)), '');
  assert.equal(callTarget(call({ kind: 'command', command: 'npm test', paths: ['x'] })), 'npm test');
  assert.equal(callTarget(call({ kind: 'read', paths: ['a.md', 'b.md'], outside: 1 })), 'a.md, b.md · 1 path outside the project');
});
