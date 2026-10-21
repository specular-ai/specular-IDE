import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CodexConnection } from '../src/core/codex-connection';
import { CodexConversation } from '../src/core/codex-conversation';
import { ConversationHistory } from '../src/core/conversation-history';
import { conversationFixture } from './helpers/codex-runtime';

async function setup(options: Parameters<typeof conversationFixture>[1] = {}) {
  const f = await conversationFixture(false, options);
  const project = path.join(f.root, 'project'); await mkdir(project);
  const historyFile = path.join(f.userData, 'codex-conversation.json');
  const connection = new CodexConnection(f.userData, () => {});
  const conversation = new CodexConversation(connection, () => {}, undefined, await ConversationHistory.load(historyFile));
  conversation.setOpenProject(project);
  return { ...f, project, historyFile, connection, conversation };
}
async function settled(c: CodexConversation) {
  for (let i = 0; i < 300; i++) { if (!['starting', 'running', 'stopping'].includes(c.snapshot().status)) return; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('Turn did not finish');
}
async function calls(root: string): Promise<any[]> { return JSON.parse(await readFile(path.join(root, 'calls.json'), 'utf8')); }

test('reviewed brief is literal, dispatched once, persisted exactly and remembered by follow-up in the same read-only project', async () => {
  const f = await setup({ threadDelayMs: 100 }); const { conversation: c, connection, project } = f;
  const text = '  /compact\n# Reviewed brief\nSource: requirements.md\nUnsaved snapshot: caf\u00e9 \u{1f9ed}\n\n';
  try {
    await writeFile(path.join(project, 'requirements.md'), '# Saved source\n');
    await connection.connect(f.executable, 'sk-fixture');
    const sending = c.sendBrief(project, text, 'alternate-model');
    assert.equal((await c.sendBrief(project, text, 'alternate-model')).ok, false);
    assert.equal((await sending).ok, true); await settled(c);
    assert.equal(c.snapshot().messages.find(m => m.role === 'user')?.text, text);
    await c.send('follow-up', 'alternate-model'); await settled(c); await c.flush();
    assert.equal(c.snapshot().messages.at(-1)?.text, 'Remembered: ' + text);
    const all = await calls(f.root), turns = all.filter(x => x.method === 'turn/start');
    assert.equal(turns.length, 2); assert.deepEqual(turns[0].params.input, [{ type: 'text', text }]);
    assert.equal(turns[0].params.threadId, turns[1].params.threadId);
    assert.equal(turns[0].params.model, 'alternate-model'); assert.equal(turns[0].params.cwd, project);
    assert.deepEqual(turns[0].params.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    assert.equal(turns[0].params.approvalPolicy, 'never');
    assert.equal(all.filter(x => x.method === 'thread/start').length, 1);
    assert.equal(all.some(x => x.method === 'thread/compact/start'), false);
    assert.equal(JSON.parse(await readFile(f.historyFile, 'utf8')).messages[0].text, text);
    assert.equal(await readFile(path.join(project, 'requirements.md'), 'utf8'), '# Saved source\n');
  } finally { await connection.disconnect(); await c.flush(); }
});

test('brief rejects missing connection, invalid payloads, stale capture and a conversation belonging to another project', async () => {
  const f = await setup(); const { conversation: c, connection, project } = f;
  try {
    assert.match((await c.sendBrief(project, 'draft', 'fixture-model')).message!, /Connect Codex/);
    await connection.connect(f.executable, 'sk-fixture');
    for (const text of ['', ' ', 'x'.repeat(32_001), null]) assert.equal((await c.sendBrief(project, text, 'fixture-model')).ok, false);
    assert.equal((await c.sendBrief(project, 'draft', '')).ok, false);
    assert.equal((await c.sendBrief(project + '-stale', 'draft', 'fixture-model')).ok, false);
    assert.equal((await calls(f.root)).some(x => x.method === 'turn/start'), false);
    await c.sendBrief(project, 'original', 'fixture-model'); await settled(c);
    c.setOpenProject(f.root);
    assert.equal((await c.sendBrief(project, 'stale', 'fixture-model')).ok, false);
    assert.match((await c.sendBrief(f.root, 'wrong context', 'fixture-model')).message!, /different project/);
    assert.equal((await calls(f.root)).filter(x => x.method === 'turn/start').length, 1);
  } finally { await connection.disconnect(); await c.flush(); }
});

test('project change during brief startup prevents dispatch', async () => {
  const f = await setup({ threadDelayMs: 180 }); const { conversation: c, connection, project } = f;
  try {
    await connection.connect(f.executable, 'sk-fixture'); const sending = c.sendBrief(project, 'draft', 'fixture-model');
    for (let i = 0; i < 100; i++) { if ((await calls(f.root)).some(x => x.method === 'thread/start')) break; await new Promise(r => setTimeout(r, 5)); }
    c.setOpenProject(f.root); assert.equal((await sending).ok, false);
    assert.equal((await calls(f.root)).some(x => x.method === 'turn/start'), false);
  } finally { await connection.disconnect(); await c.flush(); }
});

test('failed dispatch returns a safe failure and never retries the reviewed brief automatically', async () => {
  const f = await setup({ turnStartFailure: true }); const { conversation: c, connection, project } = f;
  try {
    await connection.connect(f.executable, 'sk-fixture'); const result = await c.sendBrief(project, 'retain this draft', 'fixture-model');
    assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes('private dispatch failure'));
    assert.equal((await calls(f.root)).filter(x => x.method === 'turn/start').length, 1);
    assert.equal(connection.runtime(), undefined);
  } finally { await connection.disconnect(); await c.flush(); }
});

test('reviewed briefs cannot implicitly resume saved context or replay its messages', async () => {
  const f = await setup(); let c = f.conversation;
  try {
    await f.connection.connect(f.executable, 'sk-fixture'); await c.sendBrief(f.project, 'saved brief', 'fixture-model'); await settled(c);
    await f.connection.disconnect(); await c.flush();
    c = new CodexConversation(f.connection, () => {}, undefined, await ConversationHistory.load(f.historyFile)); c.setOpenProject(f.project);
    await f.connection.connect(f.executable, 'sk-fixture');
    assert.match((await c.sendBrief(f.project, 'new brief', 'fixture-model')).message!, /Resume or Start fresh/);
    assert.equal((await calls(f.root)).some(x => ['turn/start', 'thread/resume'].includes(x.method)), false);
  } finally { await f.connection.disconnect(); await c.flush(); }
});
