import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { CodexConnection } from '../src/core/codex-connection';
import { CodexConversation } from '../src/core/codex-conversation';
import { conversationFixture } from './helpers/codex-runtime';
async function setup(options: Parameters<typeof conversationFixture>[1] = {}) {
  const fixture=await conversationFixture(false,options); const a=path.join(fixture.root,'Project A ñ'),b=path.join(fixture.root,'Project B'); await mkdir(a);await mkdir(b);
  const connection=new CodexConnection(fixture.userData,()=>{});const conversation=new CodexConversation(connection,()=>{});
  await connection.connect(fixture.executable,'sk-fixture'); conversation.setOpenProject(a);
  return {...fixture,a,b,connection,conversation};
}
async function settled(conversation:CodexConversation){for(let i=0;i<100;i++){if(!['starting','running','stopping'].includes(conversation.snapshot().status))return;await new Promise(r=>setTimeout(r,10));}assert.fail('Turn did not settle');}
test('project-aware turns use a canonical real folder, preserve context and disable project executable configuration',async()=>{
  const {a,root,connection,conversation}=await setup();
  try {
    await writeFile(path.join(a,'saved.md'),'saved content');assert.equal((await conversation.send('first','fixture-model')).ok,true);await settled(conversation);
    assert.equal(conversation.snapshot().projectPath,a);assert.equal(conversation.snapshot().scopeMismatch,false);
    await conversation.send('follow-up','fixture-model');await settled(conversation);
    assert.equal(conversation.snapshot().messages.at(-1)?.text,'Remembered: first');
    const calls=JSON.parse(await readFile(path.join(root,'calls.json'),'utf8'));
    for(const call of calls.filter((c:any)=>['thread/start','turn/start','config/read'].includes(c.method) && c.params.cwd))assert.equal(call.params.cwd,a);
    assert.equal(calls.filter((c:any)=>c.method==='thread/start').length,1);
    assert.equal(calls.filter((c:any)=>c.method==='config/read' && c.params.cwd).length,2);
    const config=await readFile(path.join(connection.runtime()!.cwd,'../.codex/config.toml'),'utf8');
    assert.ok(config.includes(`[projects.${JSON.stringify(a)}]`));assert.ok(config.includes('trust_level = "untrusted"'));assert.ok(config.includes('hooks = false'));
    assert.equal(await readFile(path.join(a,'saved.md'),'utf8'),'saved content');
  }finally{await connection.disconnect();}
});
test('project switching requires an explicit new context, rejects switching during a turn and keeps previous text',async()=>{
  const {a,b,root,connection,conversation}=await setup();
  try{
    await conversation.send('hold','fixture-model');conversation.setOpenProject(b);
    assert.equal(conversation.snapshot().projectPath,a);assert.equal(conversation.snapshot().scopeMismatch,true);
    assert.equal((await conversation.useOpenProject()).ok,false);await conversation.stop();await settled(conversation);
    assert.equal((await conversation.send('not sent','fixture-model')).ok,false);
    assert.equal((await conversation.useOpenProject()).ok,true);assert.equal(conversation.snapshot().projectPath,b);
    await conversation.send('new project','fixture-model');await settled(conversation);
    assert.ok(conversation.snapshot().messages.some(m=>m.text==='Partial answer'));
    assert.ok(conversation.snapshot().messages.some(m=>m.role==='system' && m.text.includes(b)));
    const calls=JSON.parse(await readFile(path.join(root,'calls.json'),'utf8'));const turns=calls.filter((c:any)=>c.method==='turn/start');
    assert.equal(turns.length,2);assert.equal(turns[0].params.cwd,a);assert.equal(turns[1].params.cwd,b);assert.notEqual(turns[0].params.threadId,turns[1].params.threadId);
  }finally{await connection.disconnect();}
});
test('a moved project cannot silently fall back to an isolated workspace',async()=>{
  const {a,connection,conversation}=await setup();
  try{
    await conversation.send('first','fixture-model');await settled(conversation);await rename(a,a+' moved');
    assert.equal((await conversation.send('not sent','fixture-model')).ok,false);assert.match(conversation.snapshot().message,/project is unavailable/);
    assert.equal(conversation.snapshot().projectPath,a);assert.equal(connection.runtime(),undefined);
  }finally{await connection.disconnect();}
});
test('an enabled project config layer prevents thread creation and prompt dispatch',async()=>{
  const {root,connection,conversation}=await setup({unsafeProject:true});
  try{
    assert.equal((await conversation.send('not sent','fixture-model')).ok,false);
    const calls=JSON.parse(await readFile(path.join(root,'calls.json'),'utf8'));assert.ok(!calls.some((c:any)=>c.method==='thread/start'||c.method==='turn/start'));
    assert.equal(connection.runtime(),undefined);
  }finally{await connection.disconnect();}
});
test('a project switch during thread startup aborts dispatch and retains the original scope',async()=>{
  const {a,b,root,connection,conversation}=await setup({threadDelayMs:180});
  try{
    const sending=conversation.send('not sent','fixture-model');
    for(let i=0;i<100;i++){try{if((await readFile(path.join(root,'calls.json'),'utf8')).includes('thread/start'))break;}catch{}await new Promise(r=>setTimeout(r,5));}
    conversation.setOpenProject(b);assert.equal((await sending).ok,false);
    assert.equal(conversation.snapshot().projectPath,a);assert.equal(conversation.snapshot().scopeMismatch,true);
    const calls=JSON.parse(await readFile(path.join(root,'calls.json'),'utf8'));assert.ok(!calls.some((c:any)=>c.method==='turn/start'));
  }finally{await connection.disconnect();}
});
