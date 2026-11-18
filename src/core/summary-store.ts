import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { SummarySubject } from '../../packages/plugin-api/src/index';
import { canonicalSubject, validStoredSummary, type StoredSummary } from './summaries';
import { inside } from './workspace';

/**
 * Increment 94 (DD-060): summaries are Specular-owned JSON in the project, `.specular/summaries/<kind>/<key>.json`.
 * A feature uses its key when it is a plain name; an ID set, and any other key, uses the first 16 hex digits of SHA-256.
 */
export function summaryFile(subject: SummarySubject): string {
  const canonical = canonicalSubject(subject);
  const hash = (value: string) => createHash('sha256').update(value).digest('hex').slice(0, 16);
  const key = canonical.kind === 'feature' ? (/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(canonical.key) ? canonical.key : hash(canonical.key)) : hash(JSON.stringify(canonical.keys));
  return path.join('.specular', 'summaries', canonical.kind, `${key}.json`);
}
async function target(root: string, subject: SummarySubject) {
  const file = path.join(root, summaryFile(subject));
  // `.specular` is Specular's own folder; never follow it out of the project.
  const specular = path.join(root, '.specular');
  try { if (!inside(root, await realpath(specular))) throw new Error('The .specular folder points outside the project.'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  return file;
}
export async function readSummary(root: string, subject: SummarySubject): Promise<StoredSummary | undefined> {
  const file = await target(root, subject);
  try {
    if ((await stat(file)).size > 1024 * 1024) return;
    const value = JSON.parse(await readFile(file, 'utf8'));
    return validStoredSummary(value) && JSON.stringify(canonicalSubject(value.subject)) === JSON.stringify(canonicalSubject(subject)) ? value : undefined;
  } catch { return; }
}
export async function writeSummary(root: string, summary: StoredSummary): Promise<void> {
  if (!validStoredSummary(summary)) throw new Error('Invalid summary record.');
  const file = await target(root, summary.subject), temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  try { await writeFile(temporary, JSON.stringify({ ...summary, subject: canonicalSubject(summary.subject) }, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, file); }
  catch (error) { await unlink(temporary).catch(() => undefined); throw new Error(`Could not save the summary: ${(error as Error).message}`); }
}
