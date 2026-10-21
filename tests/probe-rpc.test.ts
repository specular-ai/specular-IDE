import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { JsonLineClient, RpcError } from '../src/core/json-line-client';

async function fixture(source: string, options: { timeoutMs?: number; maxBytes?: number } = {}) {
  const base = path.resolve('.cache/probe-rpc-tests'); await mkdir(base, { recursive: true });
  const cwd = await mkdtemp(path.join(base, 'run-'));
  const script = path.join(cwd, 'fixture.cjs'); await writeFile(script, source);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  return { cwd, client: new JsonLineClient(process.execPath, [script], { cwd, env, ...options }) };
}
const reader = `const rl = require('node:readline').createInterface({ input: process.stdin });
const send = m => process.stdout.write(JSON.stringify(m) + '\\n');`;

test('probe matches responses, accepts fragmented UTF-8, and records notification methods without payloads', async () => {
  const { client } = await fixture(`${reader}
    rl.on('line', line => {
      const m = JSON.parse(line);
      send({ method: 'session/update', params: { secret: 'do not record' } });
      const data = Buffer.from(JSON.stringify({ id: m.id, result: { text: 'ñ' } }) + '\\n');
      const split = data.indexOf(Buffer.from('ñ')) + 1;
      process.stdout.write(data.subarray(0, split));
      setTimeout(() => process.stdout.write(data.subarray(split)), 20);
    });`);
  try {
    assert.deepEqual(await client.request('initialize', {}), { text: 'ñ' });
    assert.ok(client.trace.some(entry => entry.method === 'session/update'));
    assert.ok(!JSON.stringify(client.trace).includes('do not record'));
  } finally { const stopped = await client.stop(); assert.equal(stopped.treeTerminated, true); assert.equal(stopped.exited, true); }
});

test('probe refuses permission, filesystem, and terminal requests without executing client tools', async () => {
  const { client } = await fixture(`${reader}
    let request;
    const replies = [];
    rl.on('line', line => {
      const m = JSON.parse(line);
      if (m.method === 'initialize') {
        request = m.id;
        send({ id: 'permission', method: 'session/request_permission', params: {} });
        send({ id: 'file', method: 'fs/write_text_file', params: { path: 'should-not-exist', content: 'unsafe' } });
        send({ id: 'terminal', method: 'terminal/create', params: { command: 'not executed' } });
      } else {
        replies.push(m);
        if (replies.length === 3) send({ id: request, result: replies });
      }
    });`);
  try {
    const replies = await client.request('initialize', {}) as Array<{ result?: unknown; error?: { code: number } }>;
    assert.deepEqual(replies[0].result, { outcome: { outcome: 'cancelled' } });
    assert.equal(replies[1].error?.code, -32601); assert.equal(replies[2].error?.code, -32601);
  } finally { await client.stop(); }
});

test('probe distinguishes authentication rejection from transport failure', async () => {
  const { client } = await fixture(`${reader} rl.on('line', line => send({ id: JSON.parse(line).id, error: { code: -32000, message: 'Authentication required' } }));`);
  try {
    await assert.rejects(client.request('session/new', {}), (error: unknown) => error instanceof RpcError && error.code === -32000);
  } finally { await client.stop(); }
});

test('probe bounds time and output, rejects malformed JSON, and handles process exit', async () => {
  for (const [source, message, options] of [
    ['setInterval(() => {}, 1000);', /Timed out/, { timeoutMs: 150 }],
    ['process.stdout.write("x".repeat(8192)); setInterval(() => {}, 1000);', /output exceeded/, { maxBytes: 4096 }],
    ['process.stdout.write("invalid json\\n"); setInterval(() => {}, 1000);', /malformed JSONL/, {}],
    ['process.exit(2);', /connection closed/, {}],
  ] as const) {
    const { client } = await fixture(source, options);
    try { await assert.rejects(client.request('initialize', {}), message); }
    finally { assert.equal((await client.stop()).exited, true); }
  }
});

test('probe shutdown terminates descendants before their launcher can exit', async () => {
  const { client, cwd } = await fixture(`${reader}
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    require('node:fs').writeFileSync('child-pid.txt', String(child.pid));
    rl.on('line', line => send({ id: JSON.parse(line).id, result: { ready: true } }));`);
  let pid: number | undefined;
  try {
    await client.request('initialize', {}); pid = Number(await readFile(path.join(cwd, 'child-pid.txt'), 'utf8'));
    assert.ok(pid > 0);
    assert.deepEqual(await client.stop(), { treeTerminated: true, exited: true });
    assert.throws(() => process.kill(pid!, 0), { code: 'ESRCH' });
  } finally { await client.stop(); if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already stopped. */ } } }
});
