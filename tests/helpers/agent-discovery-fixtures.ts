import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import { AgentToolHost } from '../../src/core/agent-tool-host';
import type { AgentToolSnapshot } from '../../src/core/agent-tools';
import type { AdapterRun, AgentAdapter } from '../../src/core/discovery-run';
import { LEGACY_ID_CONFIGURATION } from '../../src/core/id-configuration';

/** Bundles of the MCP proxy and the tool worker, built as the application builds them. */
let bundles: Promise<{ proxy: string; worker: string }> | undefined;
export function agentBundles() {
  return bundles ??= (async () => {
    const out = path.resolve('.cache/agent-discovery-tests/dist'); await mkdir(out, { recursive: true });
    const proxy = path.join(out, 'specular-mcp.cjs'), worker = path.join(out, 'agent-tools-worker.cjs');
    await Promise.all([
      build({ entryPoints: ['src/mcp/specular-mcp.ts'], outfile: proxy, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' }),
      build({ entryPoints: ['src/workers/agent-tools.ts'], outfile: worker, bundle: true, platform: 'node', format: 'cjs', target: 'node22', logLevel: 'silent' }),
    ]);
    return { proxy, worker };
  })();
}
export async function toolHost(snapshot: AgentToolSnapshot, callMs?: number) {
  const { worker } = await agentBundles();
  return new AgentToolHost(snapshot, data => new Worker(worker, { workerData: data }), callMs);
}
export async function proxyLaunch() { return { command: process.execPath, args: [(await agentBundles()).proxy] }; }

export const PROJECT: Record<string, string> = {
  'specs/001-login/spec.md': '# Login\n\n## Requirements\n\n- **FR-001**: Users sign in with email.\n- **FR-002**: Sessions expire after 30 minutes.\n\nLint rule S1172 is unrelated.\n',
  'specs/001-login/tasks.md': '# Tasks\n\n- [ ] T001 Implement sign-in (FR-001)\n- [x] T002 Add expiry (FR-002)\n',
  'specs/002-export/spec.md': '# Export\n\n- **FR-001**: Users export reports.\n\n```\nFR-999 in code\n```\n',
  'specs/002-export/tasks.md': '# Tasks\n\n- [ ] T001 Build export (FR-001, FR-003)\n',
  'README.md': '# Demo\n\nSee specs. Priority P1.\n\n**Created**: 2026-01-05\n',
};
export const SNAPSHOT: AgentToolSnapshot = { documents: PROJECT, configuration: structuredClone(LEGACY_ID_CONFIGURATION) };
export const GOOD_DRAFT = {
  categories: [{ key: 'requirements', name: 'Functional requirements', role: 'requirement', idScopes: [{ pattern: 'specs/*' }] }, { key: 'tasks', name: 'Tasks', role: 'task', idScopes: [{ pattern: 'specs/*' }] }],
  rules: [{ key: 'fr', category: 'requirements', pattern: '\\bFR-\\d{3}\\b' }, { key: 't', category: 'tasks', pattern: '\\bT\\d{3}\\b' }],
  idDefinitionSites: { headings: { enabled: true, levels: [1, 2, 3, 4, 5, 6], mode: 'start' }, tables: { enabled: true, column: 'ID', mode: 'exact' }, lists: { enabled: true, types: ['unordered', 'ordered'], mode: 'start' }, paragraphs: { enabled: false, mode: 'start' } },
};
export const RATIONALE = { requirements: 'FR-NNN bullets define functional requirements per spec folder.', tasks: 'TNNN checklist items define tasks per spec folder.' };
/** Increment 87: the fake agents' `statuses` scenario proposes a checkbox site, statuses, and date rules with a gap. */
const TEXT_STATUS_SITES = { paragraphs: { enabled: true, mode: 'literal', label: 'Status:' }, tables: { enabled: true, mode: 'full', column: 'Status' }, headings: { enabled: false, mode: 'regex', pattern: '\\[(?<status>[^\\]]+)\\]$' } };
export const STATUS_DRAFT = { ...GOOD_DRAFT,
  statusSites: { ...TEXT_STATUS_SITES, checkboxes: { enabled: true, markers: { x: 'Done', ' ': 'Open' } } },
  statuses: [{ name: 'Open', colors: { light: '#b45309' } }, { name: 'Done', rules: [{ mode: 'exact', value: 'Done' }] }],
  dates: { rules: [{ key: 'list-entry', site: 'list-entry' }, { key: 'created', site: 'field', label: 'Created', kind: 'milestone' }], exclude: [] } };
export const STATUS_EXTRA = { statusRationale: 'Tasks are tracked with checkboxes: [x] is Done and [ ] is Open.', dateRationale: 'Only Created fields and dated list entries carry dates.',
  gaps: [{ description: 'Task priorities are written as [P] markers that no status site reads.', examples: [{ path: 'specs/001-login/tasks.md', line: 3 }] }] };

/** A project whose statuses need mapping: decorated Spec Kit values, Kiro checkboxes, and dates (87). */
export const STATUS_PROJECT: Record<string, string> = {
  'specs/001-login/spec.md': '# Login\n\n## FR-001 Sign in\n\n**Status**: 🔜 Planned\n\n## FR-002 Expiry\n\n**Status**: ✅ Complete\n\n## FR-003 Export\n\n**Status**: Draft\n\n**Created**: 2026-01-05\n',
  'specs/001-login/tasks.md': '# Tasks\n\n- [x] T001 Sign in (FR-001)\n- [ ] T002 Expiry (FR-002)\n- [-] T003 Export (FR-003)\n- T004 Document export\n',
  'CHANGELOG.md': '# Changelog\n\n- 2026-02-01: Released sign-in.\n',
  'vendor/upstream/CHANGELOG.md': '# Upstream\n\n- 2020-01-01: Upstream entry.\n',
};
export const STATUS_SNAPSHOT: AgentToolSnapshot = { documents: STATUS_PROJECT, configuration: structuredClone(LEGACY_ID_CONFIGURATION) };
const HEADING_DRAFT = { ...GOOD_DRAFT, idDefinitionSites: { ...GOOD_DRAFT.idDefinitionSites, headings: { enabled: true, levels: [2], mode: 'start' } } };
export const FIRST_STATUS_DRAFT = { ...HEADING_DRAFT, statusSites: { ...TEXT_STATUS_SITES, checkboxes: { enabled: true, markers: { x: 'Done', ' ': 'Open', '-': 'In progress' } } }, statuses: [{ name: 'Open' }, { name: 'In progress' }, { name: 'Done' }] };
export const SECOND_STATUS_DRAFT = { ...FIRST_STATUS_DRAFT,
  statuses: [{ name: 'Planned', rules: [{ mode: 'regex', value: 'Planned$' }] }, { name: 'Open' }, { name: 'In progress' }, { name: 'Done', rules: [{ mode: 'exact', value: 'Done' }, { mode: 'regex', value: 'Complete$' }] }, { name: 'Draft' }],
  dates: { rules: [{ key: 'list-entry', site: 'list-entry' }, { key: 'created', site: 'field', label: 'Created', kind: 'milestone' }, { key: 'last-updated', site: 'field', label: 'Last Updated', kind: 'snapshot' }], exclude: ['vendor'] } };

/** A minimal MCP client over a child process's stdio. */
export class McpClient {
  private buffer = '';
  private serial = 0;
  private pending = new Map<number, (value: any) => void>();
  readonly closed: Promise<number | null>;
  constructor(readonly child: ChildProcessWithoutNullStreams) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk; let newline: number;
      while ((newline = this.buffer.indexOf('\n')) >= 0) {
        const line = this.buffer.slice(0, newline); this.buffer = this.buffer.slice(newline + 1);
        if (!line.trim()) continue;
        const message = JSON.parse(line); this.pending.get(message.id)?.(message); this.pending.delete(message.id);
      }
    });
    this.closed = new Promise(resolve => child.once('close', code => { for (const done of this.pending.values()) done({ error: { code: -1, message: 'closed' } }); this.pending.clear(); resolve(code); }));
  }
  static start(launch: { command: string; args: string[]; env: Record<string, string> }) {
    return new McpClient(spawn(launch.command, launch.args, { env: { ...process.env, ...launch.env }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }));
  }
  request(method: string, params: unknown = {}): Promise<any> {
    const id = ++this.serial;
    return new Promise(resolve => { this.pending.set(id, resolve); this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  }
  notify(method: string) { this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method }) + '\n'); }
  async initialize() {
    const response = await this.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    this.notify('notifications/initialized'); return response;
  }
  async tool(name: string, args: unknown = {}) {
    const response = await this.request('tools/call', { name, arguments: args });
    const text: string = response.result?.content?.[0]?.text ?? '';
    let value: any; try { value = JSON.parse(text); } catch { value = text; }
    const notice: string | undefined = response.result?.content?.[1]?.text;
    return { isError: response.result?.isError === true, value, error: response.error, notice };
  }
  stop() { this.child.kill(); }
}

