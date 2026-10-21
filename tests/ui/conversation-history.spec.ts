import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { conversationFixture } from '../helpers/codex-runtime';
let app: ElectronApplication; let page: Page; let fixture: Awaited<ReturnType<typeof conversationFixture>>;
async function launch() {
  const env=Object.fromEntries(Object.entries(process.env).filter(([k,v])=>k!=='ELECTRON_RUN_AS_NODE'&&v!==undefined)) as Record<string,string>;
  app=await electron.launch({...process.env.SPECULAR_TEST_PACKAGED?{executablePath:path.resolve('out',`Specular-${process.platform}-${process.arch}`,'Specular.exe'),args:[]}:{args:['.']},cwd:process.cwd(),env:{...env,SPECULAR_USER_DATA:fixture.userData}});
  page=await app.firstWindow();await expect(page.locator('#welcome')).toBeVisible();await expect(page.locator('.topbar')).not.toHaveAttribute('inert','');
}
async function connect(remember=false,automatic=false) {
  await page.locator('#show-agent-setup').click();await page.locator('#codex-path').fill(fixture.executable);await page.locator('#codex-api-key').fill('sk-history-ui');
  if(remember)await page.locator('#codex-remember-key').check();if(automatic)await page.locator('#codex-auto-connect').check();
  await page.locator('#codex-connect').click();await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status','connected');await page.locator('#agent-setup-close').click();
}
async function close() {await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());await app.close();}
async function send(text:string){await page.locator('#conversation-prompt').fill(text);await page.locator('#conversation-send').click();}
const status=()=>page.locator('#conversation-status');
test.beforeEach(async()=>{fixture=await conversationFixture();});
test.afterEach(async({},info)=>{if(app){if(info.status!==info.expectedStatus)await page.screenshot({path:info.outputPath('failure.png')}).catch(()=>{});await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close().catch(()=>{});}});

test('restart restores readable offline history and selected model; explicit resume retains native context and fresh requires confirmation',async()=>{
  await launch();await connect();await page.locator('#show-conversation').click();await page.locator('#conversation-model').fill('alternate-model');await send('Remember original');await expect(status()).toHaveAttribute('data-status','completed');await close();
  await launch();await page.locator('#show-conversation').click();await expect(page.locator('#conversation-transcript')).toContainText('Reply: Remember original');await expect(page.locator('#conversation-model')).toHaveValue('alternate-model');await expect(page.locator('#conversation-resume')).toBeDisabled();await expect(page.locator('#conversation-send')).toBeDisabled();
  await page.screenshot({path:'test-results/saved-conversation-offline.png'});
  await page.locator('#conversation-hide').click();await connect();await page.locator('#show-conversation').click();await expect(page.locator('#conversation-send')).toBeDisabled();await page.locator('#conversation-resume').click();await expect(status()).toContainText('Original Codex context resumed');
  await send('follow-up');await expect(status()).toHaveAttribute('data-status','completed');await expect(page.locator('#conversation-transcript')).toContainText('Remembered: Remember original');
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:0,checkboxChecked:false});});await page.locator('#conversation-fresh').click();await expect(page.locator('#conversation-transcript')).toContainText('Remembered: Remember original');
  await app.evaluate(({dialog})=>{dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});});await page.locator('#conversation-fresh').click();await expect(page.locator('#conversation-transcript .conversation-message')).toHaveCount(0);
  await send('fresh text');await expect(status()).toHaveAttribute('data-status','completed');await expect(page.locator('#conversation-transcript')).not.toContainText('Remember original');
});

test('auto-connect never resumes or sends; interrupted text survives and native resume failure preserves history',async()=>{
  await launch();await connect(true,true);await page.locator('#show-conversation').click();await send('hold');await expect(status()).toHaveAttribute('data-status','running');await expect(page.locator('#conversation-transcript')).toContainText('Partial answer');await close();
  await launch();await page.locator('#show-conversation').click();await expect(page.locator('#conversation-connection')).toHaveText('Connected');await expect(status()).toHaveAttribute('data-status','interrupted');await expect(page.locator('#conversation-transcript')).toContainText('Partial answer');await expect(page.locator('#conversation-send')).toBeDisabled();
  const calls=JSON.parse(await readFile(path.join(fixture.root,'calls.json'),'utf8'));expect(calls.some((c:any)=>['thread/start','thread/resume','turn/start'].includes(c.method))).toBe(false);
  // Remove native history for the next runtime while preserving the app transcript.
  await close();await writeFile(path.join(fixture.userData,'codex-runtime-v1/.codex/fixture-history.json'),'{}');
  await launch();await page.locator('#show-conversation').click();await expect(page.locator('#conversation-resume')).toBeEnabled();await page.locator('#conversation-resume').click();await expect(status()).toContainText('could not be resumed safely');await expect(page.locator('#conversation-transcript')).toContainText('Partial answer');await expect(page.locator('#conversation-send')).toBeDisabled();
});

test('malformed history reports recovery without blocking startup or exposing raw record data',async()=>{
  await mkdir(fixture.userData,{recursive:true});await writeFile(path.join(fixture.userData,'codex-conversation.json'),'{private-broken-record');
  await launch();await page.locator('#show-conversation').click();await expect(page.locator('#conversation-history-warning')).toContainText('could not be read');await expect(page.locator('#codex-conversation-dialog')).not.toContainText('private-broken-record');
});
