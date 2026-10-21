import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, readFile } from 'node:fs/promises';
import path from 'node:path';
import { checkVersion, discoverAgent } from '../src/core/agent-discovery';

async function fixture(body: string, name = 'codex') {
  const base = path.resolve('.cache/agent-tests'); await mkdir(base, { recursive: true });
  const cwd = await mkdtemp(path.join(base, 'run-'));
  const file = path.join(cwd, `${name}${process.platform === 'win32' ? '.cmd' : ''}`);
  await writeFile(file, process.platform === 'win32' ? `@echo off\r\n${body}\r\n` : `#!/bin/sh\n${body}\n`);
  await chmod(file, 0o755);
  return { file, cwd, env: { ...process.env, PATH: cwd, Path: undefined } };
}
test('finds agents on PATH, checks identity, and honors an explicit path containing spaces and ampersands', async () => {
  const options = await fixture('echo codex-cli 1.2.3');
  const found = await discoverAgent('codex', '', options);
  assert.equal(found.status, 'detected'); assert.equal(found.path, options.file); assert.equal(found.version, 'codex-cli 1.2.3');
  const directory = path.join(options.cwd, 'space & directory'); await mkdir(directory);
  const explicit = path.join(directory, path.basename(options.file)); await writeFile(explicit, await readFile(options.file)); await chmod(explicit, 0o755);
  assert.equal((await discoverAgent('codex', explicit, options)).status, 'detected');
  assert.equal((await discoverAgent('claude', explicit, options)).status, 'failed');
  const claude = await fixture(process.platform === 'win32' ? 'echo 2.0.0 (Claude Code)' : "echo '2.0.0 (Claude Code)'", 'claude');
  assert.equal((await discoverAgent('claude', '', claude)).status, 'detected');
});
test('reports missing and invalid paths and does not execute project or relative PATH candidates', async () => {
  const options = await fixture('echo codex-cli 1.2.3');
  assert.equal((await discoverAgent('codex', '', { ...options, projectRoot: options.cwd })).status, 'missing');
  assert.equal((await discoverAgent('codex', '', { ...options, env: { PATH: '.' } })).status, 'missing');
  for (const value of ['codex', '"bad"', options.cwd, path.join(options.cwd, 'missing.exe'), `${options.file} --help`]) {
    assert.equal((await discoverAgent('codex', value, options)).status, 'invalid');
  }
});
test('reports nonzero exit and successful commands without an agent version', async () => {
  const failed = await fixture(process.platform === 'win32' ? 'exit /b 7' : 'exit 7');
  const result = await discoverAgent('codex', failed.file, failed);
  assert.equal(result.status, 'failed'); assert.match(result.message, /exit 7/);
  const wrong = await fixture('echo unrelated');
  assert.equal((await discoverAgent('codex', wrong.file, wrong)).status, 'failed');
});
test('bounds output and terminates timed-out and cancelled checks', async () => {
  const infinite = process.platform === 'win32' ? ':loop\r\ngoto loop' : 'while true; do :; done';
  const options = await fixture(infinite);
  assert.equal((await discoverAgent('codex', options.file, { ...options, timeoutMs: 150 })).status, 'timeout');
  const controller = new AbortController();
  const pending = checkVersion(options.file, { ...options, signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  assert.match((await pending).message, /cancelled/);
  const verbose = await fixture(process.platform === 'win32' ? ':loop\r\necho too much output\r\ngoto loop' : 'while true; do echo too much output; done');
  assert.match((await checkVersion(verbose.file, verbose)).message, /too much output/);
});
test('rejects expandable Windows launcher paths before execution', { skip: process.platform !== 'win32' }, async () => {
  const options = await fixture('echo codex-cli 1.2.3', 'codex%PATH%');
  assert.equal((await discoverAgent('codex', options.file, options)).status, 'invalid');
});
test('terminates a descendant process when a launcher times out', async () => {
  const options = await fixture('');
  const script = path.join(options.cwd, 'child.cjs');
  await writeFile(script, 'console.log(process.pid); setInterval(() => {}, 1000);');
  await writeFile(options.file, process.platform === 'win32'
    ? `@echo off\r\n"${process.execPath}" "${script}"\r\n`
    : `#!/bin/sh\n"${process.execPath}" "${script}"\n`);
  const checked = await checkVersion(options.file, { ...options, timeoutMs: 1000 });
  assert.equal(checked.status, 'timeout');
  const pid = Number(checked.output); assert.ok(Number.isInteger(pid) && pid > 0);
  try { assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }); }
  finally { try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ } }
});
test('reports an unusable native executable as a launch failure', { skip: process.platform !== 'win32' }, async () => {
  const options = await fixture('');
  const file = path.join(options.cwd, 'broken.exe'); await writeFile(file, 'not an executable');
  assert.equal((await discoverAgent('codex', file, options)).status, 'failed');
});
