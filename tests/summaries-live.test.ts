import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { CodexConnection } from '../src/core/codex-connection';
import { Workspace } from '../src/core/workspace';
import { indexProject } from '../src/core/project-index';
import { modelsFor } from '../src/renderer/plugin-models';
import { SUMMARY_INSTRUCTION, summaryCitations, summaryInput } from '../src/core/summaries';
import { claudeSummaryRunner, codexSummaryRunner } from '../src/core/summary-runners';

/**
 * Increment 94a: one live, tool-less summary call per feature of a project (default `examples/harbor`).
 * Opt in with SPECULAR_LIVE_SUMMARY=1 and either SPECULAR_LIVE_AGENT=claude (the signed-in Claude Code on PATH, or
 * SPECULAR_LIVE_CLAUDE_PATH) or OPENAI_API_KEY (Codex); optionally SPECULAR_LIVE_MODEL and SPECULAR_LIVE_PROJECT.
 */
const claude = process.env.SPECULAR_LIVE_AGENT === 'claude';
const enabled = !!process.env.SPECULAR_LIVE_SUMMARY && (claude || !!process.env.OPENAI_API_KEY);

test('live feature summaries', { skip: !enabled, timeout: 15 * 60_000 }, async () => {
  const base = path.resolve('.cache/summaries-live'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-')), model = process.env.SPECULAR_LIVE_MODEL;
  const connection = new CodexConnection(path.join(root, 'user-data'), () => {});
  try {
    if (!claude) assert.equal((await connection.connect('', process.env.OPENAI_API_KEY!)).status, 'connected');
    const workspace = await Workspace.open(path.resolve(process.env.SPECULAR_LIVE_PROJECT ?? 'examples/harbor')), snapshot = await workspace.snapshot();
    const configuration = snapshot.idConfiguration!.configuration;
    const index = indexProject(snapshot.documents, configuration);
    const models = modelsFor({ projectId: 'live', revision: 1, ready: true, notice: '', documents: snapshot.documents, configuration, folders: snapshot.folders, files: snapshot.files, index, warnings: [] });
    const runner = claude ? claudeSummaryRunner({ executable: process.env.SPECULAR_LIVE_CLAUDE_PATH ?? '', runRoot: path.join(root, 'claude') }) : codexSummaryRunner(connection);
    for (const feature of configuration.features ?? []) {
      const input = summaryInput(models, { kind: 'feature', key: feature.key });
      assert.ok(!('error' in input), `input for ${feature.name}`);
      const started = Date.now();
      const text = await runner({ instructions: SUMMARY_INSTRUCTION, input: input.text, ...(model ? { model } : {}), signal: new AbortController().signal });
      const citations = summaryCitations(text, models), words = text.split(/\s+/).filter(Boolean).length;
      console.log(JSON.stringify({ agent: claude ? 'claude' : 'codex', feature: feature.name, seconds: Math.round((Date.now() - started) / 1000), inputChars: input.text.length, words, ...citations, text }, null, 2));
      assert.ok(words >= 40 && words <= 250, `${feature.name}: ${words} words`);
    }
  } finally { if (!claude) await connection.disconnect(); }
});
