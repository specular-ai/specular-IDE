import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { CodexConnection } from '../src/core/codex-connection';
import { CodexConversation } from '../src/core/codex-conversation';

test('live commands read thread status, list models, compact the current context and retain a follow-up', {
  skip: !process.env.SPECULAR_LIVE_CODEX_COMMANDS || !process.env.OPENAI_API_KEY, timeout: 180_000,
}, async () => {
  const base = path.resolve('.cache/codex-commands-live'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-')); const project = path.join(root, 'project'); await mkdir(project);
  await writeFile(path.join(project, 'requirements.md'), 'The requirement token is PULSAR-618.\n');
  const connection = new CodexConnection(path.join(root, 'user-data'), () => {});
  const conversation = new CodexConversation(connection, () => {}); conversation.setOpenProject(project);
  const events: { method: string; threadId?: string; turnId?: string; itemType?: string }[] = [];
  connection.subscribe((method, p: any) => { if (['turn/started', 'turn/completed', 'item/completed'].includes(method)) events.push({ method, threadId: p.threadId, turnId: p.turnId ?? p.turn?.id, itemType: p.item?.type }); });
  const report: Record<string, unknown> = {};
  async function settled() { for (let i = 0; i < 1200; i++) { const state = conversation.snapshot(); if (!['starting', 'running', 'stopping'].includes(state.status)) return state; await new Promise(r => setTimeout(r, 100)); } throw new Error('Live command timed out'); }
  try {
    assert.equal((await connection.connect('', process.env.OPENAI_API_KEY!)).status, 'connected'); report.runtime = connection.snapshot().version;
    const catalog = await conversation.send('/model', ''); assert.equal(catalog.ok, true, catalog.message); assert.ok(catalog.models?.length);
    const model = process.env.SPECULAR_LIVE_CODEX_MODEL || catalog.models.find(m => m.isDefault)?.id; assert.ok(model); report.model = model;
    assert.equal((await conversation.send('/status', '')).ok, true);
    assert.equal((await conversation.send('Read requirements.md with your shell tool and remember its token. Reply with the token only.', model)).ok, true);
    assert.equal((await settled()).status, 'completed');
    const status = await conversation.send('/status', ''); assert.equal(status.ok, true, status.message); assert.match(status.message!, /Codex thread: idle/); report.threadStatus = true;
    const before = conversation.snapshot().messages;
    assert.equal((await conversation.send('/compact', model)).ok, true);
    const compacted = await settled(); assert.equal(compacted.status, 'completed', compacted.message); assert.match(compacted.message, /Context compacted/); assert.deepEqual(compacted.messages, before);
    assert.ok(events.some(e => e.itemType === 'contextCompaction')); report.compactionConfirmed = true;
    assert.equal((await conversation.send('What requirement token did you read earlier? Reply with the token only, without reading the file again.', model)).ok, true);
    assert.equal((await settled()).status, 'completed'); assert.match(conversation.snapshot().messages.at(-1)!.text, /PULSAR-618/); report.followUpRetained = true;
    assert.equal(new Set(events.map(e => e.threadId)).size, 1); report.sameThread = true;
    await conversation.send('/compact', ''); await conversation.send('/stop', '');
    const stopped = await settled(); assert.equal(stopped.status, 'interrupted', stopped.message); report.compactionStopConfirmed = true;
    assert.equal(await readFile(path.join(project, 'requirements.md'), 'utf8'), 'The requirement token is PULSAR-618.\n'); report.fileUnchanged = true;
    const pid = connection.runtime()!.client.child.pid!; await connection.disconnect(); assert.throws(() => process.kill(pid, 0)); report.processExited = true;
  } finally { await connection.disconnect(); await writeFile(path.join(root, 'verification.json'), JSON.stringify(report, null, 2) + '\n'); }
});
