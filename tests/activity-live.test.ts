import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { ActivityReader, activityHomes } from '../src/core/activity/reader';
import { parseActivity } from '../src/shared/activity-model';
import { existsSync } from 'node:fs';
import { commandGroups, resources } from '../bundled-plugins/agent-activity/src/activity';

/**
 * Increment 95a: the activity model on this machine's real Claude Code and Codex logs for a project (default: this
 * repository). Opt in with SPECULAR_LIVE_ACTIVITY=1; SPECULAR_LIVE_PROJECT selects another project. Prints counts only.
 */
test('live agent activity of a project', { skip: !process.env.SPECULAR_LIVE_ACTIVITY, timeout: 10 * 60_000 }, async () => {
  const root = path.resolve(process.env.SPECULAR_LIVE_PROJECT ?? '.'), reader = new ActivityReader(activityHomes());
  const started = Date.now(), model = await reader.model(root, true), first = Date.now() - started;
  const again = Date.now(), cached = await reader.model(root, true), second = Date.now() - again;
  assert.deepEqual(parseActivity(JSON.parse(JSON.stringify(model))), model);
  assert.equal(cached, model);
  const calls = model.sessions.flatMap(s => s.turns.flatMap(u => u.toolCalls));
  const tally = (key: (c: typeof calls[number]) => string) => calls.reduce((m: Record<string, number>, c) => (m[key(c)] = (m[key(c)] ?? 0) + 1, m), {});
  console.log(JSON.stringify({ project: path.basename(root), ms: { first, cached: second }, bytes: JSON.stringify(model).length, sources: model.sources,
    sessions: model.sessions.length, byAgent: model.sessions.reduce((m: Record<string, number>, s) => (m[s.agent] = (m[s.agent] ?? 0) + 1, m), {}),
    turns: model.sessions.reduce((n, s) => n + s.turns.length, 0), calls: calls.length, kinds: tally(c => c.kind), outcomes: tally(c => c.outcome),
    withPaths: calls.filter(c => c.paths.length).length, outsideOnly: calls.filter(c => !c.paths.length && c.outside).length, folders: [...new Set(model.sessions.map(s => s.cwd))].length }, null, 1));
  assert.ok(model.sessions.length > 0, 'at least one session of this project');
});

/** Increment 95b: what the Agent activity view derives from the same live model: command groups, repeated failures, and resources. */
test('live agent activity view data of a project', { skip: !process.env.SPECULAR_LIVE_ACTIVITY, timeout: 10 * 60_000 }, async () => {
  const root = path.resolve(process.env.SPECULAR_LIVE_PROJECT ?? '.'), model = await new ActivityReader(activityHomes()).model(root, true);
  const markdown = (file: string) => file.toLowerCase().endsWith('.md') && existsSync(path.join(root, file));
  const started = Date.now(), groups = commandGroups(model.sessions), used = resources(model.sessions), ms = Date.now() - started;
  const files = used.files.map(f => ({ ...f, spec: markdown(f.path) }));
  console.log(JSON.stringify({ project: path.basename(root), ms, groups: groups.length, repeated: groups.filter(g => g.repeated).map(g => [g.name, g.repeated, g.failures]),
    topGroups: groups.slice(0, 15).map(g => [g.name, g.count, g.failures]), files: files.length, specFiles: files.filter(f => f.spec).length, outside: used.outside,
    topFiles: files.slice(0, 10).map(f => [f.path, f.reads, f.writes, f.other, f.sessions]) }, null, 1));
  assert.equal(groups.reduce((n, g) => n + g.count, 0), model.sessions.flatMap(s => s.turns.flatMap(u => u.toolCalls)).filter(c => c.command).length);
});
