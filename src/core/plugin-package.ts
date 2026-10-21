import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { validateManifest } from '../../packages/plugin-api/src/index';
export async function readPluginPackage(directory: string) {
  const root = await realpath(directory);
  async function read(relative: string, limit: number) {
    let file = root;
    const parts = relative.split('/');
    for (let i = 0; i < parts.length; i++) {
      file = path.join(file, parts[i]); const stat = await lstat(file);
      if (stat.isSymbolicLink() || (i === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) throw new Error('Plugin paths must be ordinary files and directories.');
      if (i === parts.length - 1 && stat.size > limit) throw new Error('Plugin file exceeds size limit.');
    }
    const resolved = await realpath(file);
    if (!resolved.startsWith(root + path.sep)) throw new Error('Plugin path escapes its package.');
    const bytes = await readFile(file);
    if (bytes.length > limit) throw new Error('Plugin file exceeds size limit.');
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }
  const validation = validateManifest(JSON.parse(await read('specular-plugin.json', 65536)));
  if (!validation.ok) throw new Error(validation.errors.join(' '));
  if (JSON.parse(await read('package.json', 65536)).type !== 'module') throw new Error('Plugin package must declare type: module.');
  return { manifest: validation.manifest, code: await read(validation.manifest.entry, 1024 * 1024) };
}
