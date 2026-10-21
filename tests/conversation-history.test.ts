import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rename } from 'node:fs/promises';
import path from 'node:path';
import { ConversationHistory, parseHistory, type SavedConversation } from '../src/core/conversation-history';
import { CodexConnection } from '../src/core/codex-connection';
import { CodexConversation } from '../src/core/codex-conversation';
import { conversationFixture } from './helpers/codex-runtime';

const sample = (): SavedConversation => ({version:1,runtimeHome:'codex-runtime-v1',contextId:'context-1',threadId:'thread-1',runtimeVersion:'codex-cli 0.154.0',selectedModel:'fixture-model',status:'running',messages:[{id:'user-1',role:'user',text:'Remember this'}]});
async function open(f: Awaited<ReturnType<typeof conversationFixture>>) {
  const store = await ConversationHistory.load(path.join(f.userData,'codex-conversation.json'));
  const connection = new CodexConnection(f.userData,()=>{});
  const conversation = new CodexConversation(connection,()=>{},undefined,store);
  return {store,connection,conversation};
}
async function settled(conversation: CodexConversation) {
  for(let i=0;i<300;i++){if(!['starting','running','stopping'].includes(conversation.snapshot().status))return conversation.snapshot();await new Promise(r=>setTimeout(r,10));}
  assert.fail('Conversation did not finish');
}

test('history validates bounded records, omits unknown credential fields, and backs up corrupt data before replacement', async()=>{
  const base=path.resolve('.cache/history-tests');await mkdir(base,{recursive:true});const root=await mkdtemp(path.join(base,'run-'));const file=path.join(root,'history.json');
  const record=parseHistory({...sample(),apiKey:'sk-not-a-history-field'});assert.equal(JSON.stringify(record).includes('sk-not'),false);
  for(const invalid of [{...record,version:2},{...record,runtimeHome:'../other-client'},{...record,threadId:'../thread'},{...record,projectPath:'relative'},{...record,messages:[...record.messages,...record.messages]},{...record,messages:[{id:'x',role:'user',text:'x'.repeat(200001)}]}]) assert.throws(()=>parseHistory(invalid));
  await writeFile(file,'{broken');const store=await ConversationHistory.load(file);assert.ok(store.warning);
  assert.equal(await store.save(record),true);assert.equal((await readdir(root)).filter(n=>n.includes('.bak')).length,1);
  assert.deepEqual((await ConversationHistory.load(file)).snapshot(),record);
  const before=await readFile(file,'utf8');await rename(file,file+'.saved');await mkdir(file);
  assert.equal(await store.save({...record,status:'completed'}),false);assert.equal(await readFile(file+'.saved','utf8'),before);assert.equal(store.snapshot()?.status,'running');
});

test('offline transcript restores model and interrupted state; reconnect requires explicit native resume with no replay', async()=>{
  const f=await conversationFixture();let {connection,conversation}=await open(f);
  try {
    await connection.connect(f.executable,'sk-history-fixture');await conversation.send('Remember original','alternate-model');await settled(conversation);
    await conversation.send('hold','alternate-model');await conversation.flush();
    const file=path.join(f.userData,'codex-conversation.json');const before=await readFile(file,'utf8');assert.equal(before.includes('sk-history-fixture'),false);
    await connection.disconnect();await conversation.flush();
    ({connection,conversation}=await open(f));
    assert.equal(conversation.snapshot().status,'interrupted');assert.equal(conversation.snapshot().selectedModel,'alternate-model');assert.equal(conversation.snapshot().needsResume,true);
    assert.ok(conversation.snapshot().messages.some(m=>m.text==='Partial answer'));assert.equal((await conversation.resume()).ok,false);
    await connection.connect(f.executable,'sk-history-fixture');assert.equal((await conversation.send('must not send','fixture-model')).ok,false);
    let calls=JSON.parse(await readFile(path.join(f.root,'calls.json'),'utf8'));assert.ok(!calls.some((c:any)=>c.method==='turn/start'||c.method==='thread/resume'));
    assert.equal((await conversation.resume()).ok,true);
    calls=JSON.parse(await readFile(path.join(f.root,'calls.json'),'utf8'));assert.equal(calls.filter((c:any)=>c.method==='thread/resume').length,1);assert.ok(!calls.some((c:any)=>c.method==='turn/start'));
    await conversation.send('follow-up','alternate-model');const state=await settled(conversation);assert.equal(state.messages.at(-1)?.text,'Remembered: Remember original');
  } finally {await connection.disconnect();await conversation.flush();}
});

