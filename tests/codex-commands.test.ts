import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CodexConnection } from '../src/core/codex-connection';
import { CodexConversation } from '../src/core/codex-conversation';
import { conversationFixture } from './helpers/codex-runtime';

async function setup(options: Parameters<typeof conversationFixture>[1] = {}) {
  const fixture = await conversationFixture(false, options);
  const connection = new CodexConnection(fixture.userData, () => {});
  const conversation = new CodexConversation(connection, () => {}, { turnMs: 3000, stopMs: 250 });
  await connection.connect(fixture.executable, 'sk-fixture');
  return { ...fixture, connection, conversation, calls: async () => JSON.parse(await readFile(path.join(fixture.root, 'calls.json'), 'utf8')) as {method: string; params: any}[] };
}
async function settled(conversation: CodexConversation) {
  for (let i = 0; i < 200; i++) { if (!['starting', 'running', 'stopping'].includes(conversation.snapshot().status)) return conversation.snapshot(); await new Promise(r => setTimeout(r, 10)); }
  assert.fail('Operation did not finish.');
}
test('commands reject unknown names, backslashes and arguments without forwarding prompts; local selection preserves a model ID', async () => {
  const { connection, conversation, calls } = await setup();
  try {
    for (const input of ['/unknown do something', '\\status', '/status extra', '/compact extra', '/model a b', '/help extra', '/model a\nb', '/stop extra']) assert.equal((await conversation.send(input, '')).ok, false, input);
    assert.equal((await conversation.send('  /model provider/model-v2:custom  ', '')).selectedModel, 'provider/model-v2:custom');
    assert.match((await conversation.send('/help', '')).message!, /Codex.*Compact/);
    assert.equal((await conversation.send('/compact', '')).ok, false);
    assert.equal((await conversation.send('/status', '')).ok, true);
    assert.equal((await conversation.send('/model', '')).models?.length, 2);
    assert.equal((await calls()).filter(c => ['turn/start', 'thread/start', 'thread/compact/start'].includes(c.method)).length, 0);
    await connection.disconnect();
    assert.equal((await conversation.send('/model', '')).ok, false);
    assert.equal((await conversation.send('/help', '')).ok, true);
    assert.equal((await conversation.send('/model offline-model', '')).selectedModel, 'offline-model');
  } finally { await connection.disconnect(); }
});
test('runtime status and early compaction target one thread and preserve visible text and follow-up context', async () => {
  const { connection, conversation, calls } = await setup({ compact: 'early' });
  try {
    await conversation.send('remember this', 'fixture-model'); await settled(conversation);
    const before = conversation.snapshot().messages;
    assert.match((await conversation.send('/status', '')).message!, /Codex thread: idle/);
    assert.equal((await conversation.send('/compact', '')).ok, true);
    const state = await settled(conversation); assert.equal(state.status, 'completed'); assert.match(state.message, /Context compacted/); assert.deepEqual(state.messages, before);
    await conversation.send('follow-up', 'fixture-model'); await settled(conversation);
    assert.match(conversation.snapshot().messages.at(-1)!.text, /remember this/);
    const commands = (await calls()).filter(c => ['thread/read', 'thread/compact/start'].includes(c.method));
    assert.equal(commands.length, 2); for (const command of commands) assert.equal(command.params.threadId, 'thread-1');
    assert.equal((await calls()).filter(c => c.method === 'thread/start').length, 1);
  } finally { await connection.disconnect(); }
});
test('status serializes dispatch and detects project changes without returning stale results', async () => {
  const { connection, conversation } = await setup({ commandDelayMs: 100 });
  try {
    await conversation.send('hello', 'fixture-model'); await settled(conversation);
    const status = conversation.send('/status', '');
    assert.equal((await conversation.send('must not send', 'fixture-model')).ok, false);
    assert.equal((await conversation.send('/model alternate-model', '')).ok, false);
    assert.equal((await conversation.useOpenProject()).ok, false);
    conversation.setOpenProject(path.resolve('.'));
    assert.equal((await status).ok, false);
    assert.equal((await conversation.send('/compact', '')).ok, false);
  } finally { await connection.disconnect(); }
});
test('compaction stop handles late turn ID, refuses overlapping operations and interrupts the matching turn', async () => {
  const { connection, conversation, calls } = await setup({ compact: 'delayed' });
  try {
    await conversation.send('hello', 'fixture-model'); await settled(conversation);
    await conversation.send('/compact', '');
    assert.equal((await conversation.send('/compact', '')).ok, false);
    assert.equal((await conversation.send('/model alternate-model', '')).ok, false);
    assert.equal((await conversation.useOpenProject()).ok, false);
    assert.equal((await conversation.send('/stop', '')).ok, true);
    assert.equal((await settled(conversation)).status, 'interrupted');
    const stop = (await calls()).find(c => c.method === 'turn/interrupt')!;
    assert.deepEqual(stop.params, { threadId: 'thread-1', turnId: 'turn-2' });
  } finally { await connection.disconnect(); }
});
test('failed command RPCs redact errors; missing compaction evidence and failed cancellation disconnect', async () => {
  for (const options of [{ statusFailure: true }, { compact: 'fail' as const }, { compact: 'missing' as const }, { compact: 'hold' as const, ignoreStop: true }]) {
    const { connection, conversation } = await setup(options);
    try {
      await conversation.send('hello', 'fixture-model'); await settled(conversation);
      const result = await conversation.send(options.statusFailure ? '/status' : '/compact', '');
      if (options.ignoreStop) await conversation.send('/stop', '');
      const state = await settled(conversation);
      assert.ok(!JSON.stringify({ result, state }).includes('secret raw'));
      if (options.statusFailure) assert.equal(result.ok, false);
      else { assert.equal(state.status, 'error'); assert.equal(connection.runtime(), undefined); }
    } finally { await connection.disconnect(); }
  }
});
test('unverified runtime version refuses runtime commands but retains IDE commands', async () => {
  const { connection, conversation, calls } = await setup({ version: '0.155.0' });
  try {
    for (const input of ['/status', '/model', '/compact']) assert.match((await conversation.send(input, '')).message!, /not supported/);
    assert.equal((await conversation.send('/help', '')).ok, true);
    assert.equal((await conversation.send('/model test-model', '')).ok, true);
    assert.equal((await calls()).filter(c => ['model/list', 'thread/read', 'thread/compact/start'].includes(c.method)).length, 0);
  } finally { await connection.disconnect(); }
});