export type AgentScript = (client: McpClient, run: AdapterRun) => Promise<void>;
/** A scripted agent: it starts the MCP proxy as an agent would and calls tools in order. */
export function scriptedAdapter(script: AgentScript, followUp?: (client: McpClient, text: string) => Promise<void>): AgentAdapter & { clients: McpClient[]; followUps: string[] } {
  const clients: McpClient[] = [], followUps: string[] = [];
  return {
    name: 'Scripted agent', clients, followUps,
    async start(run) {
      const client = McpClient.start(run.mcp); clients.push(client);
      let stopped = false;
      void (async () => {
        try {
          await client.initialize(); await script(client, run);
          // A follow-up turn (92): the agent answers it with the follow-up script, or ends again without one.
          const text = stopped ? undefined : run.followUp();
          if (text) { followUps.push(text); await followUp?.(client, text); }
          if (!stopped) run.ended();
        }
        catch (error) { if (!stopped) run.ended(`Scripted agent failed: ${(error as Error).message}`); }
      })();
      return { stop: async () => { stopped = true; client.stop(); await client.closed; } };
    },
  };
}
export const standardScript: AgentScript = async client => {
  await client.tool('project_overview');
  await client.tool('read_markdown', { path: 'specs/001-login/spec.md' });
  const first = await client.tool('evaluate_configuration', { configuration: { ...GOOD_DRAFT, rules: [{ key: 'fr', category: 'requirements', prefix: 'FR' }, { key: 't', category: 'tasks', prefix: 'T', separator: '' }] } });
  await client.tool('list_matches', { evaluationId: first.value.evaluationId, category: 'requirements' });
  await client.tool('evaluate_configuration', { configuration: GOOD_DRAFT });
  const rejected = await client.tool('submit_proposal', { configuration: GOOD_DRAFT, rationale: { requirements: 'Only one.' } });
  if (!rejected.isError) throw new Error('Expected the incomplete rationale to be rejected.');
  await client.tool('submit_proposal', { configuration: GOOD_DRAFT, rationale: RATIONALE, summary: 'Spec Kit requirements and tasks.' });
  await new Promise(resolve => setTimeout(resolve, 5000)); // the run ends the agent
};

