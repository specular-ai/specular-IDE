import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { conversationFixture } from '../helpers/codex-runtime';

let application: ElectronApplication; let page: Page; let fixture: Awaited<ReturnType<typeof conversationFixture>>;
async function launch(live = false) {
  fixture = await conversationFixture();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key,value])=>key!=='ELECTRON_RUN_AS_NODE' && value!==undefined)) as Record<string,string>;
  application = await electron.launch({args:['.'],cwd:process.cwd(),env:{...env,SPECULAR_USER_DATA:fixture.userData}});
  page = await application.firstWindow(); await expect(page.locator('#welcome')).toBeVisible();
  await expect(page.locator('.topbar')).not.toHaveAttribute('inert','');
  await page.locator('#show-agent-setup').click();
  if(!live) await page.locator('#codex-path').fill(fixture.executable);
  await page.locator('#codex-api-key').fill(live ? process.env.OPENAI_API_KEY! : 'sk-ui-fixture');
  await page.locator('#codex-connect').click();
  await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status','connected',{timeout:20_000});
  await page.locator('#agent-setup-close').click(); await page.locator('#show-conversation').click();
  await expect(page.locator('#conversation-model')).not.toHaveValue('');
}
const status = () => page.locator('#conversation-status');
const transcript = () => page.locator('#conversation-transcript');
async function send(text: string) { await page.locator('#conversation-prompt').fill(text); await page.locator('#conversation-send').click(); }
test.afterEach(async ({},info)=>{
  if(application) {
    if(info.status!==info.expectedStatus) await page.screenshot({path:info.outputPath('failure.png')}).catch(()=>undefined);
    await application.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows()) window.destroy();}).catch(()=>undefined);
    await application.close().catch(()=>undefined);
  }
});
test('conversation sends selected model, preserves context, renders text safely, stops and keeps drafts', async()=>{
  await launch();
  await page.locator('#conversation-send').click(); await expect(page.locator('#conversation-feedback')).toContainText('Enter a message');
  await send('hello <script>alert(1)</script>');
  await expect(status()).toHaveAttribute('data-status','completed');
  await expect(transcript().locator('.assistant')).toHaveCount(1);
  await expect(transcript()).toContainText('Reply: hello <script>alert(1)</script>');
  await expect(transcript().locator('script')).toHaveCount(0); await expect(page.locator('#conversation-prompt')).toHaveValue('');
  await page.locator('#conversation-model').fill('alternate-model');
  await send('follow-up'); await expect(status()).toHaveAttribute('data-status','completed');
  await expect(transcript()).toContainText('Remembered: hello');
  await send('hold'); await expect(status()).toHaveAttribute('data-status','running');
  await expect(transcript()).toContainText('Partial answer'); await expect(page.locator('#conversation-send')).toBeDisabled();
  await page.locator('#conversation-prompt').fill('Draft for next turn');
  await page.locator('#conversation-stop').click(); await expect(status()).toHaveAttribute('data-status','interrupted');
  await page.locator('#conversation-hide').click(); await page.locator('#show-conversation').click();
  await expect(transcript()).toContainText('Partial answer'); await expect(page.locator('#conversation-prompt')).toHaveValue('Draft for next turn');
  await page.screenshot({path:'test-results/codex-conversation.png'});
  const calls=JSON.parse(await readFile(path.join(fixture.root,'calls.json'),'utf8'));
  expect(calls.filter((c:any)=>c.method==='thread/start')).toHaveLength(1);
  expect(calls.filter((c:any)=>c.method==='turn/start')[1].params.model).toBe('alternate-model');
  const pid=Number(await readFile(path.join(fixture.root,'pid.txt'),'utf8'));
  await page.locator('#conversation-end').click(); await expect(page.locator('#conversation-send')).toBeDisabled();
  await expect(page.locator('#conversation-connection')).toContainText('Disconnected');
  expect(()=>process.kill(pid,0)).toThrow(); await expect(transcript()).toContainText('Remembered: hello');
});
test('failed requests and process exit preserve the transcript and allow explicit resumption', async()=>{
  await launch(); await send('rejected key'); await expect(status()).toHaveAttribute('data-status','error');
  await expect(status()).toContainText('API key'); await expect(transcript()).toContainText('Partial before rejection');
  await expect(page.locator('#codex-conversation-dialog')).not.toContainText('sk-do-not-expose');
  await send('crash'); await expect(status()).toHaveAttribute('data-status','interrupted'); await expect(status()).toContainText('disconnected');
  await expect(transcript()).toContainText('Partial before exit');
  await page.locator('#conversation-setup').click(); await page.locator('#codex-api-key').fill('sk-ui-reconnect'); await page.locator('#codex-connect').click();
  await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status','connected');
  await page.locator('#agent-setup-close').click(); await page.locator('#show-conversation').click();
  await expect(page.locator('#conversation-send')).toBeDisabled();
  await page.locator('#conversation-resume').click();
  await send('follow-up'); await expect(status()).toHaveAttribute('data-status','completed');
  await expect(transcript()).toContainText('Remembered: rejected key'); await expect(transcript()).toContainText('Partial before exit');
});
test('normal window close during a response terminates the owned runtime', async()=>{
  await launch(); await send('hold'); await expect(status()).toHaveAttribute('data-status','running');
  const pid=Number(await readFile(path.join(fixture.root,'pid.txt'),'utf8'));
  await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  await application.close(); expect(()=>process.kill(pid,0)).toThrow();
});
test('live Codex conversation streams, remembers a follow-up and stops inside Electron', async()=>{
  test.skip(!process.env.SPECULAR_LIVE_CODEX_CHAT || !process.env.OPENAI_API_KEY,'Opt in to model requests with an API key.');
  test.setTimeout(120_000); await launch(true);
  if(process.env.SPECULAR_LIVE_CODEX_MODEL) await page.locator('#conversation-model').fill(process.env.SPECULAR_LIVE_CODEX_MODEL);
  await send('Remember the code ORBIT-731. Reply with that code only.'); await expect(status()).toHaveAttribute('data-status','completed',{timeout:60_000});
  await send('What code did I ask you to remember? Reply with the code only.'); await expect(status()).toHaveAttribute('data-status','completed',{timeout:60_000});
  await expect(transcript().locator('.assistant').last()).toContainText('ORBIT-731');
  await page.screenshot({path:'test-results/codex-conversation-live.png'});
  await send('Write 500 numbered example requirement titles.'); await expect(page.locator('#conversation-stop')).toBeEnabled();
  await page.locator('#conversation-stop').click(); await expect(status()).toHaveAttribute('data-status','interrupted',{timeout:15_000});
  await page.locator('#conversation-end').click(); await expect(page.locator('#conversation-connection')).toContainText('Disconnected');
});
