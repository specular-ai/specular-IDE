import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** A real child process with controlled JSONL event ordering and failures. */
export async function conversationFixture(unsafe = false, options: { threadDelayMs?: number; turnStartFailure?: boolean; ignoreStop?: boolean; unsafeProject?: boolean; version?: string; commandDelayMs?: number; statusFailure?: boolean; resumeFailure?: boolean; unsafeResume?: boolean; resumeDelayMs?: number; compact?: 'early' | 'hold' | 'fail' | 'missing' | 'delayed' } = {}) {
  const base = path.resolve('.cache/codex-conversation-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'run-')); const executable = path.join(root, 'codex.cmd'); const script = path.join(root, 'server.cjs');
  await writeFile(executable, `@echo off\r\nif "%~1"=="--version" (\r\necho codex-cli ${options.version ?? '0.154.0'}\r\nexit /b 0\r\n)\r\n"${process.execPath}" "${script}"\r\n`);
  await writeFile(script, `const fs = require('node:fs'); const path = require('node:path');
    const root = ${JSON.stringify(root)}; fs.writeFileSync(path.join(root,'pid.txt'), String(process.pid));
    const historyFile=path.join(process.env.CODEX_HOME,'fixture-history.json');
    let history={};try{history=JSON.parse(fs.readFileSync(historyFile,'utf8'));}catch{}
    const save=()=>fs.writeFileSync(historyFile,JSON.stringify(history));
    let loggedIn = false, thread = Math.max(0,...Object.keys(history).map(id=>Number(id.slice(7)))), turn = 0, first = '', active, timer, cwd; const calls = [];
    const send = m => process.stdout.write(JSON.stringify(m)+'\\n');
    const event = (method, params) => send({method, params: {threadId:'thread-'+thread, ...params}});
    const complete = (status='completed', error=null) => { clearTimeout(timer); if (active) event('turn/completed',{turn:{id:active,status,error}}); };
    require('node:readline').createInterface({input:process.stdin}).on('line', line => {
      const m=JSON.parse(line); if (!m.method) { calls.push({reply:m.id, result:m.result, error:m.error}); fs.writeFileSync(path.join(root,'calls.json'),JSON.stringify(calls)); return; }
      calls.push({method:m.method, params:m.method==='account/login/start'?{}:m.params}); fs.writeFileSync(path.join(root,'calls.json'),JSON.stringify(calls));
      if (!m.id) return; let result={};
      if(m.method==='config/read') result={config:{cli_auth_credentials_store:'ephemeral'}};
      if(m.method==='config/read' && m.params.cwd) result={config:{cli_auth_credentials_store:'ephemeral',sandbox_mode:'read-only',approval_policy:'never',web_search:'disabled',features:{hooks:false,multi_agent:false},windows:{sandbox:'unelevated'},mcp_servers:{}},layers:[{name:{type:'project'},disabledReason:${JSON.stringify(options.unsafeProject ? null : 'Untrusted project')} }]};
      if(m.method==='account/read') result={account:loggedIn?{type:'apiKey'}:null};
      if(m.method==='account/login/start') {loggedIn=true; event('account/login/completed',{success:true}); result={type:'apiKey'};}
      if(m.method==='model/list') result={data:[{model:'fixture-model',displayName:'Fixture model',isDefault:true},{model:'alternate-model',displayName:'Alternate model'}],nextCursor:null};
      if(m.method==='thread/start') {thread++; first=''; turn=0; cwd=m.params.cwd; history['thread-'+thread]={cwd,first,turn,ephemeral:m.params.ephemeral??true};if(m.params.ephemeral===false)save(); result={cwd,thread:{id:'thread-'+thread,ephemeral:m.params.ephemeral ?? true,cwd},approvalPolicy:'never',sandbox:{type:${JSON.stringify(unsafe ? 'workspaceWrite' : 'readOnly')},networkAccess:false}};}
      if(m.method==='thread/read') {
        if(${!!options.statusFailure}) {send({id:m.id,error:{code:-32000,message:'secret raw status failure'}});return;}
        const saved=history[m.params.threadId]; if(!saved){send({id:m.id,error:{code:-32000,message:'missing history'}});return;}
        result={thread:{id:m.params.threadId,cwd:saved.cwd,ephemeral:saved.ephemeral,status:{type:'idle'}}};
        if(${options.commandDelayMs ?? 0}) {setTimeout(()=>send({id:m.id,result}),${options.commandDelayMs ?? 0});return;}
      }
      if(m.method==='thread/resume') {
        const saved=history[m.params.threadId];
        if(!saved || ${!!options.resumeFailure}) {send({id:m.id,error:{code:-32000,message:'private resume error'}});return;}
        thread=Number(m.params.threadId.slice(7));cwd=saved.cwd;first=saved.first;turn=saved.turn;
        result={cwd,thread:{id:m.params.threadId,cwd,ephemeral:false},approvalPolicy:'never',sandbox:{type:${JSON.stringify(options.unsafeResume?'workspaceWrite':'readOnly')},networkAccess:false}};
        if(${options.resumeDelayMs??0}) {setTimeout(()=>send({id:m.id,result}),${options.resumeDelayMs??0});return;}
      }
      if(m.method==='thread/compact/start') {
        if(${options.compact === 'fail'}) {send({id:m.id,error:{code:-32000,message:'secret raw compaction failure'}});return;}
        const start=()=>{
          active='turn-'+(++turn);const turnId=active;
          event('turn/started',{turn:{id:turnId,status:'inProgress'}});
          event('item/completed',{threadId:'unrelated',turnId,item:{type:'contextCompaction',id:'noise'}});
          if(${options.compact === 'hold' || options.compact === 'delayed'}) return;
          const finish=()=>{if(${options.compact !== 'missing'})event('item/completed',{turnId,item:{type:'contextCompaction',id:'compact-'+turnId}});complete();};
          if(${options.compact === 'early'})finish();else timer=setTimeout(finish,120);
        };
        if(${options.compact === 'delayed'})setTimeout(start,150);else start();
        send({id:m.id,result:{}});return;
      }
      if(m.method==='thread/start' && ${options.threadDelayMs ?? 0}) { setTimeout(()=>send({id:m.id,result}),${options.threadDelayMs ?? 0}); return; }
      if(m.method==='turn/start') {
        if(${!!options.turnStartFailure}) {send({id:m.id,error:{code:-32000,message:'private dispatch failure'}});return;}
        const text=m.params.input[0].text; active='turn-'+(++turn); const turnId=active; first ||= text;
        if(history['thread-'+thread]){Object.assign(history['thread-'+thread],{first,turn});if(!history['thread-'+thread].ephemeral)save();}
        event('turn/started',{turn:{id:turnId,status:'inProgress'}});
        const delta = value => event('item/agentMessage/delta',{turnId,itemId:'answer-'+turnId,delta:value});
        if(text==='crash') { delta('Partial before exit'); setTimeout(()=>process.exit(1),60); }
        else if(text==='hold') delta('Partial answer');
        else if(text==='rejected key') { delta('Partial before rejection'); timer=setTimeout(()=>complete('failed',{message:'secret raw error sk-do-not-expose',codexErrorInfo:'unauthorized'}),80); }
        else if(text==='bad model') timer=setTimeout(()=>complete('failed',{message:'private upstream detail',codexErrorInfo:{httpConnectionFailed:{httpStatusCode:404}}}),80);
        else if(text==='approvals') { for (const [i,method] of ['item/commandExecution/requestApproval','item/fileChange/requestApproval','item/permissions/requestApproval','item/tool/call'].entries()) send({id:800+i,method,params:{threadId:'thread-'+thread,turnId}}); timer=setTimeout(()=>{delta('Approvals refused');complete();},100); }
        else {
          const answer=text==='follow-up'?'Remembered: '+first:'Reply: '+text;
          event('item/agentMessage/delta',{threadId:'unrelated',turnId,itemId:'noise',delta:'WRONG THREAD'});
          delta(answer.slice(0,7));
          const finish=()=>{delta(answer.slice(7));event('item/completed',{turnId,item:{type:'agentMessage',id:'answer-'+turnId,text:answer}});complete();};
          if(text==='early') finish(); else timer=setTimeout(finish,120);
        }
        const response={id:m.id,result:{turn:{id:turnId,status:'inProgress'}}};
        if(text==='delayed start') setTimeout(()=>send(response),250); else send(response); return;
      }
      if(m.method==='turn/interrupt' && ${!options.ignoreStop}) complete('interrupted');
      send({id:m.id,result});
    });`);
  return { root, executable, userData: path.join(root, 'user-data') };
}
