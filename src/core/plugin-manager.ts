import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import extractZip from 'extract-zip';
import { API_VERSION, type PluginManifest } from '../../packages/plugin-api/src/index';
import { readPluginPackage } from './plugin-package';

export interface InstalledPlugin {
  manifest: PluginManifest;
  enabled: boolean;
  status: 'ready' | 'invalid';
  message?: string;
  bundledVersion?: string;
  origin?: 'bundled' | 'installed';
  revision?: number;
}
type StateEntry = { id: string; enabled: boolean; origin?: 'bundled' | 'installed' };
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-z][a-z0-9-]*\.[a-z][a-z0-9-]*$/.test(value) && value.length <= 128;

export class PluginManager {
  private entries = new Map<string, InstalledPlugin>();
  private packages = new Map<string, Awaited<ReturnType<typeof readPluginPackage>>>();
  private bundles = new Map<string, Awaited<ReturnType<typeof readPluginPackage>>>();
  private revisions = new Map<string, number>();
  private constructor(private root: string, private stateFile: string) {}

  static async load(root: string, bundledRoots: readonly string[] = []) {
    const manager = new PluginManager(root, path.join(root, 'installed.json'));
    await mkdir(root, { recursive: true });
    for (const bundledRoot of bundledRoots) {
      const plugin = await readPluginPackage(bundledRoot);
      if (manager.bundles.has(plugin.manifest.id)) throw new Error('Duplicate bundled plugin identity.');
      manager.bundles.set(plugin.manifest.id, plugin);
    }
    let state: StateEntry[] = [];
    try {
      if ((await stat(manager.stateFile)).size > 256 * 1024) throw new Error('Plugin registry exceeds its size limit.');
      const parsed: unknown = JSON.parse(await readFile(manager.stateFile, 'utf8'));
      if (!Array.isArray(parsed) || parsed.length > 100) throw new Error('Invalid plugin registry.');
      state = parsed.filter((entry): entry is StateEntry => !!entry && typeof entry === 'object' && validId((entry as StateEntry).id) && typeof (entry as StateEntry).enabled === 'boolean');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Installed plugins could not be read. The registry was left unchanged.');
    }
    for (const entry of state) {
      if (manager.entries.has(entry.id)) continue;
      try {
        const bundle = manager.bundles.get(entry.id);
        const plugin = entry.origin === 'bundled' ? bundle : await readPluginPackage(path.join(root, entry.id));
        if (!plugin) throw new Error('Bundled plugin is unavailable in this application version.');
        if (plugin.manifest.id !== entry.id) throw new Error('Installed package identity does not match its registry entry.');
        manager.entries.set(entry.id, { manifest: plugin.manifest, enabled: entry.enabled, status: 'ready', origin: entry.origin === 'bundled' ? 'bundled' : 'installed', ...(bundle ? { bundledVersion: bundle.manifest.version } : {}) });
        if (entry.enabled) manager.packages.set(entry.id, plugin);
      } catch (error) {
        const bundle = manager.bundles.get(entry.id);
        manager.entries.set(entry.id, { manifest: { manifestVersion: 1, id: entry.id, version: '0.0.0', api: API_VERSION, entry: 'invalid.js', capabilities: ['workspace.read'], models: ['physical@1'], views: [{ id: 'invalid', title: entry.id, kind: 'list' }] }, enabled: entry.enabled, origin: entry.origin === 'bundled' ? 'bundled' : 'installed', ...(bundle ? { bundledVersion: bundle.manifest.version } : {}), status: 'invalid', message: error instanceof Error ? error.message : 'Invalid installed package.' });
      }
    }
    let added = false;
    for (const [id, plugin] of manager.bundles) if (!manager.entries.has(id)) {
      manager.entries.set(id, { manifest: plugin.manifest, enabled: true, status: 'ready', origin: 'bundled', bundledVersion: plugin.manifest.version });
      manager.packages.set(id, plugin); added = true;
    }
    if (added) await manager.save(manager.entries);
    return manager;
  }

  list() { return [...this.entries.values()].map(entry => ({ ...structuredClone(entry), revision: this.revisions.get(entry.manifest.id) ?? 0 })); }
  package(id: string) { return this.packages.get(id); }

  private async save(entries: Map<string, InstalledPlugin>) {
    const temporary = `${this.stateFile}.${randomUUID()}.tmp`;
    const state = [...entries.values()].map(entry => ({ id: entry.manifest.id, enabled: entry.enabled, origin: entry.origin ?? 'installed' }));
    try { await writeFile(temporary, JSON.stringify(state, null, 2) + '\n', { flag: 'wx' }); await rename(temporary, this.stateFile); }
    finally { await rm(temporary, { force: true }); }
  }

