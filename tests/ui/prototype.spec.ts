import { failAutosave, restoreAutosave } from './autosave-fixture';
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdir, mkdtemp, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

let application: ElectronApplication;
let page: Page;
let fixture: string;
let errors: string[];

test.beforeEach(async () => {
  const base = path.resolve('.cache', 'ui-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'run-'));
  fixture = path.join(directory, 'project');
  await cp('examples/first-project', fixture, { recursive: true });
  const environment: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined && key !== 'ELECTRON_RUN_AS_NODE') environment[key] = value;
  environment.SPECULAR_USER_DATA = path.join(directory, 'user-data');
  application = await electron.launch({ args: ['.', `--project=${fixture}`], cwd: process.cwd(), env: environment });
  page = await application.firstWindow();
  errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.locator('#document-path')).toHaveText('README.md');
  await expect(page.locator('#metric-ids')).toHaveText('10');
  // Coordinate-based drags must wait for project loading and native window focus.
  await expect(page.locator('#workspace')).not.toHaveAttribute('inert', '');
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
});
test.afterEach(async ({}, testInfo) => {
  if (page && testInfo.status !== testInfo.expectedStatus) {
    console.log('Renderer diagnostics:', errors, await page.locator('#status').textContent(), await page.locator('#toast').textContent());
    await page.screenshot({ path: testInfo.outputPath('failure.png') }).catch(() => undefined);
  }
  if (application) {
    // Avoid native unsaved-change dialogs during test teardown.
    await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => undefined);
    await application.close();
  }
});

test('creates root Markdown, preserves unsaved tabs, and follows a new definition across files', async () => {
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\nSee REQ-201.\n');
  await page.locator('#file-search').fill('requirements');
  await page.locator('#new-file').click();
  await expect(page.getByRole('dialog', { name: 'New Markdown file' })).toBeVisible();
  await page.locator('#new-file-name').fill('New specification');
  await page.screenshot({ path: 'test-results/new-markdown-dialog.png' });
  await page.locator('#new-file-name').press('Enter');
  await expect(page.locator('#document-path')).toHaveText('New specification.md');
  await expect(page.locator('#file-search')).toHaveValue('');
  await expect(page.locator('[data-file="New specification.md"]')).toBeVisible();
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  expect(await readFile(path.join(fixture, 'New specification.md'), 'utf8')).toBe('');
  await page.keyboard.insertText('# REQ-201 — New behavior\n\nCreated inside Specular.\n');
  await page.locator('.cm-content').press('Control+s');
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  await expect(page.locator('#metric-ids')).toHaveText('11');
  expect(await readFile(path.join(fixture, 'New specification.md'), 'utf8')).toContain('REQ-201');
  await page.getByRole('tab', { name: /README.md/ }).click();
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  await page.locator('#preview [data-id="REQ-201"]').click();
  await expect(page.locator('#document-path')).toHaveText('New specification.md');
  await expect(page.locator('#references-results')).toContainText('README.md');
  expect(errors).toEqual([]);
});

test('validates creation names, refuses overwrites, handles failure and cancel, and works with no open tabs', async () => {
  let mainStderr = '';
  application.process().stderr!.on('data', chunk => { mainStderr += chunk.toString(); });
  const original = await readFile(path.join(fixture, 'README.md'), 'utf8');
  await page.keyboard.press('Control+n');
  const dialog = page.locator('#new-file-dialog');
  await expect(dialog).toBeVisible();
  for (const [name, message] of [['', 'Enter a filename'], ['   ', 'Enter a filename'], ['../outside.md', 'without folders'], ['CON.md', 'reserved'], ['README.md', 'already exists']]) {
    await page.locator('#new-file-name').fill(name);
    await page.locator('#new-file-create').click();
    await expect(page.locator('#new-file-error')).toContainText(message);
    await expect(dialog).toBeVisible();
  }
  expect(await readFile(path.join(fixture, 'README.md'), 'utf8')).toBe(original);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await page.getByRole('button', { name: 'Close README.md', exact: true }).click();
  await expect(page.locator('#document-empty')).toBeVisible();
  await application.evaluate(({ Menu }) => {
    const item = Menu.getApplicationMenu()!.items.find(item => item.label === 'File')!.submenu!.items.find(item => item.label.startsWith('New Markdown file'))!;
    item.click();
  });
  await expect(dialog).toBeVisible();
  await page.locator('#new-file-cancel').click();
  await expect(dialog).toBeHidden();
  await page.locator('#new-file').click();
  await application.evaluate(({ ipcMain }) => {
    const handler = (ipcMain as any)._invokeHandlers.get('document:create');
    (globalThis as any).createHandler = handler;
    ipcMain.removeHandler('document:create');
    ipcMain.handle('document:create', () => ({ ok: false, message: 'Project is not writable.' }));
  });
  await page.locator('#new-file-name').fill('recovered.md');
  await page.locator('#new-file-create').click();
  await expect(page.locator('#new-file-error')).toContainText('not writable');
  await expect(page.locator('#new-file-name')).toHaveValue('recovered.md');
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('document:create');
    ipcMain.handle('document:create', (globalThis as any).createHandler);
  });
  await page.locator('#new-file-create').click();
  await expect(page.locator('#document-path')).toHaveText('recovered.md');
  await expect(page.locator('#document-empty')).toBeHidden();
  expect(await readFile(path.join(fixture, 'recovered.md'), 'utf8')).toBe('');
  expect(mainStderr).not.toContain("Error occurred in handler for 'document:create'");
  expect(errors).toEqual([]);
});

