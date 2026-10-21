import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodexConnection } from '../src/core/codex-connection';
import { CodexDiscoveryAdapter } from '../src/core/codex-discovery';
import { ClaudeDiscoveryAdapter } from '../src/core/claude-discovery';
import { DiscoveryRun } from '../src/core/discovery-run';
import { Workspace } from '../src/core/workspace';
import { compileIdMatcher } from '../src/core/id-configuration';
import { draftProblems } from '../src/core/agent-tools';
import { proxyLaunch, toolHost } from './helpers/agent-discovery-fixtures';

/**
 * Live acceptance for increments 86a-86b: real Codex or Claude Code on local survey projects (kept outside the repository).
 * Opt in with SPECULAR_LIVE_AGENT_DISCOVERY=1 and either OPENAI_API_KEY (Codex) or SPECULAR_LIVE_AGENT=claude (the signed-in
 * Claude Code on PATH, or SPECULAR_LIVE_CLAUDE_PATH); optionally SPECULAR_LIVE_CODEX_MODEL or SPECULAR_LIVE_MODEL, and
 * SPECULAR_LIVE_PROJECTS (comma-separated paths). The report compares the proposal with each project's local configuration, an informal
 * baseline rather than a reviewed reference. Runs recorded for both agents on 2026-10-17 (increment 86b). Since increment 87 the report
 * also holds the proposed status sites, statuses, and date rules with their measurements, and the agent's gaps; since increment 92,
 * each category's settings, the best evaluated draft, whether the submission was that draft's equal, and whether a follow-up was sent.
 */
const claude = process.env.SPECULAR_LIVE_AGENT === 'claude';
const enabled = !!process.env.SPECULAR_LIVE_AGENT_DISCOVERY && (claude || !!process.env.OPENAI_API_KEY);
const model = process.env.SPECULAR_LIVE_MODEL ?? process.env.SPECULAR_LIVE_CODEX_MODEL;
const projects = (process.env.SPECULAR_LIVE_PROJECTS?.split(',') ?? ['examples/cache-data', 'examples/swift-secp256k1', '../specular-tests/go-workflow', '../specular-tests/pyArchimate']).map(p => path.resolve(p.trim()));

test('live agentic discovery on survey projects', { skip: !enabled, timeout: 60 * 60_000 }, async () => {
  const base = path.resolve('.cache/agentic-discovery-live'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-')), report: Record<string, unknown>[] = [];
  const connection = new CodexConnection(path.join(root, 'user-data'), () => {});
  try {
    if (!claude) assert.equal((await connection.connect('', process.env.OPENAI_API_KEY!)).status, 'connected');
    for (const project of projects) {
      try { await access(project); } catch { report.push({ project, skipped: 'missing' }); continue; }
      const workspace = await Workspace.open(project), snapshot = await workspace.snapshot();
      const hand = snapshot.idConfiguration!.configuration;
      // Start from the defaults, as on a project without configuration; the local configuration is the reference.
      const configuration = { version: 1 as const, categories: [{ key: 'requirements', name: 'Requirements', role: 'requirement' as const }], rules: [{ key: 'req', category: 'requirements', prefix: 'REQ' }] };
      const progress: string[] = [], started = Date.now();
      const run = new DiscoveryRun({ adapter: claude ? new ClaudeDiscoveryAdapter({ executable: process.env.SPECULAR_LIVE_CLAUDE_PATH ?? '', runRoot: path.join(root, 'claude-runs') }) : new CodexDiscoveryAdapter(connection), host: await toolHost({ documents: snapshot.documents, configuration }), proxy: await proxyLaunch(), model, progress: m => progress.push(m) });
      const result = await run.start(); await run.stopped();
      const entry: Record<string, unknown> = { project: path.basename(project), agent: claude ? 'claude' : 'codex', ok: result.ok, message: result.message, toolCalls: result.toolCalls, seconds: Math.round((Date.now() - started) / 1000), progress,
        handWritten: hand.categories.map(c => c.name), baselineStatuses: { statusSites: hand.statusSites, statuses: hand.statuses?.map(s => s.name), dates: hand.dates?.rules.map(r => r.key) },
        proposal: result.proposal && { categories: result.proposal.evaluation.categories, rules: result.proposal.configuration.rules, rationale: result.proposal.rationale, summary: result.proposal.summary,
          // Increment 87: status and date proposals, their measurements, and the gaps.
          statusSites: result.proposal.configuration.statusSites, statuses: result.proposal.configuration.statuses, dates: result.proposal.configuration.dates,
          statusMetrics: result.proposal.evaluation.statuses, dateMetrics: result.proposal.evaluation.dates,
          statusRationale: result.proposal.statusRationale, dateRationale: result.proposal.dateRationale, gaps: result.proposal.gaps,
          // Increment 92: each category's settings, and the submitted draft's problems beside the best evaluated draft's.
          categorySettings: result.proposal.configuration.categories, idDefinitionSites: result.proposal.configuration.idDefinitionSites, submitted: { evaluationId: result.proposal.evaluation.id, ...draftProblems(result.proposal.evaluation) } },
        best: result.best, followUp: result.followUp ?? false, submittedBest: result.proposal && result.best ? draftProblems(result.proposal.evaluation).problems <= result.best.problems : undefined };
      // pyArchimate: SonarQube and ruff codes beside its Spec Kit IDs must not become records.
      if (result.proposal && path.basename(project) === 'pyArchimate') entry.lintCodesRecognized = compileIdMatcher(result.proposal.configuration)('Rules S1172, PT009 and UP045.').map(match => match.id);
      report.push(entry);
      await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
    }
  } finally { if (!claude) await connection.disconnect(); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); }
  console.log(`Report: ${path.join(root, 'report.json')}`);
  assert.ok(report.some(entry => entry.ok === true), 'at least one project produced a proposal');
});
