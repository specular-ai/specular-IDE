import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CredentialStore, type CredentialEncryption } from '../src/core/credential-store';
import { CodexAccess } from '../src/core/codex-access';
import type { CodexConnectionState } from '../src/shared/types';

async function fixture() {
  const base = path.resolve('.cache/credential-tests'); await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'run-'));
  const key = randomBytes(32);
  const encryption: CredentialEncryption = {
    available: async () => true,
    encrypt: async text => { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); const bytes = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), bytes]); },
    decrypt: async bytes => { const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(12, 28)); return Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'); },
  };
  return { directory, encryption, store: await CredentialStore.load(directory, encryption) };
}
function runtime() {
  let state: CodexConnectionState = { status: 'disconnected', message: 'Offline' };
  const calls: { executable: string; key: string }[] = [];
  return { calls, snapshot: () => state, connect: async (executable: string, key: string) => { calls.push({ executable, key }); return state = { status: 'connected', message: 'Connected' }; }, disconnect: async () => state = { status: 'disconnected', message: 'Disconnected' } };
}

test('protected key survives reload, replacement removes old ciphertext, and Forget disables startup and removes bytes', async () => {
  const { directory, encryption, store } = await fixture();
  assert.equal(await store.remember('sk-first-secret', 'C:/custom/codex.cmd', true), true);
  const names = await readdir(directory);
  for (const name of names) assert.equal((await readFile(path.join(directory, name))).includes('sk-first-secret'), false);
  const restored = await CredentialStore.load(directory, encryption);
  assert.equal(await restored.key(), 'sk-first-secret'); assert.equal(restored.snapshot().autoConnect, true);
  assert.equal(restored.snapshot().executable, 'C:/custom/codex.cmd');
  assert.equal(await restored.remember('sk-replacement', '', false), true);
  assert.equal((await readdir(directory)).filter(n => n.endsWith('.bin')).length, 1);
  assert.equal(await restored.key(), 'sk-replacement');
  assert.equal(await restored.forget(), true);
  assert.deepEqual((await readdir(directory)), ['preferences.json']);
  const forgotten = await CredentialStore.load(directory, encryption);
  assert.equal(forgotten.snapshot().remembered, false); assert.equal(forgotten.snapshot().autoConnect, false);
});

test('unavailable encryption and failed encryption preserve previous data and never persist plaintext', async () => {
  const { directory, encryption, store } = await fixture();
  await store.remember('sk-original', '', true);
  const before = await readFile(path.join(directory, 'preferences.json'));
  encryption.available = async () => false;
  assert.equal(await store.remember('sk-new', '', false), false);
  assert.equal(await store.key(), undefined);
  assert.deepEqual(await readFile(path.join(directory, 'preferences.json')), before);
  encryption.available = async () => true;
  encryption.encrypt = async () => { throw new Error('sk-new'); };
  assert.equal(await store.remember('sk-new', '', false), false);
  assert.equal(JSON.stringify(store.snapshot()).includes('sk-new'), false);
  assert.equal(await store.key(), 'sk-original');
});

test('corrupted or missing ciphertext remains recoverable and explicit Forget resets invalid preferences', async () => {
  const { directory, encryption, store } = await fixture();
  await store.remember('sk-original', '', true);
  const name = (await readdir(directory)).find(n => n.endsWith('.bin'))!;
  await writeFile(path.join(directory, name), 'broken');
  assert.equal(await store.key(), undefined); assert.equal(store.snapshot().remembered, true);
  assert.equal(await readFile(path.join(directory, name), 'utf8'), 'broken');
  await writeFile(path.join(directory, 'preferences.json'), '{bad');
  const invalid = await CredentialStore.load(directory, encryption);
  assert.ok(invalid.snapshot().warning); assert.equal(await invalid.remember('sk-new', '', true), false);
  assert.equal(await readFile(path.join(directory, 'preferences.json'), 'utf8'), '{bad');
  assert.equal(await invalid.forget(), true); assert.deepEqual(await readdir(directory), ['preferences.json']);
  assert.equal(await invalid.remember('sk-new', '', false), true);
});

test('failed preference writes retain the previous credential and remove uncommitted ciphertext', async () => {
  const { directory, store } = await fixture();
  await mkdir(path.join(directory, 'preferences.json'));
  assert.equal(await store.remember('sk-never-saved', '', true), false);
  assert.deepEqual(await readdir(directory), ['preferences.json']);
  assert.equal(store.snapshot().remembered, false);
});

test('startup connects once using saved path/key, Disconnect suppresses retry, session-only does not replace saved key', async () => {
  const { store } = await fixture(); const connection = runtime(); const access = new CodexAccess(connection, store);
  await store.remember('sk-saved', 'C:/tools/codex.cmd', true);
  await access.startup(); assert.deepEqual(connection.calls, [{ executable: 'C:/tools/codex.cmd', key: 'sk-saved' }]);
  await access.disconnect(); await access.startup(); assert.equal(connection.calls.length, 1);
  await access.connect('', 'sk-session', false, false);
  assert.equal(await store.key(), 'sk-saved'); assert.equal(store.snapshot().autoConnect, true);
  await access.forget(); assert.equal(connection.snapshot().status, 'disconnected'); assert.equal(store.snapshot().remembered, false);
});

test('remember-only does not auto-connect, and cancellation while decrypting prevents a late connection', async () => {
  const { store, encryption } = await fixture(); const connection = runtime();
  await store.remember('sk-saved', '', false);
  await new CodexAccess(connection, store).startup(); assert.equal(connection.calls.length, 0);
  await store.preferences('', true);
  let release!: (key: string) => void; let began!: () => void;
  const started = new Promise<void>(resolve => { began = resolve; });
  encryption.decrypt = () => { began(); return new Promise(resolve => { release = resolve; }); };
  const access = new CodexAccess(connection, store); const startup = access.startup(); await started;
  const disconnected = access.disconnect(); release('sk-saved');
  await Promise.all([startup, disconnected]); assert.equal(connection.calls.length, 0);
  await access.startup(); assert.equal(connection.calls.length, 0);
});