test('follows a cross-file ID, lists references, edits and saves plain Markdown', async () => {
  await page.locator('#preview [data-id="REQ-001"]').first().click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  await expect(page.locator('#references-panel')).toBeVisible();
  await expect(page.locator('#references-results')).toContainText('README.md');
  const content = page.locator('.cm-content');
  await content.click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\nTODO confirm the shortcut.\n');
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  await expect(page.locator('#metric-pending')).toHaveText('4');
  await page.locator('.cm-content').press('Control+s');
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  expect(await readFile(path.join(fixture, 'requirements.md'), 'utf8')).toContain('TODO confirm the shortcut.');
  expect(errors).toEqual([]);
});

test('renders Mermaid in a separate view and opens linked code without enabling editing', async () => {
  await page.locator('[data-file="design.md"]').click();
  await expect(page.locator('#preview .diagram-canvas svg')).toBeVisible();
  await page.locator('#diagrams-tab').click();
  await expect(page.locator('#preview .diagram-card svg')).toBeVisible();
  await expect(page.locator('#preview .diagram-card svg')).toContainText('Idle');
  await expect(page.locator('#preview .diagram-card svg')).toContainText('Running');
  await expect(page.locator('#diagram-count')).toHaveText('1');
  await page.screenshot({ path: 'test-results/specular-prototype.png' });
  await page.getByRole('button', { name: /Source · line/ }).click();
  await expect(page.locator('#document-path')).toHaveText('design.md');
  await page.locator('#preview-tab').click();
  await page.locator('[data-file="README.md"]').click();
  await page.locator('#preview a[href="src/timer.ts"]').click();
  await expect(page.locator('#document-path')).toContainText('src/timer.ts · read-only');
  await expect(page.locator('#save')).toHaveCount(0);
  await expect(page.locator('#prepare-brief')).toBeDisabled();
  const before = await page.locator('.cm-content').innerText();
  await page.locator('.cm-content').click(); await page.keyboard.insertText('unexpected change');
  expect(await page.locator('.cm-content').innerText()).toBe(before);
  expect(errors).toEqual([]);
});

test('preserves a dirty buffer when the file changes on disk and refuses stale save', async () => {
  await page.locator('[data-file="requirements.md"]').click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nMy unsaved edit.');
  const external = '# External edit\n\nDo not overwrite this.\n';
  await writeFile(path.join(fixture, 'requirements.md'), external);
  await expect(page.locator('#conflict')).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('My unsaved edit.');
  await page.locator('.cm-content').press('Control+s');
  await expect(page.locator('#conflict')).toContainText(/file changed on disk/i);
  expect(await readFile(path.join(fixture, 'requirements.md'), 'utf8')).toBe(external);
  await page.locator('#reload').click();
  await page.getByRole('button', { name: 'Discard changes', exact: true }).click();
  await expect(page.locator('.cm-content')).toContainText('Do not overwrite this.');
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  expect(errors).toEqual([]);
});

test('treats Markdown HTML as content, without script execution or remote resources', async () => {
  await writeFile(path.join(fixture, 'unsafe.md'), '# REQ-099 — Display\n\n<script>window.unsafeExecuted=true</script>\n\n<img src="https://example.com/leak" onerror="window.unsafeExecuted=true">\n\n[Unsafe](javascript:alert(1))\n');
  await page.locator('#refresh').click();
  await page.locator('[data-file="unsafe.md"]').click();
  await expect(page.locator('#preview h1')).toContainText('Display');
  expect(await page.locator('#preview script, #preview img, #preview iframe').count()).toBe(0);
  expect(await page.evaluate(() => 'unsafeExecuted' in window)).toBe(false);
  expect(errors).toEqual([]);
});

