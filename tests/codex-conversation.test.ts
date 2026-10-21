import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { CodexConnection } from '../src/core/codex-connection';
import { CodexConversation, turnError } from '../src/core/codex-conversation';
import { conversationFixture } from './helpers/codex-runtime';

async function setup(unsafe = false) {
  const fixture = await conversationFixture(unsafe); const connection = new CodexConnection(fixture.userData, () => {});
  const snapshots: ReturnType<CodexConversation['snapshot']>[] = []; const conversation = new CodexConversation(connection, state => snapshots.push(state));
  assert.equal((await connection.connect(fixture.executable, 'sk-fixture')).status, 'connected');
  return { ...fixture, connection, conversation, snapshots };
}
async function settled(conversation: CodexConversation) {
  for (let i=0;i<100;i++) { if (!['starting','running','stopping'].includes(conversation.snapshot().status)) return conversation.snapshot(); await new Promise(resolve=>setTimeout(resolve,20)); }
  assert.fail('Conversation did not settle.');
}
test('conversation streams once, reconciles final text, ignores other threads and preserves follow-up context', async () => {
  const { connection, conversation, root, snapshots } = await setup();
  try {
    assert.equal((await conversation.models()).models.length,2);
    assert.equal((await conversation.send('hello <script>','fixture-model')).ok,true);
    assert.equal((await conversation.send('duplicate','fixture-model')).ok,false);
    let state=await settled(conversation); assert.equal(state.status,'completed'); assert.equal(state.messages.at(-1)?.text,'Reply: hello <script>');
    assert.ok(snapshots.some(s=>s.status==='running' && s.messages.at(-1)?.text==='Reply: '));
    assert.equal((await conversation.send('follow-up','alternate-model')).ok,true); state=await settled(conversation);
    assert.equal(state.messages.at(-1)?.text,'Remembered: hello <script>');
    const calls=JSON.parse(await readFile(path.join(root,'calls.json'),'utf8'));
    assert.equal(calls.filter((c:any)=>c.method==='thread/start').length,1);
    const turns=calls.filter((c:any)=>c.method==='turn/start'); assert.equal(turns[1].params.model,'alternate-model');
    for(const turn of turns) { assert.equal(turn.params.approvalPolicy,'never'); assert.deepEqual(turn.params.sandboxPolicy,{type:'readOnly',networkAccess:false}); assert.equal(turn.params.threadId,'thread-1'); }
    assert.ok(!JSON.stringify(snapshots).includes('WRONG THREAD'));
  } finally { await connection.disconnect(); }
});
test('early completion cannot be overwritten by the turn/start response', async () => {
  const { connection, conversation }=await setup();
  try { assert.equal((await conversation.send('early','fixture-model')).ok,true); assert.equal(conversation.snapshot().status,'completed'); assert.equal(conversation.snapshot().messages.at(-1)?.text,'Reply: early'); }
  finally { await connection.disconnect(); }
});
test('stop interrupts a turn and preserves partial output; subsequent sends remain possible', async () => {
  const { connection, conversation }=await setup();
  try {
    await conversation.send('hold','fixture-model'); await conversation.stop(); await conversation.stop();
    let state=await settled(conversation); assert.equal(state.status,'interrupted'); assert.equal(state.messages.at(-1)?.text,'Partial answer');
    await conversation.send('after stop','fixture-model'); state=await settled(conversation); assert.equal(state.status,'completed');
  } finally { await connection.disconnect(); }
});
test('missing inputs and unsafe runtime policy refuse dispatch', async () => {
  const { connection, conversation, root }=await setup(true);
  try {
    assert.equal((await conversation.send('','fixture-model')).ok,false); assert.equal((await conversation.send('hello','')).ok,false);
    assert.equal((await conversation.send('hello','fixture-model')).ok,false);
    const calls=JSON.parse(await readFile(path.join(root,'calls.json'),'utf8')); assert.ok(!calls.some((c:any)=>c.method==='turn/start'));
    assert.equal(conversation.snapshot().status,'error'); assert.equal(connection.snapshot().status,'disconnected');
  } finally { await connection.disconnect(); }
});
test('turn errors are actionable and do not expose raw secret-bearing server messages', async () => {
  const { connection, conversation }=await setup();
  try {
    await conversation.send('rejected key','fixture-model'); let state=await settled(conversation); assert.equal(state.status,'error'); assert.match(state.message,/API key/);
    assert.equal(state.messages.at(-1)?.text,'Partial before rejection'); assert.ok(!JSON.stringify(state).includes('sk-do-not-expose'));
    await conversation.send('bad model','fixture-model'); state=await settled(conversation); assert.match(state.message,/model access/);
    assert.match(turnError({codexErrorInfo:{httpConnectionFailed:{httpStatusCode:429}}}),/billing/);
    assert.match(turnError({codexErrorInfo:'other',message:'401 Unauthorized sk-private-value'}),/API key/);
  } finally { await connection.disconnect(); }
});
test('unsupported tools and approvals are refused through the actual transport', async () => {
  const { connection, conversation, root }=await setup();
  try {
    await conversation.send('approvals','fixture-model'); await settled(conversation);
    const calls=JSON.parse(await readFile(path.join(root,'calls.json'),'utf8'));
    assert.deepEqual(calls.find((c:any)=>c.reply===800).result,{decision:'decline'});
    assert.deepEqual(calls.find((c:any)=>c.reply===801).result,{decision:'decline'});
    assert.deepEqual(calls.find((c:any)=>c.reply===802).result,{permissions:{},scope:'turn'});
    assert.equal(calls.find((c:any)=>c.reply===803).error.code,-32601);
  } finally { await connection.disconnect(); }
});
test('connection loss retains transcript and reconnect starts a clearly separated context', async () => {
  const { connection, conversation, executable }=await setup();
  try {
    await conversation.send('crash','fixture-model'); let state=await settled(conversation); assert.equal(state.status,'error'); assert.equal(state.messages.at(-1)?.text,'Partial before exit');
    await connection.disconnect(); assert.equal((await connection.connect(executable,'sk-fixture')).status,'connected');
    await conversation.send('new context','fixture-model'); state=await settled(conversation); assert.equal(state.status,'completed');
    assert.ok(state.messages.some(m=>m.role==='system' && m.text.includes('not included')));
    assert.ok(state.messages.some(m=>m.text==='Partial before exit'));
  } finally { await connection.disconnect(); }
});
test('Stop during thread startup keeps the draft unsent, and Stop before turn/start replies is not lost', async()=>{
  const fixture=await conversationFixture(false,{threadDelayMs:150}); const connection=new CodexConnection(fixture.userData,()=>{});
  const conversation=new CodexConversation(connection,()=>{});
  try {
    await connection.connect(fixture.executable,'sk-fixture');
    const sending=conversation.send('not sent','fixture-model'); await conversation.stop();
    assert.equal((await sending).ok,false); assert.equal(conversation.snapshot().status,'interrupted');
    let calls=JSON.parse(await readFile(path.join(fixture.root,'calls.json'),'utf8')); assert.ok(!calls.some((c:any)=>c.method==='turn/start'));
    const delayed=conversation.send('delayed start','fixture-model');
    for(let i=0;i<100 && conversation.snapshot().status!=='running';i++) await new Promise(r=>setTimeout(r,5));
    await conversation.stop();await delayed;assert.equal(conversation.snapshot().status,'interrupted');
    calls=JSON.parse(await readFile(path.join(fixture.root,'calls.json'),'utf8'));assert.equal(calls.filter((c:any)=>c.method==='turn/interrupt').length,1);
  } finally {await connection.disconnect();}
});
test('unconfirmed Stop and stalled turns disconnect instead of allowing overlapping work', async()=>{
  for(const stop of [true,false]) {
    const fixture=await conversationFixture(false,{ignoreStop:true});const connection=new CodexConnection(fixture.userData,()=>{});
    const conversation=new CodexConversation(connection,()=>{}, {turnMs:stop?2000:100,stopMs:70});
    try {
      await connection.connect(fixture.executable,'sk-fixture');await conversation.send('hold','fixture-model');if(stop)await conversation.stop();
      const state=await settled(conversation);assert.equal(state.status,'error');assert.match(state.message,stop?/Stop was not confirmed/:/three-minute/);
      await connection.disconnect();assert.equal(connection.runtime(),undefined);assert.equal(state.messages.at(-1)?.text,'Partial answer');
    } finally {await connection.disconnect();}
  }
});
