import { parseTheme, validTheme, type ThemeMode } from '../shared/appearance';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RecentProjectsState, WorkspaceSession } from '../shared/types';
import { parseFontSizes, validFontSize, type FontSizes } from '../shared/font-sizes';

const identity = (root: string) => process.platform === 'win32' ? path.resolve(root).toLowerCase() : path.resolve(root);
const validRoot = (root: unknown): root is string => typeof root === 'string' && root.length <= 4096 && !/[\x00-\x1f]/.test(root) && path.isAbsolute(root);
export function parseWorkspaceSession(value: unknown): WorkspaceSession | undefined {
  if (!value || typeof value !== 'object') return;
  const { files, activeFile } = value as WorkspaceSession;
  if (!Array.isArray(files) || files.length > 100 || files.some(file => typeof file !== 'string' || !file || file.length > 4096 ||
    /[\x00-\x1f:]/.test(file) || /^[\\/]/.test(file) || file.split(/[\\/]/).some(part => part === '..'))) return;
  const normalized = [...new Set(files.map(file => file.replace(/\\/g, '/')))];
  return { files: normalized, activeFile: typeof activeFile === 'string' && normalized.includes(activeFile.replace(/\\/g, '/')) ? activeFile.replace(/\\/g, '/') : normalized[0] };
}
type SavedSession = WorkspaceSession & { root: string };

export class Settings {
  private data: Record<string, unknown> = { version: 1 };
  private state: RecentProjectsState = { projects: [] };
  private writable = true;
  private backup = false;
  private queue: Promise<unknown> = Promise.resolve();
  private constructor(private readonly file: string) {}

