#!/usr/bin/env node
import { readFile, lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateManifest } from '../dist/index.js';

// Static validation only: never import or execute the package entry.
export async function validatePackage(directory) {
  const root = await realpath(directory);
  async function regularFile(relative) {
    let current = root;
    const segments = relative.split('/');
    for (let i = 0; i < segments.length; i++) {
      current = path.join(current, segments[i]);
      const stat = await lstat(current);
      if (stat.isSymbolicLink() || (i === segments.length - 1 ? !stat.isFile() : !stat.isDirectory()))
        throw new Error(`Expected ordinary package file: ${relative}`);
    }
    return current;
  }
  const manifestPath = await regularFile('specular-plugin.json');
  if ((await lstat(manifestPath)).size > 65536) throw new Error('Manifest exceeds 64 KiB.');
  const result = validateManifest(JSON.parse(await readFile(manifestPath, 'utf8')));
  if (!result.ok) throw new Error(result.errors.join(' '));
  await regularFile(result.manifest.entry);
  const packagePath = await regularFile('package.json');
  if ((await lstat(packagePath)).size > 65536) throw new Error('package.json exceeds 64 KiB.');
  const metadata = JSON.parse(await readFile(packagePath, 'utf8'));
  if (metadata.type !== 'module') throw new Error('package.json must declare type: module.');
  return result.manifest;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: specular-plugin-validate <package-directory>');
    const manifest = await validatePackage(process.argv[2]);
    console.log(`Valid: ${manifest.id}@${manifest.version} (${manifest.views.length} view(s))`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Package validation failed.');
    process.exitCode = 1;
  }
}
