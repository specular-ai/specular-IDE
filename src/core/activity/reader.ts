import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ActivityModel, ActivitySource, AgentSession } from '../../../packages/plugin-api/src/index';
import { ACTIVITY_LIMITS } from '../../shared/activity-model';
import { CLAUDE_READER, claudeFolderName, readClaudeSession } from './claude';
import { CODEX_READER, codexSessionFolder, readCodexSession } from './codex';
import { projectFolder, type ReadResult } from './common';

/** Increment 95 (DD-061): where the agents keep their logs; both honour their own override variables. */
export interface ActivityHomes { claude: string; codex: string }
export function activityHomes(env: NodeJS.ProcessEnv = process.env): ActivityHomes {
  return { claude: env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), codex: env.CODEX_HOME || path.join(os.homedir(), '.codex') };
}
export const ACTIVITY_EXTRACTOR = { extractor: 'specular.activity', extractorVersion: '1' } as const;
export const ACTIVITY_DISABLED = 'Agent sessions are not read for this project. Turn on "Read agent sessions for this project" in Agent setup.';

type Candidate = { agent: 'claude' | 'codex'; file: string; size: number; mtimeMs: number };
const caseless = process.platform === 'win32' || process.platform === 'darwin';

async function jsonl(directory: string, depth: number): Promise<string[]> {
  let entries; try { entries = await readdir(directory, { withFileTypes: true }); } catch { return []; }
  const found: string[] = [];
  for (const e of entries) {
    const full = path.join(directory, e.name);
    if (e.isFile() && e.name.endsWith('.jsonl')) found.push(full);
    else if (e.isDirectory() && depth > 0) found.push(...await jsonl(full, depth - 1));
  }
  return found;
}

/** Reads the agents' logs of a project, re-reading only files whose size or modification time changed. */
export class ActivityReader {
  private results = new Map<string, { size: number; mtimeMs: number; result: ReadResult }>();
  private codexFolders = new Map<string, { size: number; mtimeMs: number; cwd?: string }>();
  private last?: { key: string; model: ActivityModel };
  private revision = 0;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private homes: ActivityHomes = activityHomes()) {}

  /** Calls are serialized; an unchanged project and log set returns the same model and revision. */
  model(root: string, enabled: boolean): Promise<ActivityModel> {
    const run = this.queue.then(() => this.build(root, enabled));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async candidates(root: string): Promise<Candidate[]> {
    const out: Candidate[] = [];
    const add = async (agent: Candidate['agent'], file: string) => { try { const s = await stat(file); out.push({ agent, file, size: s.size, mtimeMs: s.mtimeMs }); } catch { /* removed meanwhile */ } };
    // Claude Code: folders named after the root or a subfolder (a lossy encoding, so each log's cwd is checked too).
    const base = claudeFolderName(path.resolve(root)), projects = path.join(this.homes.claude, 'projects');
    const same = (a: string, b: string) => caseless ? a.toLowerCase() === b.toLowerCase() : a === b;
    let folders: string[] = []; try { folders = (await readdir(projects, { withFileTypes: true })).filter(e => e.isDirectory()).map(e => e.name); } catch { /* no Claude Code logs */ }
    for (const name of folders) if (same(name, base) || same(name.slice(0, base.length + 1), base + '-')) for (const file of await jsonl(path.join(projects, name), 0)) await add('claude', file);
    // Codex: one dated tree for every project; a rollout belongs to the project when its first record's cwd is inside the root.
    for (const file of await jsonl(path.join(this.homes.codex, 'sessions'), 4)) {
      let s; try { s = await stat(file); } catch { continue; }
      let known = this.codexFolders.get(file);
      if (!known || known.size !== s.size || known.mtimeMs !== s.mtimeMs) { known = { size: s.size, mtimeMs: s.mtimeMs, cwd: await codexSessionFolder(file).catch(() => undefined) }; this.codexFolders.set(file, known); }
      if (projectFolder(root, known.cwd) !== undefined) out.push({ agent: 'codex', file, size: s.size, mtimeMs: s.mtimeMs });
    }
    return out;
  }

  private async build(root: string, enabled: boolean): Promise<ActivityModel> {
    const envelope = { name: 'activity' as const, version: 1 as const, ready: true, provenance: { ...ACTIVITY_EXTRACTOR } };
    const candidates = enabled ? await this.candidates(root) : [];
    const key = JSON.stringify([path.resolve(root), enabled, candidates.map(c => [c.file, c.size, c.mtimeMs]).sort()]);
    if (this.last?.key === key) return this.last.model;
    const read: { agent: Candidate['agent']; result: ReadResult }[] = [];
    for (const c of candidates) {
      let cached = this.results.get(c.file);
      if (!cached || cached.size !== c.size || cached.mtimeMs !== c.mtimeMs) {
        const result = await (c.agent === 'claude' ? readClaudeSession(c.file, root) : readCodexSession(c.file, root)).catch(() => ({ skippedLines: 1, truncated: false } as ReadResult));
        cached = { size: c.size, mtimeMs: c.mtimeMs, result }; this.results.set(c.file, cached);
      }
      read.push({ agent: c.agent, result: cached.result });
    }
    const sources = new Map<Candidate['agent'], { agent: Candidate['agent']; reader: string; files: number; skippedLines: number; truncated: boolean }>();
    const source = (agent: Candidate['agent']) => { let s = sources.get(agent); if (!s) { s = { agent, reader: agent === 'claude' ? CLAUDE_READER : CODEX_READER, files: 0, skippedLines: 0, truncated: false }; sources.set(agent, s); } return s; };
    const found: AgentSession[] = [];
    for (const { agent, result } of read) {
      if (!result.session) continue;
      const s = source(agent); s.files++; s.skippedLines += result.skippedLines; s.truncated ||= result.truncated;
      found.push(result.session);
    }
    // Newest sessions first, within the session and total tool-call caps; duplicates (a session logged twice) keep the newest.
    found.sort((a, b) => b.started.localeCompare(a.started));
    const sessions: AgentSession[] = [], seen = new Set<string>();
    let budget: number = ACTIVITY_LIMITS.calls;
    for (const s of found) {
      const id = `${s.agent}:${s.id}`;
      if (seen.has(id)) continue;
      if (sessions.length === ACTIVITY_LIMITS.sessions || budget <= 0) { source(s.agent).truncated = true; continue; }
      seen.add(id);
      if (s.toolCalls <= budget) { sessions.push(s); budget -= s.toolCalls; continue; }
      let left = budget;
      const turns = s.turns.map(t => { const calls = t.toolCalls.slice(0, Math.max(0, left)); left -= calls.length; return { ...t, toolCalls: calls }; });
      const calls = turns.flatMap(t => t.toolCalls);
      sessions.push({ ...s, turns, toolCalls: calls.length, failures: calls.filter(c => c.outcome === 'error' || c.outcome === 'denied').length, truncated: true });
      source(s.agent).truncated = true; budget = 0;
    }
    const model: ActivityModel = { ...envelope, revision: ++this.revision, warnings: enabled ? [] : [ACTIVITY_DISABLED], enabled, sessions,
      sources: [...sources.values()].sort((a, b) => a.agent.localeCompare(b.agent)) as ActivitySource[] };
    this.last = { key, model };
    return model;
  }
}
