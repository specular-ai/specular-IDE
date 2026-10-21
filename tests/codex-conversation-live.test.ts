import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { CodexConnection } from '../src/core/codex-connection';
import { CodexConversation } from '../src/core/codex-conversation';

const enabled = !!process.env.SPECULAR_LIVE_CODEX_CHAT;
async function create(key: string) {
  const base=path.resolve('.cache/codex-conversation-live'); await mkdir(base,{recursive:true}); const root=await mkdtemp(path.join(base,'run-'));
  const connection=new CodexConnection(root,()=>{}); const snapshots: ReturnType<CodexConversation['snapshot']>[]=[];
  const conversation=new CodexConversation(connection,state=>snapshots.push(state));
  assert.equal((await connection.connect('',key)).status,'connected');
  return {root,connection,conversation,snapshots};
}
async function settled(conversation: CodexConversation) {
  for(let i=0;i<1200;i++){const state=conversation.snapshot();if(!['starting','running','stopping'].includes(state.status))return state;await new Promise(resolve=>setTimeout(resolve,100));}
  assert.fail('Live turn did not finish within two minutes.');
}
async function checkKeyFiles(root:string,key:string):Promise<void> {
  for(const entry of await readdir(root,{withFileTypes:true})) {
    const file=path.join(root,entry.name);
    if(entry.isDirectory()) await checkKeyFiles(file,key);
    else if(entry.isFile() && (await stat(file)).size) assert.equal((await readFile(file)).includes(key),false,'A supplied key was persisted.');
  }
}
test('live Windows read-only enforcement, streaming, follow-up context and cancellation', {skip:!enabled || !process.env.OPENAI_API_KEY, timeout:240_000}, async()=>{
  const key=process.env.OPENAI_API_KEY!; const {root,connection,conversation,snapshots}=await create(key);
  const report:Record<string,unknown>={runtime:connection.snapshot().version,readControl:false,writeDenied:false,createDenied:false,modelTurnWriteDenied:false,streaming:false,followUp:false,interrupted:false};
  try {
    const {client,cwd}=connection.runtime()!; const pid=client.child.pid!;
    let deltas=0, blockedCommands=0;
    connection.subscribe((method,params)=>{
      if(method==='item/agentMessage/delta') deltas++;
      const item=(params as {item?:{type?:string;command?:string;exitCode?:number}})?.item;
      if(method==='item/completed' && item?.type==='commandExecution' && item.command?.includes('sentinel.txt') && item.exitCode!==undefined && item.exitCode!==0) blockedCommands++;
    });
    await writeFile(path.join(cwd,'sentinel.txt'),'unchanged');
    const shell=path.join(process.env.SystemRoot!,'System32/WindowsPowerShell/v1.0/powershell.exe');
    const command=async(text:string)=>await client.request('command/exec',{command:[shell,'-NoProfile','-NonInteractive','-Command',text],cwd,sandboxPolicy:{type:'readOnly',networkAccess:false},timeoutMs:5000}) as {exitCode:number;stdout:string;stderr:string};
    const read=await command('Get-Content -LiteralPath sentinel.txt'); assert.equal(read.exitCode,0); assert.match(read.stdout,/unchanged/);report.readControl=true;
    const write=await command('Set-Content -LiteralPath sentinel.txt -Value changed -ErrorAction Stop');assert.notEqual(write.exitCode,0);report.writeDenied=true;
    const create=await command('Set-Content -LiteralPath forbidden.txt -Value changed -ErrorAction Stop');assert.notEqual(create.exitCode,0);report.createDenied=true;
    const models=await conversation.models();const model=process.env.SPECULAR_LIVE_CODEX_MODEL || models.models.find(m=>m.isDefault)?.id;assert.ok(model);report.model=model;
    assert.equal((await conversation.send('Remember the code ORBIT-731. Reply with that code only.',model)).ok,true);
    assert.equal((await settled(conversation)).status,'completed');
    report.streaming=deltas>0;
    assert.equal(report.streaming,true);
    await conversation.send('What code did I ask you to remember? Reply with the code only.',model);
    let state=await settled(conversation);assert.equal(state.status,'completed');assert.match(state.messages.at(-1)!.text,/ORBIT-731/);report.followUp=true;
    await conversation.send('This is a disposable sandbox test. Use the shell tool to attempt to write changed into sentinel.txt. Report whether the sandbox blocks it, in at most 20 words.',model);
    state=await settled(conversation);assert.equal(state.status,'completed');
    assert.equal(await readFile(path.join(cwd,'sentinel.txt'),'utf8'),'unchanged');assert.deepEqual(await readdir(cwd),['sentinel.txt']);assert.ok(blockedCommands>0,'A model-triggered write attempt must actually run and fail.');report.modelTurnWriteDenied=true;
    await conversation.send('Write 500 numbered example requirement titles.',model);await conversation.stop();assert.equal((await settled(conversation)).status,'interrupted');report.interrupted=true;
    await connection.disconnect();assert.throws(()=>process.kill(pid,0));report.processExited=true;
    await checkKeyFiles(root,key);report.noPersistedKey=true;
  } finally { await connection.disconnect();await writeFile(path.join(root,'verification.json'),JSON.stringify(report,null,2)+'\n'); }
});
test('live OpenAI rejection of a synthetic key produces a safe actionable error', {skip:!enabled,timeout:120_000},async()=>{
  const key='sk-specular-synthetic-invalid-conversation-key'; const {root,connection,conversation}=await create(key);
  try {
    const models=await conversation.models();const model=process.env.SPECULAR_LIVE_CODEX_MODEL || models.models.find(m=>m.isDefault)?.id;assert.ok(model);
    assert.equal((await conversation.send('Reply OK only.',model)).ok,true);
    const state=await settled(conversation);assert.equal(state.status,'error');assert.match(state.message,/API key/);assert.ok(!JSON.stringify(state).includes(key));
  } finally { await connection.disconnect(); }
  await checkKeyFiles(root,key);
});
