import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CONFIG_PATH, EMPTY_ID_CONFIGURATION, LEGACY_ID_CONFIGURATION, validateIdConfiguration, type IdConfigurationState, type ProjectProfileFile } from './id-configuration';

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
const absent = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
/** Separate from document access: .specular stays excluded from Markdown and code browsing. */
export class ProjectConfigurationStore {
  private valid = LEGACY_ID_CONFIGURATION;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly root: string) {}
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation); this.queue = result.catch(() => {}); return result;
  }
  private async target(create = false) {
    const directory = path.join(this.root, '.specular');
    if (create) await mkdir(directory, { recursive: true });
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error('The .specular directory must be a real project directory.');
    } catch (error) { if (!absent(error)) throw error; }
    const file = path.join(this.root, CONFIG_PATH);
    try { const info = await lstat(file); if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) throw new Error('project.json must be a regular file of at most 64 KB.'); }
    catch (error) { if (!absent(error)) throw error; }
    return file;
  }
  private async disk() {
    const file = await this.target();
    try {
      const bytes = await readFile(file);
      if (bytes.length > 65536) throw new Error('project.json exceeds 64 KB.');
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), version: digest(bytes.toString('base64')) };
    } catch (error) { if (absent(error)) return { text: undefined, version: 'absent' }; throw error; }
  }
  private async read(): Promise<IdConfigurationState> {
    let diskVersion = 'unavailable'; let warning: string | undefined;
    try {
      const disk = await this.disk(); diskVersion = disk.version;
      this.valid = disk.text === undefined ? EMPTY_ID_CONFIGURATION : validateIdConfiguration(JSON.parse(disk.text));
    } catch (error) { warning = `${CONFIG_PATH}: ${error instanceof SyntaxError ? 'Invalid JSON in project configuration.' : error instanceof Error ? error.message : error} Using the last valid rules (legacy defaults if none loaded). Repair the file and Refresh.`; }
    const profiles = await this.profiles();
    return { configuration: this.valid, revision: digest(JSON.stringify(this.valid)), diskVersion, ...(warning ? { warning } : {}), ...(profiles.length ? { profiles } : {}) };
  }
  /** Increment 97b: discovery profiles of this project, `.specular/profiles/*.json`: regular files of at most 64 KB, 16 at most. */
  private async profiles(): Promise<ProjectProfileFile[]> {
    const directory = path.join(this.root, '.specular', 'profiles');
    let names: string[];
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) return [{ file: '.specular/profiles', error: 'must be a real directory.' }];
      names = (await readdir(directory)).filter(name => name.toLowerCase().endsWith('.json')).sort((a, b) => a.localeCompare(b));
    } catch (error) { if (absent(error)) return []; return [{ file: '.specular/profiles', error: error instanceof Error ? error.message : String(error) }]; }
    const read = async (name: string): Promise<ProjectProfileFile> => {
      const file = `.specular/profiles/${name}`, full = path.join(directory, name);
      try {
        const info = await lstat(full);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 65536) return { file, error: 'must be a regular file of at most 64 KB.' };
        return { file, profile: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readFile(full))) };
      } catch (error) { return { file, error: error instanceof SyntaxError ? 'is not valid JSON.' : error instanceof Error ? error.message : String(error) }; }
    };
    return [...await Promise.all(names.slice(0, 16).map(read)), ...names.slice(16).map(name => ({ file: `.specular/profiles/${name}`, error: 'was skipped: a project has at most 16 profiles.' }))];
  }
  load() { return this.serialize(() => this.read()); }
  save(input: unknown, expectedVersion: string, checkCurrent?: () => Promise<void>): Promise<IdConfigurationState> {
    return this.serialize(async () => {
      const configuration = validateIdConfiguration(input);
      const content = JSON.stringify(configuration, null, 2) + '\n';
      if (Buffer.byteLength(content) > 65536) throw new Error('project.json exceeds 64 KB.');
      if ((await this.disk()).version !== expectedVersion) throw new Error('Project configuration changed on disk. Reload before saving; your draft is preserved.');
      const file = await this.target(true);
      const temporary = path.join(path.dirname(file), `.specular-save-${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, content, { flag: 'wx' });
        await checkCurrent?.();
        if ((await this.disk()).version !== expectedVersion) throw new Error('Project configuration changed on disk. Reload before saving; your draft is preserved.');
        await rename(temporary, file);
        return this.read();
      } finally { await unlink(temporary).catch(() => {}); }
    });
  }
}
