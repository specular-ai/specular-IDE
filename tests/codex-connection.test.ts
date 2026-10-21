import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { CodexConnection, codexEnvironment } from '../src/core/codex-connection';

async function fixture(storage = 'ephemeral', delayed = false) {
  const base = path.resolve('.cache/codex-auth-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-')); const userData = path.join(root, 'user-data'); await mkdir(userData);
  const script = path.join(root, 'runtime.cjs'); const executable = path.join(root, 'codex.cmd');
  await writeFile(executable, `@echo off\r\nif "%~1"=="--version" (\r\necho codex-cli 0.154.0\r\nexit /b 0\r\n)\r\n"${process.execPath}" "${script}"\r\n`);
  await writeFile(script, `const fs = require('node:fs'); const path = require('node:path');
    const log = ${JSON.stringify(path.join(root, 'methods.json'))}; let methods = []; let loggedIn = false;
    const send = m => process.stdout.write(JSON.stringify(m) + '\\n');
    require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
      const m = JSON.parse(line); if (!m.method) return;
      methods.push(m.method); fs.writeFileSync(log, JSON.stringify(methods));
      if (!m.id) return;
      let result = {};
      if (m.method === 'initialize' && ${delayed}) return;
      if (m.method === 'config/read') result = { config: { cli_auth_credentials_store: ${JSON.stringify(storage)} } };
      if (m.method === 'account/read') result = { account: loggedIn ? { type: 'apiKey' } : null };
      if (m.method === 'account/login/start') {
        if (m.params.apiKey.includes('refuse')) { send({ id: m.id, error: { code: -32000, message: 'rejected ' + m.params.apiKey } }); return; }
        loggedIn = true; send({ method: 'account/login/completed', params: { success: true } }); result = { type: 'apiKey' };
      }
      send({ id: m.id, result });
    });`);
  return { root, userData, executable };
}
export async function fileContents(root: string): Promise<Buffer[]> {
  const buffers: Buffer[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) buffers.push(...await fileContents(file)); else if (entry.isFile()) {
      // Windows byte-range locks can make even an empty lockfile unreadable. Empty files cannot contain a key.
      if ((await stat(file)).size === 0) continue;
      try { buffers.push(await readFile(file)); } catch (error) { throw new Error(`Could not inspect ${file}`, { cause: error }); }
    }
  }
  return buffers;
}
test('Codex environment excludes inherited credentials, configuration overrides, and Node hooks', () => {
  const env = codexEnvironment('C:\\isolated', { PATH: 'tools', OPENAI_API_KEY: 'secret', CODEX_HOME: 'other', NODE_OPTIONS: '--require evil', CODEX_CONFIG: 'unsafe' });
  assert.equal(env.PATH, 'tools'); assert.equal(env.OPENAI_API_KEY, undefined); assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.CODEX_CONFIG, undefined); assert.equal(env.CODEX_HOME, 'C:\\isolated\\.codex');
});
test('Codex connects, refreshes, disconnects and reconnects without persisting or returning the key', async () => {
  const { userData, executable } = await fixture(); const states: unknown[] = [];
  const connection = new CodexConnection(userData, state => states.push(state)); const key = 'sk-test-memory-only';
  try {
    assert.equal((await connection.connect(executable, '')).status, 'error');
    assert.equal((await connection.connect(executable, key)).status, 'connected');
    assert.equal((await connection.refresh()).status, 'connected');
    assert.equal((await connection.disconnect()).status, 'disconnected');
    assert.equal((await connection.connect(executable, key)).status, 'connected');
    assert.ok(!JSON.stringify(states).includes(key));
    for (const buffer of await fileContents(userData)) assert.equal(buffer.includes(key), false);
  } finally { await connection.disconnect(); }
});
test('Codex rejection never exposes raw secret-bearing errors and permits retry', async () => {
  const { userData, executable } = await fixture(); const connection = new CodexConnection(userData, () => {});
  try {
    const result = await connection.connect(executable, 'sk-refuse-sensitive');
    assert.equal(result.status, 'error'); assert.ok(!JSON.stringify(result).includes('sk-refuse-sensitive'));
    assert.equal((await connection.connect(executable, 'sk-retry')).status, 'connected');
  } finally { await connection.disconnect(); }
});
test('Codex never sends a key unless the runtime confirms ephemeral storage', async () => {
  const { root, userData, executable } = await fixture('file'); const connection = new CodexConnection(userData, () => {});
  try {
    const result = await connection.connect(executable, 'sk-do-not-send');
    assert.equal(result.status, 'error'); assert.match(result.message, /No key was sent/);
    const methods = JSON.parse(await readFile(path.join(root, 'methods.json'), 'utf8'));
    assert.ok(!methods.includes('account/login/start'));
  } finally { await connection.disconnect(); }
});
test('Codex connection can be cancelled during initialization and shutdown is idempotent', async () => {
  const { root, userData, executable } = await fixture('ephemeral', true); const connection = new CodexConnection(userData, () => {});
  const connecting = connection.connect(executable, 'sk-cancel');
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      try { if ((await readFile(path.join(root, 'methods.json'), 'utf8')).includes('initialize')) break; } catch { /* Wait for fixture. */ }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal((await connection.disconnect()).status, 'disconnected');
    assert.equal((await connecting).status, 'disconnected');
    assert.equal((await connection.disconnect()).status, 'disconnected');
  } finally { await connection.disconnect(); }
});
test('live Codex configures ephemeral keys without creating credential files', { skip: !process.env.SPECULAR_LIVE_CODEX_AUTH }, async () => {
  const base = path.resolve('.cache/codex-auth-live'); await mkdir(base, { recursive: true });
  const userData = await mkdtemp(path.join(base, 'run-')); const connection = new CodexConnection(userData, () => {});
  const keys = ['sk-specular-synthetic-storage-check-not-a-real-key'];
  if (process.env.OPENAI_API_KEY) keys.push(process.env.OPENAI_API_KEY);
  for (const key of keys) {
    try {
      const connected = await connection.connect('', key);
      assert.equal(connected.status, 'connected', connected.message);
      assert.equal((await connection.refresh()).status, 'connected');
    } finally { await connection.disconnect(); }
    for (const buffer of await fileContents(userData)) assert.equal(buffer.includes(key), false, 'A credential was persisted.');
  }
});