test('prepares, edits and copies a captured Markdown brief without changing the source', async () => {
  // Stub the OS clipboard at the main-process boundary so automated checks do not replace the user's clipboard.
  await application.evaluate(({ clipboard }) => {
    clipboard.writeText = async text => { (globalThis as any).copiedBrief = text; };
  });
  await page.locator('[data-file="requirements.md"]').click();
  const original = await readFile(path.join(fixture, 'requirements.md'), 'utf8');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+a');
  await page.locator('#prepare-brief').click();
  await expect(page.getByRole('dialog', { name: 'Prepare agent brief' })).toBeVisible();
  await expect(page.locator('#brief-file')).toContainText('requirements.md');
  await expect(page.locator('#brief-state')).toHaveText('Saved editor snapshot');
  await expect(page.locator('#brief-selection')).toHaveText(original);
  await expect(page.locator('#brief-create')).toBeDisabled();
  await page.locator('#brief-instruction').fill('Implement the timer requirements.');
  await page.locator('#brief-create').click();
  const assembled = await page.locator('#brief-output').inputValue();
  expect(assembled).toContain(original.replace(/\r\n/g, '\n'));
  expect(assembled).toContain('REQ-001, REQ-002, REQ-003, REQ-004');
  const edited = assembled.replace('Implement the timer requirements.', 'Implement only REQ-001.') + '\nPreserve the existing public interface.\n';
  await page.locator('#brief-output').fill(edited);
  await page.locator('#brief-copy').click();
  await expect(page.locator('#brief-feedback')).toHaveText('Copied to clipboard.');
  expect(await application.evaluate(() => (globalThis as any).copiedBrief)).toBe(edited);
  await page.screenshot({ path: 'test-results/agent-brief.png' });
  await page.locator('#brief-close').click();
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  expect(await readFile(path.join(fixture, 'requirements.md'), 'utf8')).toBe(original);
  await page.locator('#prepare-brief').click();
  await expect(page.locator('#brief-instruction')).toHaveValue('');
  await expect(page.locator('#brief-review')).toBeHidden();
  expect(errors).toEqual([]);
});

test('handles empty selections and clipboard failure while preserving unsaved source and the draft', async () => {
  await failAutosave(application);
  await page.locator('#prepare-brief').click();
  await expect(page.locator('#toast')).toContainText('Select some Markdown');
  await expect(page.locator('#brief-dialog')).not.toBeVisible();
  const original = await readFile(path.join(fixture, 'README.md'), 'utf8');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\nREQ-200 must preserve edits.');
  await page.keyboard.press('Home'); await page.keyboard.press('Shift+End');
  await page.locator('#prepare-brief').click();
  await expect(page.locator('#brief-state')).toHaveText('Unsaved editor snapshot');
  await page.locator('#brief-instruction').fill('Review this new requirement.');
  await page.locator('#brief-create').click();
  const draft = await page.locator('#brief-output').inputValue();
  expect(draft).toContain('REQ-200 must preserve edits.');
  expect(draft).toContain('Unsaved editor snapshot');
  await application.evaluate(({ clipboard }) => { clipboard.writeText = async () => { throw new Error('Clipboard unavailable'); }; });
  await page.locator('#brief-copy').click();
  await expect(page.locator('#brief-feedback')).toContainText('Could not copy');
  await expect(page.locator('#brief-output')).toHaveValue(draft);
  await expect(page.locator('#brief-copy')).toBeEnabled();
  await application.evaluate(({ clipboard }) => { clipboard.writeText = async text => { (globalThis as any).copiedBrief = text; }; });
  await page.locator('#brief-copy').click();
  await expect(page.locator('#brief-feedback')).toHaveText('Copied to clipboard.');
  await page.keyboard.press('Escape');
  await expect(page.locator('#brief-dialog')).not.toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('REQ-200 must preserve edits.');
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  expect(await readFile(path.join(fixture, 'README.md'), 'utf8')).toBe(original);
  expect(errors).toEqual([]);
});