test('unavailable runtime history keeps transcript and requires explicit fresh context', async()=>{
  const f=await conversationFixture(false,{resumeFailure:true});let {connection,conversation}=await open(f);
  try{
    await connection.connect(f.executable,'sk-fixture');await conversation.send('keep visible','fixture-model');await settled(conversation);await connection.disconnect();await conversation.flush();
    ({connection,conversation}=await open(f));await connection.connect(f.executable,'sk-fixture');assert.equal((await conversation.resume()).ok,false);
    assert.equal(conversation.snapshot().needsResume,true);assert.ok(conversation.snapshot().messages.some(m=>m.text==='keep visible'));
    assert.equal((await conversation.startFresh()).ok,true);assert.deepEqual(conversation.snapshot().messages,[]);assert.equal(conversation.snapshot().needsResume,false);
    await connection.connect(f.executable,'sk-fixture');await conversation.send('new','fixture-model');assert.equal((await settled(conversation)).status,'completed');
  }finally{await connection.disconnect();await conversation.flush();}
});

test('resume refuses wrong projects and broader policy without sending a turn', async()=>{
  const f=await conversationFixture(false,{unsafeResume:true});let {connection,conversation}=await open(f);
  const first=path.join(f.root,'first'),second=path.join(f.root,'second');await mkdir(first);await mkdir(second);
  try{
    conversation.setOpenProject(first);await connection.connect(f.executable,'sk-fixture');await conversation.send('project one','fixture-model');await settled(conversation);await connection.disconnect();await conversation.flush();
    ({connection,conversation}=await open(f));conversation.setOpenProject(second);await connection.connect(f.executable,'sk-fixture');assert.equal((await conversation.resume()).ok,false);
    let calls=JSON.parse(await readFile(path.join(f.root,'calls.json'),'utf8'));assert.ok(!calls.some((c:any)=>c.method==='thread/resume'));
    conversation.setOpenProject(first);assert.equal((await conversation.resume()).ok,false);assert.equal(connection.snapshot().status,'disconnected');
    calls=JSON.parse(await readFile(path.join(f.root,'calls.json'),'utf8'));assert.ok(!calls.some((c:any)=>c.method==='turn/start'));
  }finally{await connection.disconnect();await conversation.flush();}
});

test('missing projects, incompatible runtimes and project changes during resume retain saved context', async()=>{
  const f=await conversationFixture(false,{resumeDelayMs:150});let {connection,conversation}=await open(f);const project=path.join(f.root,'project');await mkdir(project);
  try{
    conversation.setOpenProject(project);await connection.connect(f.executable,'sk-fixture');await conversation.send('keep','fixture-model');await settled(conversation);await connection.disconnect();await conversation.flush();
    ({connection,conversation}=await open(f));conversation.setOpenProject(project);await connection.connect(f.executable,'sk-fixture');
    const resuming=conversation.resume();await new Promise(r=>setTimeout(r,40));conversation.setOpenProject(f.root);assert.equal((await resuming).ok,false);assert.equal(conversation.snapshot().needsResume,true);
    conversation.setOpenProject(project);await rename(project,project+'-moved');await connection.connect(f.executable,'sk-fixture');assert.equal((await conversation.resume()).ok,false);
    await conversation.flush();const file=path.join(f.userData,'codex-conversation.json');const data=JSON.parse(await readFile(file,'utf8'));data.runtimeVersion='codex-cli 99.0.0';await writeFile(file,JSON.stringify(data));
    ({connection,conversation}=await open(f));conversation.setOpenProject(project);await connection.connect(f.executable,'sk-fixture');assert.equal((await conversation.resume()).ok,false);assert.ok(conversation.snapshot().messages.length);
  }finally{await connection.disconnect();await conversation.flush();}
});

test('failed history storage prevents dispatch and preserves visible history when Start fresh cannot commit',async()=>{
  const f=await conversationFixture();const {connection,conversation}=await open(f);
  try{
    await connection.connect(f.executable,'sk-fixture');await conversation.send('preserve me','fixture-model');await settled(conversation);await conversation.flush();
    const file=path.join(f.userData,'codex-conversation.json');const original=await readFile(file,'utf8');await rename(file,file+'.saved');await mkdir(file);
    assert.equal((await conversation.startFresh()).ok,false);assert.ok(conversation.snapshot().messages.some(m=>m.text==='preserve me'));assert.equal(await readFile(file+'.saved','utf8'),original);
    assert.equal((await conversation.resume()).ok,true);assert.equal((await conversation.send('never dispatch','fixture-model')).ok,false);
    const calls=JSON.parse(await readFile(path.join(f.root,'calls.json'),'utf8'));assert.equal(calls.filter((c:any)=>c.method==='turn/start').length,1);
    assert.ok(!conversation.snapshot().messages.some(m=>m.text==='never dispatch'));
  }finally{await connection.disconnect();await conversation.flush();}
});
