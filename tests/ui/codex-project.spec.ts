import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { conversationFixture } from '../helpers/codex-runtime';
import { failAutosave, restoreAutosave } from './autosave-fixture';
let application:ElectronApplication,page:Page,fixture:Awaited<ReturnType<typeof conversationFixture>>,a:string,b:string;
async function launch(live=false){
  fixture=await conversationFixture();a=path.join(fixture.root,'Project A ñ');b=path.join(fixture.root,'Project B');await mkdir(a);await mkdir(b);
  await writeFile(path.join(a,'requirements.md'),'# Saved project A\nThe token is NEBULA-942.\n');await writeFile(path.join(b,'requirements.md'),'# Saved project B\n');
  const env=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>key!=='ELECTRON_RUN_AS_NODE'&&value!==undefined)) as Record<string,string>;
  application=await electron.launch({args:['.',`--project=${a}`],cwd:process.cwd(),env:{...env,SPECULAR_USER_DATA:fixture.userData}});page=await application.firstWindow();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');await expect(page.locator('.topbar')).not.toHaveAttribute('inert','');
  await failAutosave(application);
  await page.locator('.cm-content').click();await page.keyboard.press('Control+End');await page.keyboard.insertText('\nUnsaved editor content.\n');
  await page.locator('#show-agent-setup').click();if(!live)await page.locator('#codex-path').fill(fixture.executable);
  await page.locator('#codex-api-key').fill(live?process.env.OPENAI_API_KEY!:'sk-fixture');await page.locator('#codex-connect').click();
  await expect(page.locator('#codex-connection-state')).toHaveAttribute('data-status','connected',{timeout:20_000});await page.locator('#agent-setup-close').click();await page.locator('#show-conversation').click();
  await expect(page.locator('#conversation-model')).not.toHaveValue('');
}
test.afterEach(async({},info)=>{if(application){if(info.status!==info.expectedStatus)await page.screenshot({path:info.outputPath('failure.png')}).catch(()=>{});await application.evaluate(({BrowserWindow})=>{for(const window of BrowserWindow.getAllWindows())window.destroy();}).catch(()=>{});await application.close().catch(()=>{});}});
async function send(text:string){await page.locator('#conversation-prompt').fill(text);await page.locator('#conversation-send').click();}
test('shows project scope, preserves unsaved edits and requires explicit switching to a new project context',async()=>{
  await launch();await expect(page.locator('#conversation-project')).toContainText(a);await send('first');await expect(page.locator('#conversation-status')).toHaveAttribute('data-status','completed');
  await page.locator('#conversation-hide').click();await expect(page.locator('.cm-content')).toContainText('Unsaved editor content.');expect(await readFile(path.join(a,'requirements.md'),'utf8')).not.toContain('Unsaved');
  await restoreAutosave(application);await page.locator('#retry-save').click();await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  await application.evaluate(({dialog},project)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[project]});dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});},b);
  await page.locator('#open-project').click();await expect(page.locator('#preview')).toContainText('Saved project B');await page.locator('#show-conversation').click();
  await expect(page.locator('#conversation-project')).toContainText(a);await expect(page.locator('#conversation-project-note')).toContainText(b);await expect(page.locator('#conversation-send')).toBeDisabled();
  await page.locator('#conversation-prompt').fill('Draft for B');await page.locator('#conversation-use-project').click();await expect(page.locator('#conversation-project')).toContainText(b);await expect(page.locator('#conversation-prompt')).toHaveValue('Draft for B');
  await page.locator('#conversation-send').click();await expect(page.locator('#conversation-status')).toHaveAttribute('data-status','completed');await expect(page.locator('#conversation-transcript')).toContainText('not included in this new context');
  const calls=JSON.parse(await readFile(path.join(fixture.root,'calls.json'),'utf8'));const turns=calls.filter((c:any)=>c.method==='turn/start');expect(turns.map((c:any)=>c.params.cwd)).toEqual([a,b]);
  expect(JSON.stringify(turns)).not.toContain('Unsaved editor content');
  await page.screenshot({path:'test-results/codex-project.png'});
});
test('live project conversation reads saved file content while leaving editor changes unsaved',async()=>{
  test.skip(!process.env.SPECULAR_LIVE_CODEX_PROJECT||!process.env.OPENAI_API_KEY,'Opt in to a live project read.');test.setTimeout(100_000);await launch(true);
  await send('Read requirements.md with your shell tool. Reply with its verification token and whether it contains the word Unsaved.');await expect(page.locator('#conversation-status')).toHaveAttribute('data-status','completed',{timeout:60_000});
  await expect(page.locator('#conversation-transcript .assistant').last()).toContainText('NEBULA-942');await expect(page.locator('#conversation-project')).toContainText(a);
  await page.screenshot({path:'test-results/codex-project-live.png'});await page.locator('#conversation-hide').click();await expect(page.locator('.cm-content')).toContainText('Unsaved editor content.');
  expect(await readFile(path.join(a,'requirements.md'),'utf8')).not.toContain('Unsaved');
});