test('keeps the captured selection stable when the source changes externally', async () => {
  await page.locator('[data-file="requirements.md"]').click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+a');
  await page.locator('#prepare-brief').click();
  const captured = await page.locator('#brief-selection').textContent();
  await writeFile(path.join(fixture, 'requirements.md'), '# Replacement specification\n');
  await expect(page.locator('.cm-content')).toContainText('Replacement specification');
  await expect(page.locator('#brief-selection')).toHaveText(captured!);
  await page.locator('#brief-instruction').fill('Review the captured selection.');
  await page.locator('#brief-create').click();
  expect(await page.locator('#brief-output').inputValue()).toContain(captured!);
  expect(await page.locator('#brief-output').inputValue()).not.toContain('Replacement specification');
  expect(errors).toEqual([]);
});

async function selectPreview(selector: string) {
  return page.locator(selector).evaluate(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  });
}

test('uses a preview-only selection by default and keeps the captured rendered text', async () => {
  await page.locator('[data-file="requirements.md"]').click();
  const original = await readFile(path.join(fixture, 'requirements.md'), 'utf8');
  const captured = await selectPreview('#preview tbody tr:first-child');
  await page.locator('#prepare-brief').click();
  await expect(page.locator('#brief-use')).toHaveValue('preview');
  await expect(page.locator('#brief-use option[value="source"]')).toBeDisabled();
  await expect(page.locator('#brief-use option[value="both"]')).toBeDisabled();
  await expect(page.locator('#brief-selection')).toHaveText(captured);
  await expect(page.locator('#brief-ids')).toContainText('REQ-001');
  await writeFile(path.join(fixture, 'requirements.md'), '# Replacement preview\n');
  await expect(page.locator('#preview')).toContainText('Replacement preview');
  await expect(page.locator('#brief-selection')).toHaveText(captured);
  await page.locator('#brief-instruction').fill('Review this rendered requirement.');
  await page.locator('#brief-create').click();
  const brief = await page.locator('#brief-output').inputValue();
  expect(brief).toContain(captured);
  expect(brief).toContain('## Selected preview text');
  expect(brief).not.toContain('Selection: lines');
  expect(brief).not.toContain(original);
  await page.locator('#brief-close').click();
  await page.locator('#prepare-brief').click();
  await expect(page.locator('#brief-dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('lets users choose source, preview, or both when both panels have selections', async () => {
  await application.evaluate(({ clipboard }) => {
    clipboard.writeText = async text => { (globalThis as any).copiedBrief = text; };
  });
  await page.locator('[data-file="requirements.md"]').click();
  const original = await readFile(path.join(fixture, 'requirements.md'), 'utf8');
  for (const choice of ['source', 'preview', 'both']) {
    await page.locator('.cm-content').click(); await page.keyboard.press('Control+a');
    const preview = await selectPreview('#preview h1');
    await page.locator('#prepare-brief').click();
    await expect(page.locator('#brief-use')).toHaveValue('source');
    await page.locator('#brief-use').selectOption(choice);
    await page.locator('#brief-instruction').fill('Review the chosen content.');
    if (choice === 'both') await page.screenshot({ path: 'test-results/brief-selections.png' });
    await page.locator('#brief-create').click();
    const brief = await page.locator('#brief-output').inputValue();
    expect(brief.includes('## Selected Markdown')).toBe(choice !== 'preview');
    expect(brief.includes('## Selected preview text')).toBe(choice !== 'source');
    if (choice !== 'preview') expect(brief).toContain(original.replace(/\r\n/g, '\n'));
    if (choice !== 'source') expect(brief).toContain(preview);
    await page.locator('#brief-copy').click();
    await expect(page.locator('#brief-feedback')).toHaveText('Copied to clipboard.');
    expect(await application.evaluate(() => (globalThis as any).copiedBrief)).toBe(brief);
    await page.locator('#brief-close').click();
  }
  expect(await readFile(path.join(fixture, 'requirements.md'), 'utf8')).toBe(original);
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  expect(errors).toEqual([]);
});

test('does not use selections outside the preview or from a previous document', async () => {
  await selectPreview('#document-path');
  await page.locator('#prepare-brief').click();
  await expect(page.locator('#brief-dialog')).not.toBeVisible();
  await selectPreview('#preview h1');
  await page.locator('[data-file="requirements.md"]').click();
  await page.locator('#prepare-brief').click();
  await expect(page.locator('#brief-dialog')).not.toBeVisible();
  expect(errors).toEqual([]);
});

test('closes inactive and active tabs, chooses adjacent tabs, and keeps an empty workspace usable', async () => {
  await page.locator('[data-file="requirements.md"]').click();
  await page.locator('[data-file="design.md"]').click();
  await page.getByRole('button', { name: 'Close README.md', exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText('design.md');
  await expect(page.getByRole('tab')).toHaveCount(2);
  await page.getByRole('tab', { name: 'requirements.md', exact: true }).click();
  await page.keyboard.press('Control+w');
  await expect(page.locator('#document-path')).toHaveText('design.md');
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.locator('#document-empty')).toBeVisible();
  await expect(page.locator('#save')).toHaveCount(0);
  await expect(page.locator('#reload')).toBeDisabled();
  await expect(page.locator('#prepare-brief')).toBeDisabled();
  await expect(page.locator('#cursor-status')).toBeEmpty();
  await expect(page.locator('#token-status')).toBeEmpty();
  await expect(page.locator('#metric-ids')).toHaveText('10');
  await page.keyboard.press('Control+w');
  await expect(page.locator('#workspace')).toBeVisible();
  await page.screenshot({ path: 'test-results/closed-tabs.png' });
  await page.locator('[data-folder="src"]').click();
  await page.locator('[data-file="src/timer.ts"]').click();
  await expect(page.locator('#document-empty')).toBeHidden();
  await expect(page.locator('#document-path')).toHaveText('src/timer.ts · read-only');
  await page.keyboard.press('Control+w');
  await expect(page.locator('#document-empty')).toBeVisible();
  await page.locator('#id-search').fill('REQ-001');
  await page.locator('#lens-results .lens-row').first().click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  expect(errors).toEqual([]);
});

test('cancel retains edits and discard removes their index entries while preserving other dirty tabs', async () => {
  await failAutosave(application);
  await application.evaluate(({ ipcMain }) => {
    ipcMain.on('workspace:dirty', (_event, dirty) => { (globalThis as any).testWorkspaceDirty = dirty; });
  });
  const original = await readFile(path.join(fixture, 'README.md'), 'utf8');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n\n# REQ-900 — Temporary definition\n');
  await expect(page.locator('#metric-ids')).toHaveText('11');
  await page.keyboard.press('Control+w');
  await expect(page.locator('#close-tab-dialog')).toBeVisible();
  await expect(page.locator('#close-tab-message')).toContainText('README.md');
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.locator('#close-tab-cancel').click();
  await expect(page.locator('.cm-content')).toContainText('Temporary definition');
  await page.locator('[data-file="requirements.md"]').click();
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nAnother unsaved change.');
  await page.getByRole('button', { name: 'Close README.md', exact: true }).click();
  await page.locator('#close-tab-discard').click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  await expect(page.locator('#metric-ids')).toHaveText('10');
  expect(await application.evaluate(() => (globalThis as any).testWorkspaceDirty)).toBe(true);
  expect(await readFile(path.join(fixture, 'README.md'), 'utf8')).toBe(original);
  await page.keyboard.press('Control+w');
  await page.keyboard.press('Escape');
  await expect(page.locator('#close-tab-dialog')).not.toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('Another unsaved change.');
  await page.keyboard.press('Control+w');
  await page.locator('#close-tab-discard').click();
  await expect(page.locator('#document-empty')).toBeVisible();
  expect(await application.evaluate(() => (globalThis as any).testWorkspaceDirty)).toBe(false);
  expect(errors).toEqual([]);
});

test('saves the requested inactive tab before closing it and selects the left neighbor when needed', async () => {
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nSaved on close.');
  await page.locator('[data-file="requirements.md"]').click();
  await page.getByRole('button', { name: 'Close README.md', exact: true }).click();
  await expect(page.locator('#close-tab-dialog')).toBeHidden();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  expect(await readFile(path.join(fixture, 'README.md'), 'utf8')).toContain('Saved on close.');
  await page.locator('[data-file="design.md"]').click();
  await page.getByRole('button', { name: 'Close design.md', exact: true }).click();
  await expect(page.locator('#document-path')).toHaveText('requirements.md');
  expect(errors).toEqual([]);
});

test('keeps a tab and its buffer when save-on-close encounters a disk conflict', async () => {
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nMy local edit.');
  const external = '# External replacement\n';
  await writeFile(path.join(fixture, 'README.md'), external);
  await page.keyboard.press('Control+w');
  await expect(page.locator('#close-tab-error')).toContainText('changed on disk');
  await expect(page.locator('#close-tab-dialog')).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(1);
  await expect(page.locator('.cm-content')).toContainText('My local edit.');
  expect(await readFile(path.join(fixture, 'README.md'), 'utf8')).toBe(external);
  await page.screenshot({ path: 'test-results/close-tab-conflict.png' });
  await page.locator('#close-tab-cancel').click();
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  expect(errors).toEqual([]);
});

test('save errors retain the close prompt for retry and never discard the buffer', async () => {
  await application.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('document:save');
    ipcMain.handle('document:save', () => { throw new Error('Test write failure'); });
  });
  const original = await readFile(path.join(fixture, 'README.md'), 'utf8');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nKeep this after failure.');
  await page.keyboard.press('Control+w');
  await page.locator('#close-tab-retry').click();
  await expect(page.locator('#close-tab-error')).toHaveText('Test write failure');
  await expect(page.locator('#close-tab-retry')).toBeEnabled();
  await page.locator('#close-tab-retry').click();
  await expect(page.locator('#close-tab-error')).toBeVisible();
  await page.locator('#close-tab-cancel').click();
  await expect(page.locator('.cm-content')).toContainText('Keep this after failure.');
  expect(await readFile(path.join(fixture, 'README.md'), 'utf8')).toBe(original);
  expect(errors).toEqual([]);
});

async function addFolderFixture() {
  await mkdir(path.join(fixture, 'docs', 'api'), { recursive: true });
  await mkdir(path.join(fixture, 'empty'));
  await mkdir(path.join(fixture, 'node_modules'));
  await writeFile(path.join(fixture, 'docs', 'spec.md'), '# REQ-201 — General specification\n');
  await writeFile(path.join(fixture, 'docs', 'api', 'spec.md'), '# REQ-202 — API specification\n\nTODO confirm the contract.\n');
  await writeFile(path.join(fixture, 'docs', 'AGENTS.md'), 'Local instructions.\n');
  await writeFile(path.join(fixture, 'node_modules', 'ignored.md'), '# REQ-999 — Excluded\n');
  await page.locator('#refresh').click();
  await expect(page.locator('[data-folder="docs"]')).toBeVisible();
  await expect(page.locator('#metric-ids')).toHaveText('12');
}

test('browses nested folders and duplicate filenames while preserving badges and file editing', async () => {
  await addFolderFixture();
  await expect(page.locator('[data-folder="docs"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('[data-file="docs/spec.md"]')).toHaveCount(0);
  await expect(page.locator('[data-folder="node_modules"]')).toHaveCount(0);
  await page.locator('[data-folder="empty"]').click();
  await expect(page.locator('[data-folder="empty"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#document-path')).toHaveText('README.md');
  await page.locator('[data-folder="docs"]').click();
  await expect(page.locator('[data-file="docs/AGENTS.md"] .config')).toBeVisible();
  await expect(page.locator('[data-file="docs/api/spec.md"]')).toHaveCount(0);
  await page.locator('[data-folder="docs/api"]').click();
  await expect(page.locator('[data-file="docs/api/spec.md"] .issue-badge')).toHaveText('1');
  await expect(page.locator('[data-file="docs/spec.md"] .issue-badge')).toHaveCount(0);
  await page.locator('[data-file="docs/spec.md"]').click();
  await expect(page.locator('.cm-content')).toContainText('General specification');
  await page.locator('[data-file="docs/api/spec.md"]').click();
  await expect(page.locator('#document-path')).toHaveText('docs/api/spec.md');
  await expect(page.locator('.cm-content')).toContainText('API specification');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nNested file edit.');
  await page.locator('.cm-content').press('Control+s');
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  expect(await readFile(path.join(fixture, 'docs', 'api', 'spec.md'), 'utf8')).toContain('Nested file edit.');
  expect(await readFile(path.join(fixture, 'docs', 'spec.md'), 'utf8')).not.toContain('Nested file edit.');
  await page.screenshot({ path: 'test-results/folder-explorer.png' });
  await page.locator('[data-folder="docs"]').click();
  await page.locator('#refresh').click();
  await expect(page.locator('#status')).toContainText('Index up to date');
  await expect(page.locator('[data-folder="docs"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#document-path')).toHaveText('docs/api/spec.md');
  await page.getByRole('tab', { name: 'spec.md', exact: true }).last().click();
  await expect(page.locator('[data-file="docs/api/spec.md"]')).toBeVisible();
  await page.locator('[data-folder="src"]').click();
  await page.locator('[data-file="src/timer.ts"]').click();
  await expect(page.locator('#document-path')).toHaveText('src/timer.ts · read-only');
  await expect(page.locator('#save')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('filters nested files with ancestors and reveals ID targets hidden by collapsed folders or a filter', async () => {
  await addFolderFixture();
  await page.locator('#file-search').fill('spec.md');
  await expect(page.locator('#files [data-file]')).toHaveCount(2);
  await expect(page.locator('[data-folder="docs"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-folder="docs/api"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-file="docs/api/spec.md"]')).toBeVisible();
  await page.locator('#file-search').fill('');
  await expect(page.locator('[data-folder="docs"]')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#file-search').fill('spec.md');
  await mkdir(path.join(fixture, 'docs', 'generated', 'nested'), { recursive: true });
  await writeFile(path.join(fixture, 'docs', 'generated', 'nested', 'spec.md'), 'New matching file.');
  await page.locator('#refresh').click();
  await expect(page.locator('[data-file="docs/generated/nested/spec.md"]')).toBeVisible();
  await page.locator('#file-search').fill('empty');
  await expect(page.locator('[data-folder="empty"]')).toBeVisible();
  await expect(page.locator('#files [data-file]')).toHaveCount(0);
  await page.locator('#file-search').fill('no-such-file');
  await expect(page.locator('#files')).toContainText('No matching files or folders.');
  await page.locator('#id-search').fill('REQ-202');
  await page.locator('#lens-results .lens-row').first().click();
  await expect(page.locator('#document-path')).toHaveText('docs/api/spec.md');
  await expect(page.locator('#file-search')).toHaveValue('');
  await expect(page.locator('[data-file="docs/api/spec.md"]')).toBeVisible();
  await expect(page.locator('[data-file="docs/api/spec.md"]')).toHaveAttribute('aria-selected', 'true');
  expect(errors).toEqual([]);
});

test('supports keyboard folder navigation and refreshes new folders without losing the expanded branch', async () => {
  await addFolderFixture();
  await page.locator('[data-folder="docs"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-folder="docs"]')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('[data-folder="docs"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-folder="docs/api"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-file="docs/api/spec.md"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#document-path')).toHaveText('docs/api/spec.md');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-folder="docs/api"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-folder="docs/api"]')).toHaveAttribute('aria-expanded', 'false');
  await mkdir(path.join(fixture, 'docs', 'new-folder'));
  await writeFile(path.join(fixture, 'docs', 'new-folder', 'notes.md'), 'Newly discovered.');
  await page.locator('#refresh').click();
  await expect(page.locator('[data-folder="docs/new-folder"]')).toBeVisible();
  await expect(page.locator('[data-folder="docs/api"]')).toHaveAttribute('aria-expanded', 'false');
  await page.locator('[data-folder="docs/new-folder"]').click();
  await expect(page.locator('[data-file="docs/new-folder/notes.md"]')).toBeVisible();
  await page.keyboard.press('Home');
  await expect(page.locator('[data-folder=""]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#files [role="treeitem"]')).toHaveCount(1);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-file="README.md"]')).toBeVisible();
  expect(errors).toEqual([]);
});

async function panelWidths() {
  return page.evaluate(() => {
    const source = document.querySelector('#source-panel')!.getBoundingClientRect().width;
    const preview = document.querySelector('#preview-panel')!.getBoundingClientRect().width;
    return { source, preview, ratio: source / (source + preview) };
  });
}

async function dragDividerTo(ratio: number) {
  const divider = (await page.locator('#panel-divider').boundingBox())!;
  const split = (await page.locator('.document-split').boundingBox())!;
  const y = divider.y + Math.min(120, divider.height / 2);
  await page.mouse.move(divider.x + divider.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(split.x + (split.width - divider.width) * ratio + divider.width / 2, y, { steps: 12 });
  await page.mouse.up();
}

test('drags and resets the panels without changing source or preview selections used in a brief', async () => {
  await failAutosave(application);
  // Native launch may clamp the initial width to the test desktop.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 940));
  await expect.poll(() => page.locator('.document-split').evaluate(el => el.clientWidth)).toBeGreaterThan(900);
  const original = await readFile(path.join(fixture, 'README.md'), 'utf8');
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nSelection survives resizing.');
  await expect(page.locator('#preview')).toContainText('Selection survives resizing.');
  await expect(page.locator('#dirty-indicator')).toHaveText('Save failed');
  await page.keyboard.press('Control+a');
  const selectionStatus = await page.locator('#token-status').textContent();
  const previewSelection = await selectPreview('#preview h1');
  await dragDividerTo(0.72);
  expect((await panelWidths()).ratio).toBeCloseTo(0.72, 2);
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(previewSelection);
  await expect(page.locator('#token-status')).toHaveText(selectionStatus!);
  await page.screenshot({ path: 'test-results/resized-panels.png' });
  await dragDividerTo(0.3);
  expect((await panelWidths()).ratio).toBeCloseTo(0.3, 2);
  await page.locator('#reset-split').click();
  expect((await panelWidths()).ratio).toBeCloseTo(0.5, 2);
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(previewSelection);
  await page.locator('#prepare-brief').click();
  await page.locator('#brief-use').selectOption('both');
  await page.locator('#brief-instruction').fill('Review both selections after resizing.');
  await page.locator('#brief-create').click();
  const brief = await page.locator('#brief-output').inputValue();
  expect(brief).toContain('Selection survives resizing.');
  expect(brief).toContain(previewSelection);
  expect(brief).toContain('## Selected Markdown');
  expect(brief).toContain('## Selected preview text');
  await page.locator('#brief-close').click();
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  expect(await readFile(path.join(fixture, 'README.md'), 'utf8')).toBe(original);
  await restoreAutosave(application);
  await page.locator('.cm-content').press('Control+s');
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  expect(await readFile(path.join(fixture, 'README.md'), 'utf8')).toContain('Selection survives resizing.');
  expect(errors).toEqual([]);
});

test('resizes with the keyboard and retains the split through tabs, diagrams, and an empty workspace', async () => {
  const divider = page.getByRole('separator', { name: 'Source and preview widths' });
  await divider.focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '60');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '59');
  await page.keyboard.press('Home');
  expect((await panelWidths()).source).toBeCloseTo(220, 0);
  await page.keyboard.press('End');
  expect((await panelWidths()).preview).toBeCloseTo(220, 0);
  await page.keyboard.press('Enter');
  expect((await panelWidths()).ratio).toBeCloseTo(0.5, 2);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.locator('[data-file="design.md"]').click();
  await page.locator('#diagrams-tab').click();
  await expect(page.locator('#preview .diagram-card svg')).toContainText('Running');
  expect((await panelWidths()).ratio).toBeCloseTo(0.6, 2);
  await page.keyboard.press('Control+w'); await page.keyboard.press('Control+w');
  await expect(page.locator('#document-empty')).toBeVisible();
  await expect(divider).toBeHidden();
  await expect(page.locator('#reset-split')).toBeDisabled();
  await page.locator('[data-file="README.md"]').click();
  await expect.poll(async () => (await panelWidths()).ratio).toBeCloseTo(0.6, 2);
  await divider.dblclick();
  expect((await panelWidths()).ratio).toBeCloseTo(0.5, 2);
  expect(errors).toEqual([]);
});

test('clamps panels at minimum window size, restores the preferred ratio, and cancels a drag safely', async () => {
  // Native launch may clamp the initial width to the test desktop.
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 940));
  await expect.poll(() => page.locator('.document-split').evaluate(el => el.clientWidth)).toBeGreaterThan(900);
  await dragDividerTo(0.75);
  expect((await panelWidths()).ratio).toBeCloseTo(0.75, 2);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 680));
  await expect.poll(async () => (await panelWidths()).preview).toBeCloseTo(220, 0);
  expect((await panelWidths()).source).toBeGreaterThanOrEqual(220);
  expect(await page.locator('#source-panel .pane-heading').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect(await page.locator('#preview-panel .pane-heading').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/resized-panels-minimum.png' });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1480, 940));
  await expect.poll(async () => (await panelWidths()).ratio).toBeCloseTo(0.75, 2);
  await dragDividerTo(1.1);
  expect((await panelWidths()).preview).toBeCloseTo(220, 0);
  await dragDividerTo(-0.1);
  expect((await panelWidths()).source).toBeCloseTo(220, 0);
  await page.locator('#reset-split').click();
  const divider = (await page.locator('#panel-divider').boundingBox())!;
  await page.mouse.move(divider.x + 4, divider.y + 100);
  await page.mouse.down();
  await page.mouse.move(divider.x + 100, divider.y + 100, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect((await panelWidths()).ratio).toBeCloseTo(0.5, 2);
  await expect(page.locator('body')).not.toHaveClass(/resizing-panels/);
  await page.locator('.cm-content').click(); await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\nEditing still works.');
  await expect(page.locator('#preview')).toContainText('Editing still works.');
  expect(errors).toEqual([]);
});
