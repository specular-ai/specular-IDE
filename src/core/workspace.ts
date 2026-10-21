import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, stat, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { OpenDocument, SaveResult, WorkspaceSnapshot } from '../shared/types';
import { ProjectConfigurationStore } from './project-configuration';

import { EXCLUDED_FOLDERS as EXCLUDED } from './project-paths';
const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json', '.css', '.html', '.yml', '.yaml', '.toml', '.py', '.rs', '.go', '.java', '.cs', '.xml', '.svg', '.sql', '.sh', '.ps1']);
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_INDEX_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 2000;
const MAX_FOLDERS = 2000;
export const isMarkdown = (file: string) => /\.(md|markdown)$/i.test(file);
const hash = (value: Buffer) => createHash('sha256').update(value).digest('hex');
export const inside = (root: string, target: string) => {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};

export class Workspace {
  readonly configuration: ProjectConfigurationStore;
  private constructor(public readonly root: string) { this.configuration = new ProjectConfigurationStore(root); }
  private saving = new Set<string>();
  static async open(root: string): Promise<Workspace> {
    const canonical = await realpath(root);
    if (!(await stat(canonical)).isDirectory()) throw new Error('Choose a project folder.');
    return new Workspace(canonical);
  }
  async resolve(file: string): Promise<string> {
    if (!file || path.isAbsolute(file)) throw new Error('Use a relative project path.');
    const lexical = path.resolve(this.root, file);
    if (!inside(this.root, lexical)) throw new Error('This path is outside the open project.');
    const canonical = await realpath(lexical);
    if (!inside(this.root, canonical)) throw new Error('This link points outside the open project.');
    if (path.relative(this.root, canonical).split(path.sep).some(part => EXCLUDED.has(part.toLowerCase()))) {
      throw new Error('This path is in an excluded project folder.');
    }
    // Opening an alias must not inject a second identity/scope through an editor buffer.
    if (path.relative(lexical, canonical) !== '') throw new Error('Directory and file links are excluded from project documents. Open the canonical project path.');
    return canonical;
  }
  private async buffer(file: string): Promise<Buffer> {
    const size = await stat(file);
    if (!size.isFile()) throw new Error('This path is not a file.');
    if (size.size > MAX_FILE_BYTES) throw new Error('This prototype opens text files up to 2 MB.');
    const bytes = await readFile(file);
    if (bytes.includes(0)) throw new Error('Binary and UTF-16 files are not supported by this prototype.');
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new Error('This prototype opens UTF-8 text files only.'); }
    return bytes;
  }
  async read(file: string): Promise<OpenDocument> {
    const bytes = await this.buffer(await this.resolve(file));
    return { path: file, text: bytes.toString('utf8').replace(/^\uFEFF/, ''), version: hash(bytes) };
  }
  async createMarkdown(name: string): Promise<OpenDocument> {
    if (!name || name !== name.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name)) {
      throw new Error('Enter a filename without folders, surrounding spaces, or Windows-invalid characters.');
    }
    const file = /\.md$/i.test(name) || path.extname(name) ? name : `${name}.md`;
    if (!/\.md$/i.test(file) || !file.slice(0, -3).replace(/[. ]/g, '')) throw new Error('Use a filename with a .md extension.');
    if (file.length > 255 || /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?: *\.|$)/i.test(file)) {
      throw new Error('This filename is too long or reserved by Windows.');
    }
    try {
      // Exclusive creation refuses files, directories, and links, including concurrent creation.
      await writeFile(path.join(this.root, file), '', { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new Error(`“${file}” already exists. Choose another filename.`);
      throw new Error(`Could not create “${file}”. Check the project folder and write permissions.`);
    }
    return { path: file, text: '', version: hash(Buffer.alloc(0)) };
  }
  async save(file: string, text: string, version: string): Promise<SaveResult> {
    const target = await this.resolve(file);
    if (!isMarkdown(target)) throw new Error('Code files are read-only in this prototype.');
    if (this.saving.has(target)) throw new Error('A save is already in progress.');
    this.saving.add(target);
    let temporary: string | undefined;
    try {
      const before = await this.buffer(target);
      const conflict: SaveResult = { ok: false, reason: 'conflict', message: 'The file changed on disk. Your edits are preserved. Reload the disk version or copy your edits before reconciling.' };
      if (hash(before) !== version) return conflict;
      const original = before.toString('utf8');
      const eol = original.includes('\r\n') ? '\r\n' : '\n';
      const content = (original.startsWith('\uFEFF') ? '\uFEFF' : '') + text.replace(/\r\n|\r|\n/g, eol);
      if (Buffer.byteLength(content) > MAX_FILE_BYTES) throw new Error('The file exceeds the 2 MB prototype limit.');
      temporary = path.join(path.dirname(target), `.specular-save-${randomUUID()}.tmp`);
      await writeFile(temporary, content, { flag: 'wx', mode: (await stat(target)).mode });
      if (hash(await this.buffer(target)) !== version) return conflict;
      await rename(temporary, target);
      temporary = undefined;
      return { ok: true, document: { path: file, text: content.replace(/^\uFEFF/, ''), version: hash(Buffer.from(content)) } };
    } finally {
      if (temporary) await unlink(temporary).catch(() => undefined);
      this.saving.delete(target);
    }
  }
  async resolveLink(from: string, href: string): Promise<{ path: string; anchor: string }> {
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) throw new Error('Only links to files inside this project open in the prototype.');
    const split = href.indexOf('#');
    const filePart = decodeURIComponent(split < 0 ? href : href.slice(0, split));
    const anchor = decodeURIComponent(split < 0 ? '' : href.slice(split + 1));
    const target = filePart ? path.resolve(this.root, path.dirname(from), filePart) : path.resolve(this.root, from);
    const relative = path.relative(this.root, target).split(path.sep).join('/');
    await this.resolve(relative);
    return { path: relative, anchor };
  }
  async saveConfiguration(input: unknown, expectedVersion: string, expectedDocuments: unknown, isCurrent = () => true) {
    if (!expectedDocuments || typeof expectedDocuments !== 'object' || Array.isArray(expectedDocuments) || Object.keys(expectedDocuments).length > 2000 ||
        Object.entries(expectedDocuments).some(([file, version]) => file.length > 4096 || typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version))) throw new Error('Invalid configuration preview document versions.');
    const expected = expectedDocuments as Record<string, string>;
    return this.configuration.save(input, expectedVersion, async () => {
      if (!isCurrent()) throw new Error('The active project changed. Reopen Project configuration.');
      const current = (await this.snapshot(false)).documentVersions!;
      if (Object.keys(current).length !== Object.keys(expected).length || Object.entries(current).some(([file, version]) => expected[file] !== version)) {
        throw new Error('Markdown changed on disk. Refresh the preview before applying; your draft is preserved.');
      }
      if (!isCurrent()) throw new Error('The active project changed. Reopen Project configuration.');
    });
  }
  async snapshot(includeConfiguration = true): Promise<WorkspaceSnapshot> {
    const snapshot: WorkspaceSnapshot = { root: this.root, name: path.basename(this.root), files: [], folders: [], documents: {}, warnings: [] };
    snapshot.documentVersions = {};
    if (includeConfiguration) {
      snapshot.idConfiguration = await this.configuration.load();
      if (snapshot.idConfiguration.warning) snapshot.warnings.push(snapshot.idConfiguration.warning);
    }
    let bytes = 0;
    let capped = false;
    let foldersCapped = false;
    const scan = async (directory: string): Promise<void> => {
      let entries;
      try { entries = await readdir(directory, { withFileTypes: true }); }
      catch { snapshot.warnings.push(`Could not read ${path.relative(this.root, directory) || '.'}.`); return; }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (snapshot.files.length >= MAX_FILES) { capped = true; break; }
        if (entry.isSymbolicLink() || EXCLUDED.has(entry.name.toLowerCase())) continue;
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (snapshot.folders.length >= MAX_FOLDERS) { foldersCapped = true; continue; }
          snapshot.folders.push(path.relative(this.root, full).split(path.sep).join('/'));
          await scan(full); continue;
        }
        if (!entry.isFile() || (!TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) && !['.gitignore', '.editorconfig'].includes(entry.name))) continue;
        const relative = path.relative(this.root, full).split(path.sep).join('/');
        const markdown = isMarkdown(relative);
        snapshot.files.push({ path: relative, markdown, configuration: /^(AGENTS|CLAUDE)\.md$/i.test(entry.name) });
        if (markdown) {
          try {
            const document = await this.read(relative);
            bytes += Buffer.byteLength(document.text);
            if (bytes > MAX_INDEX_BYTES) { snapshot.warnings.push(`${relative}: skipped; the Markdown index limit is 20 MB.`); continue; }
            snapshot.documents[relative] = document.text;
            snapshot.documentVersions![relative] = document.version;
          } catch (error) { snapshot.warnings.push(`${relative}: ${error instanceof Error ? error.message : error}`); }
        }
      }
    };
    await scan(this.root);
    if (capped) snapshot.warnings.push('The explorer is limited to 2,000 text files in this prototype.');
    if (foldersCapped) snapshot.warnings.push('The explorer is limited to 2,000 folders in this prototype; additional folders and their contents were skipped.');
    snapshot.files.sort((a, b) => Number(b.markdown) - Number(a.markdown) || a.path.localeCompare(b.path));
    return snapshot;
  }
}