/** A fake headless `claude` (npm-style .cmd launcher) that starts the MCP server from --mcp-config and streams JSON events. */
export async function fakeClaude(scenario: 'standard' | 'statuses' | 'violation' | 'extra-tool' | 'signed-out' | 'no-submit' | 'follow-up' | 'slow') {
  const base = path.resolve('.cache/agent-discovery-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'claude ')); const executable = path.join(root, 'claude.cmd'), script = path.join(root, 'claude.cjs');
  await writeFile(executable, `@echo off\r\nif "%~1"=="--version" (\r\necho 2.1.300 ^(Claude Code^)\r\nexit /b 0\r\n)\r\n"${process.execPath}" "${script}" %*\r\n`);
  await writeFile(script, `const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=${JSON.stringify(root)},scenario=${JSON.stringify(scenario)},draft=${JSON.stringify(scenario === 'statuses' ? STATUS_DRAFT : GOOD_DRAFT)},rationale=${JSON.stringify(RATIONALE)},extra=${JSON.stringify(scenario === 'statuses' ? STATUS_EXTRA : {})};
const args=process.argv.slice(2),flag=name=>args[args.indexOf(name)+1];
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const queue=[];let waiter,closed=false;const take=v=>{const w=waiter;waiter=undefined;w(v);};
require('node:readline').createInterface({input:process.stdin}).on('line',l=>{if(!l.trim())return;const text=JSON.parse(l).message.content[0].text;if(waiter)take(text);else queue.push(text);}).on('close',()=>{closed=true;if(waiter)take(null);});
const next=()=>queue.length?Promise.resolve(queue.shift()):closed?Promise.resolve(null):new Promise(r=>waiter=r);
(async()=>{
  const prompt=await next();
  fs.writeFileSync(path.join(root,'invocation.json'),JSON.stringify({pid:process.pid,args,cwd:process.cwd(),cwdEntries:fs.readdirSync(process.cwd()),prompt,systemPrompt:fs.readFileSync(flag('--system-prompt-file'),'utf8')}));
  const s=JSON.parse(fs.readFileSync(flag('--mcp-config'),'utf8')).mcpServers.specular;
  const child=spawn(s.command,s.args,{env:{...process.env,...s.env},stdio:['pipe','pipe','pipe'],windowsHide:true});
  let buffer='',serial=0;const pending=new Map();child.stdout.setEncoding('utf8');child.stdout.on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;const m=JSON.parse(line);pending.get(m.id)?.(m);pending.delete(m.id);}});
  const request=(method,params)=>new Promise(r=>{const id=++serial;pending.set(id,r);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n');});
  await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'claude',version:'0'}});
  const tools=(await request('tools/list',{})).result.tools.map(t=>'mcp__specular__'+t.name);
  send({type:'system',subtype:'init',cwd:process.cwd(),tools:scenario==='extra-tool'?[...tools,'Bash']:tools,mcp_servers:[{name:'specular',status:'connected'}],permissionMode:flag('--permission-mode'),slash_commands:[]});
  if(scenario==='signed-out'){send({type:'result',subtype:'success',is_error:true,result:'Not logged in · Please run /login'});child.kill();process.exit(0);}
  const call=async(name,input)=>{send({type:'assistant',message:{model:'fake',content:[{type:'tool_use',id:'t'+serial,name:'mcp__specular__'+name,input}]}});return request('tools/call',{name,arguments:input});};
  send({type:'assistant',message:{model:'fake',content:[{type:'text',text:'1. Survey first.\\n2. Then evaluate.'}]}});
  await call('project_overview',{});
  if(scenario==='slow')await new Promise(r=>setTimeout(r,60000));
  if(scenario==='violation'){send({type:'assistant',message:{model:'fake',content:[{type:'tool_use',id:'x',name:'Bash',input:{command:'type secrets.env'}}]}});}
  const evaluated=JSON.parse((await call('evaluate_configuration',{configuration:draft})).result.content[0].text);
  const submits=scenario!=='no-submit'&&scenario!=='follow-up';
  if(submits)await call('submit_proposal',{configuration:draft,rationale,...extra});
  await new Promise(r=>setTimeout(r,submits?5000:100));
  send({type:'result',subtype:'success',is_error:false,result:'Done.'});
  // Increment 92: follow-up user messages; the follow-up scenario submits its evaluated draft by ID.
  const followUps=[];
  for(let text;(text=await next())!==null;){
    followUps.push(text);fs.writeFileSync(path.join(root,'follow-ups.json'),JSON.stringify(followUps));
    send({type:'system',subtype:'init',cwd:process.cwd(),tools,mcp_servers:[{name:'specular',status:'connected'}],permissionMode:flag('--permission-mode'),slash_commands:[]});
    if(scenario==='follow-up'){await call('submit_proposal',{evaluationId:evaluated.evaluationId,rationale});await new Promise(r=>setTimeout(r,5000));}
    send({type:'result',subtype:'success',is_error:false,result:'Done again.'});
  }
  child.kill();process.exit(0);
})();`);
  return { root, executable, invocation: path.join(root, 'invocation.json') };
}

/** A fake `codex app-server` that starts the per-thread MCP server and runs a scripted agent turn over it. */
export async function fakeCodex(scenario: 'standard' | 'statuses' | 'violation' | 'no-submit' | 'follow-up' | 'extra-server') {
  const base = path.resolve('.cache/agent-discovery-tests'); await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, 'codex-')); const executable = path.join(root, 'codex.cmd'), script = path.join(root, 'server.cjs');
  await writeFile(executable, `@echo off\r\nif "%~1"=="--version" (\r\necho codex-cli 0.155.1\r\nexit /b 0\r\n)\r\n"${process.execPath}" "${script}"\r\n`);
  await writeFile(script, `const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=${JSON.stringify(root)},scenario=${JSON.stringify(scenario)},draft=${JSON.stringify(scenario === 'statuses' ? STATUS_DRAFT : GOOD_DRAFT)},rationale=${JSON.stringify(RATIONALE)},extra=${JSON.stringify(scenario === 'statuses' ? STATUS_EXTRA : {})};
const log=m=>fs.appendFileSync(path.join(root,'log.jsonl'),JSON.stringify(m)+'\\n');
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
let loggedIn=false,config,thread='thread-1',turn='turn-1',interrupted=false,servers=[];
function mcp(){const s=config.mcp_servers.specular;const child=spawn(s.command,s.args,{env:{...process.env,...s.env},stdio:['pipe','pipe','pipe'],windowsHide:true});servers.push(child);
  let buffer='',serial=0;const pending=new Map();child.stdout.setEncoding('utf8');child.stdout.on('data',c=>{buffer+=c;let i;while((i=buffer.indexOf('\\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);if(!line.trim())continue;const m=JSON.parse(line);pending.get(m.id)?.(m);pending.delete(m.id);}});
  const request=(method,params)=>new Promise(r=>{const id=++serial;pending.set(id,r);child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\\n');});
  return {child,request,async init(){await request('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'codex',version:'0'}});child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\\n');}};}
const event=(method,params)=>send({method,params:{threadId:thread,...params}});
let item=0;
async function call(server,tool,args){const id='item-'+(++item);event('item/started',{item:{type:'mcpToolCall',id,server:'specular',tool,arguments:args,status:'inProgress'}});const r=await server.request('tools/call',{name:tool,arguments:args});event('item/completed',{item:{type:'mcpToolCall',id,server:'specular',tool,status:'completed'}});log({tool,isError:r.result?.isError});return r;}
let turns=0,agentServer,evaluationId;
async function finishTurn(){for(let i=0;i<50&&!interrupted;i++)await new Promise(r=>setTimeout(r,100));
  event('item/completed',{item:{type:'agentMessage',id:'final',text:'Done.'}});
  event('turn/completed',{turn:{id:turn,status:interrupted?'interrupted':'completed',error:null}});}
async function followUp(text){log({followUp:text});if(scenario==='follow-up')await call(agentServer,'submit_proposal',{evaluationId,rationale});await finishTurn();}
async function agent(){const server=agentServer=mcp();await server.init();
  await call(server,'project_overview',{});
  event('item/completed',{item:{type:'agentMessage',id:'note',text:'1. Surveyed the spec folders.\\n2. Next I will evaluate a draft with FR and T rules, then check its matches for codes that are not records before submitting it.'}});
  if(scenario==='violation'){event('item/started',{item:{type:'commandExecution',id:'cmd',command:'cat secrets.env'}});await new Promise(r=>setTimeout(r,3000));}
  evaluationId=JSON.parse((await call(server,'evaluate_configuration',{configuration:draft})).result.content[0].text).evaluationId;
  if(scenario!=='no-submit'&&scenario!=='follow-up')await call(server,'submit_proposal',{configuration:draft,rationale,...extra});
  await finishTurn();}
require('node:readline').createInterface({input:process.stdin}).on('line',async line=>{const m=JSON.parse(line);if(!m.method)return;log({method:m.method,params:m.method==='account/login/start'?{}:m.params});if(m.id===undefined)return;let result={};
  if(m.method==='config/read')result=m.params.cwd?{config:{cli_auth_credentials_store:'ephemeral',sandbox_mode:'read-only',approval_policy:'never',web_search:'disabled',features:{hooks:false,multi_agent:false},windows:{sandbox:'unelevated'},mcp_servers:{}},layers:[]}:{config:{cli_auth_credentials_store:'ephemeral'}};
  if(m.method==='account/read')result={account:loggedIn?{type:'apiKey'}:null};
  if(m.method==='account/login/start'){loggedIn=true;event('account/login/completed',{success:true});result={type:'apiKey'};}
  if(m.method==='thread/start'){config=m.params.config;result={cwd:m.params.cwd,thread:{id:thread,ephemeral:true,cwd:m.params.cwd},approvalPolicy:'never',sandbox:{type:'readOnly',networkAccess:false}};}
  if(m.method==='mcpServerStatus/list'){const server=mcp();await server.init();const list=await server.request('tools/list',{});server.child.kill();const tools=Object.fromEntries(list.result.tools.map(t=>[t.name,t]));
    result={data:[{name:'specular',runtimeStatus:'connected',tools,authStatus:'unsupported'},...(scenario==='extra-server'?[{name:'other',runtimeStatus:'connected',tools:{},authStatus:'unsupported'}]:[])]};}
  if(m.method==='turn/start'){turn='turn-'+(++turns);result={turn:{id:turn,status:'inProgress'}};const first=turns===1;setTimeout(()=>{event('turn/started',{turn:{id:turn}});void (first?agent():followUp(m.params.input[0].text));},10);}
  if(m.method==='turn/interrupt')interrupted=true;
  send({id:m.id,result});});
process.stdin.on('end',()=>{for(const s of servers)s.kill();process.exit(0);});`);
  return { root, executable, log: path.join(root, 'log.jsonl') };
}