  static async load(file: string): Promise<Settings> {
    const settings = new Settings(file);
    try {
      if ((await stat(file)).size > 1024 * 1024) throw new Error('Settings exceed the 1 MB limit.');
      let data;
      try { data = JSON.parse(await readFile(file, 'utf8')); }
      catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        settings.backup = true;
        settings.state.warning = 'Settings contain invalid JSON. Recent projects start empty; the original will be backed up before saving.';
        return settings;
      }
      if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1) {
        settings.writable = false;
        settings.state.warning = 'Settings have an unsupported format or version. Recent-project changes cannot be saved.';
        return settings;
      }
      settings.data = data;
      if (data.lastProject !== undefined && !validRoot(data.lastProject)) {
        delete settings.data.lastProject;
        settings.state.warning = 'Invalid last-project settings were ignored.';
      }
      const sessions: SavedSession[] = [];
      if (Array.isArray(data.workspaceSessions)) {
        for (const entry of data.workspaceSessions) {
          const session = parseWorkspaceSession(entry);
          if (!session || !validRoot(entry.root) || sessions.some(saved => identity(saved.root) === identity(entry.root))) continue;
          sessions.push({ root: entry.root, ...session });
          if (sessions.length === 10) break;
        }
      }
      if (data.workspaceSessions !== undefined && (!Array.isArray(data.workspaceSessions) || sessions.length !== data.workspaceSessions.length)) {
        settings.state.warning = 'Invalid, duplicate, or excess workspace sessions were ignored.';
      }
      settings.data.workspaceSessions = sessions;
      const entries = Array.isArray(data.recentProjects) ? data.recentProjects : [];
      const seen = new Set<string>();
      for (const entry of entries) {
        if (!entry || typeof entry.path !== 'string' || entry.path.length > 4096 || /[\x00-\x1f]/.test(entry.path) || !path.isAbsolute(entry.path)) continue;
        const root = path.normalize(entry.path), key = identity(root);
        if (seen.has(key)) continue;
        seen.add(key);
        settings.state.projects.push({ path: root, name: path.basename(root) || root });
        if (settings.state.projects.length === 10) break;
      }
      if (data.recentProjects !== undefined && (!Array.isArray(data.recentProjects) || entries.length !== settings.state.projects.length)) {
        settings.state.warning = 'Invalid, duplicate, or excess recent-project entries were ignored.';
      }
      settings.data.recentProjects = settings.state.projects;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        settings.writable = false;
        settings.state.warning = 'Settings could not be read. Recent-project changes cannot be saved.';
      }
    }
    return settings;
  }

  snapshot(): RecentProjectsState { return structuredClone(this.state); }
  theme(): ThemeMode { return parseTheme(this.data.theme); }
  async saveTheme(value: unknown): Promise<{ ok: boolean; message?: string }> {
    if (!validTheme(value)) throw new Error('Appearance must be dark or light.');
    const result = await this.update(data => ({ ...data, theme: value }));
    return result.warning ? { ok: false, message: 'Appearance applies for this session but could not be saved. ' + result.warning } : { ok: true };
  }
  fontSizes(): FontSizes { return parseFontSizes(this.data.fontSizes); }
  async saveFontSizes(value: unknown): Promise<{ ok: boolean; message?: string }> {
    const sizes = value as FontSizes | undefined;
    if (!sizes || Array.isArray(sizes) || !validFontSize(sizes.source) || !validFontSize(sizes.preview)) {
      throw new Error('Font sizes must be whole numbers between 10 and 32 px.');
    }
    const fontSizes = { source: sizes.source, preview: sizes.preview };
    const result = await this.update(data => ({ ...data, fontSizes }));
    return result.warning ? { ok: false, message: 'Font sizes apply for this session but could not be saved. ' + result.warning } : { ok: true };
  }
  contains(root: string) { return this.state.projects.some(project => identity(project.path) === identity(root)); }
  lastProject(): string | undefined { return validRoot(this.data.lastProject) ? this.data.lastProject : undefined; }
  workspaceSession(root: string): WorkspaceSession | undefined {
    const saved = (this.data.workspaceSessions as SavedSession[] | undefined)?.find(session => identity(session.root) === identity(root));
    return saved ? { files: [...saved.files], activeFile: saved.activeFile } : undefined;
  }
  async flush() { await this.queue; }
  saveWorkspaceSession(root: string, session: WorkspaceSession) {
    const valid = parseWorkspaceSession(session);
    if (!valid || !validRoot(root)) throw new Error('Invalid workspace session. Keep at most 100 open tabs.');
    return this.update(data => ({ ...data, workspaceSessions: [{ root, ...valid },
      ...((data.workspaceSessions ?? []) as SavedSession[]).filter(saved => identity(saved.root) !== identity(root))].slice(0, 10) }));
  }
  record(canonicalRoot: string) {
    return this.update(data => ({ ...data, lastProject: canonicalRoot, recentProjects: [{ path: canonicalRoot, name: path.basename(canonicalRoot) || canonicalRoot },
      ...this.state.projects.filter(project => identity(project.path) !== identity(canonicalRoot))].slice(0, 10) }));
  }
  remove(root: string) { return this.update(data => ({ ...data, recentProjects: this.state.projects.filter(project => identity(project.path) !== identity(root)) })); }
  clear() { return this.update(data => ({ ...data, recentProjects: [] })); }

  private update(change: (data: Record<string, unknown>) => Record<string, unknown>): Promise<RecentProjectsState> {
    const operation = this.queue.then(async () => {
      if (!this.writable) return this.snapshot();
      const data: Record<string, unknown> = { ...change(this.data), version: 1 };
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        await mkdir(path.dirname(this.file), { recursive: true });
        if (this.backup) {
          await copyFile(this.file, `${this.file}.invalid-${randomUUID()}.bak`);
          this.backup = false;
        }
        const content = JSON.stringify(data, null, 2) + '\n';
        if (Buffer.byteLength(content) > 1024 * 1024) throw new Error('Settings exceed the 1 MB limit.');
        await writeFile(temporary, content, { flag: 'wx' });
        await rename(temporary, this.file);
        this.data = data; this.state = { projects: (data.recentProjects ?? []) as RecentProjectsState['projects'] };
      } catch {
        this.state.warning = 'Settings could not be saved. Check the settings folder, write permissions, and 1 MB size limit; previous settings are retained.';
      } finally { await unlink(temporary).catch(() => undefined); }
      return this.snapshot();
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