  private async inspectTree(root: string) {
    let files = 0, bytes = 0;
    const visit = async (directory: string) => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name); const info = await lstat(file);
        if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory())) throw new Error('Plugin packages may contain only ordinary files and directories.');
        if (info.isDirectory()) await visit(file);
        else { files++; bytes += info.size; if (files > 1000 || bytes > 10 * 1024 * 1024) throw new Error('Plugin package exceeds installation limits.'); }
      }
    };
    await visit(root);
  }

  private async stage(source: string) {
    const work = path.join(this.root, `.stage-${randomUUID()}`), unpacked = path.join(work, 'source'), output = path.join(work, 'package');
    await mkdir(unpacked, { recursive: true });
    try {
      const info = await lstat(source);
      let packageRoot: string;
      if (info.isDirectory()) packageRoot = source;
      else if (info.isFile() && path.extname(source).toLowerCase() === '.zip') {
        if (info.size > 5 * 1024 * 1024) throw new Error('Plugin archive exceeds the 5 MB limit.');
        let entries = 0, unpackedBytes = 0;
        await extractZip(source, { dir: unpacked, onEntry: entry => {
          entries++; unpackedBytes += entry.uncompressedSize;
          if (entries > 1000 || unpackedBytes > 10 * 1024 * 1024) throw new Error('Plugin archive expands beyond installation limits.');
        } });
        await this.inspectTree(unpacked); packageRoot = unpacked;
      } else throw new Error('Choose a plugin folder or .zip archive.');
      const plugin = await readPluginPackage(packageRoot);
      await mkdir(path.dirname(path.join(output, plugin.manifest.entry)), { recursive: true });
      await Promise.all([
        cp(path.join(packageRoot, 'specular-plugin.json'), path.join(output, 'specular-plugin.json')),
        cp(path.join(packageRoot, 'package.json'), path.join(output, 'package.json')),
        cp(path.join(packageRoot, ...plugin.manifest.entry.split('/')), path.join(output, ...plugin.manifest.entry.split('/'))),
      ]);
      return { work, output, plugin };
    } catch (error) { await rm(work, { recursive: true, force: true }); throw error; }
  }

  async install(source: string, replace = false) {
    const staged = await this.stage(source); const id = staged.plugin.manifest.id;
    try {
      if (this.entries.has(id) && !replace) return { installed: false as const, manifest: staged.plugin.manifest };
      const target = path.join(this.root, id), backup = path.join(this.root, `.backup-${randomUUID()}`);
      const current = this.entries.get(id);
      const existed = await lstat(target).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
      const next = new Map(this.entries);
      const enabled = this.bundles.has(id) ? current?.enabled ?? true : true;
      next.set(id, { manifest: staged.plugin.manifest, enabled, status: 'ready', origin: 'installed', ...(this.bundles.has(id) ? { bundledVersion: this.bundles.get(id)!.manifest.version } : {}) });
      if (existed) await rename(target, backup);
      try {
        await rename(staged.output, target);
        try { await this.save(next); }
        catch (error) { await rm(target, { recursive: true, force: true }); if (existed) await rename(backup, target); throw error; }
      } catch (error) { if (existed) await rename(backup, target).catch(() => undefined); throw error; }
      await rm(backup, { recursive: true, force: true });
      this.entries = next; if (enabled) this.packages.set(id, staged.plugin); else this.packages.delete(id);
      this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
      return { installed: true as const, manifest: staged.plugin.manifest };
    } finally { await rm(staged.work, { recursive: true, force: true }); }
  }

  async setEnabled(id: string, enabled: boolean) {
    const current = this.entries.get(id); if (!current || current.status !== 'ready') throw new Error('Unknown or invalid plugin.');
    const plugin = enabled ? current.origin === 'bundled' ? this.bundles.get(id) : await readPluginPackage(path.join(this.root, id)) : undefined;
    if (enabled && (!plugin || plugin.manifest.id !== id)) throw new Error('Plugin identity changed or package is unavailable.');
    const next = new Map(this.entries); next.set(id, { ...current, enabled }); await this.save(next); this.entries = next;
    if (plugin) this.packages.set(id, plugin); else this.packages.delete(id);
  }

  async uninstall(id: string) {
    if (this.bundles.has(id)) throw new Error('Bundled plugins can be disabled or restored, not uninstalled.');
    if (!this.entries.has(id)) throw new Error('Unknown plugin.');
    const target = path.join(this.root, id), removed = path.join(this.root, `.removed-${randomUUID()}`), next = new Map(this.entries); next.delete(id);
    let moved = true;
    try { await rename(target, removed); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') moved = false; else throw error; }
    try { await this.save(next); }
    catch (error) { if (moved) await rename(removed, target); throw error; }
    this.entries = next; this.packages.delete(id); if (moved) await rm(removed, { recursive: true, force: true });
  }

  async restoreBundled(id: string) {
    const plugin = this.bundles.get(id), current = this.entries.get(id);
    if (!plugin || !current) throw new Error('Unknown bundled plugin.');
    const next = new Map(this.entries);
    next.set(id, { manifest: plugin.manifest, enabled: current.enabled, status: 'ready', origin: 'bundled', bundledVersion: plugin.manifest.version });
    await this.save(next);
    this.entries = next;
    this.revisions.set(id, (this.revisions.get(id) ?? 0) + 1);
    if (current.enabled) this.packages.set(id, plugin); else this.packages.delete(id);
    // Retain any overridden package on disk for recovery; the registry selects the bundle.
  }
}
