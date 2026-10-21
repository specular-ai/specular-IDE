import { failAutosave } from './autosave-fixture';
import { test, expect, _electron as electron, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

let application: ElectronApplication, page: Page, project: string, text: string;
test.beforeEach(async () => {
  await mkdir('.cache/ui-tests', { recursive: true });
  const root = await mkdtemp(path.resolve('.cache/ui-tests/preview-position-'));
  project = path.join(root, 'project'); await mkdir(project);
  text = '# Position demo\n\n' + Array.from({ length: 65 }, (_, n) =>
    '## REQ-' + String(n + 1).padStart(3, '0') + ' — Section ' + (n + 1) + '\n\nParagraph ' + (n + 1) + ': café 🧭 ' + 'A specification can have different source and rendered heights. '.repeat(3) + '\n\n').join('')
    + '## Structured blocks\n\n- First list item\n- Nested **list target**\n\n> Quoted target with **formatting**.\n\n| Name | Value |\n| --- | --- |\n| Table target | 42 |\n\n'
    + '~~~typescript\nconst codeTarget = 42;\n~~~\n\n~~~mermaid\nstateDiagram-v2\n  Idle --> Running: Start\n~~~\n\n'
    + Array.from({ length: 10 }, (_, n) => '## Footer ' + n + '\n\nTrailing content.\n\n').join('');
  await writeFile(path.join(project, 'guide.md'), text.replace(/\n/g, '\r\n'));
  await writeFile(path.join(project, 'empty.md'), '');
  await writeFile(path.join(project, 'code.ts'), 'const readOnly = true;');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== 'ELECTRON_RUN_AS_NODE')) as Record<string, string>;
  application = await electron.launch({ args: ['.', '--project=' + project], env: { ...env, SPECULAR_USER_DATA: path.join(root, 'user-data') } });
  page = await application.firstWindow(); await failAutosave(application); await expect(page.locator('#workspace')).toBeVisible();
  await page.locator('[data-file="guide.md"]').click(); await expect(page.locator('#preview .diagram-canvas svg')).toBeVisible();
});
test.afterEach(async () => {
  if (application) { await application.evaluate(({ BrowserWindow }) => { for (const window of BrowserWindow.getAllWindows()) window.destroy(); }).catch(() => {}); await application.close().catch(() => {}); }
});
async function goTo(needle: string) {
  const line = text.slice(0, text.indexOf(needle)).split('\n').length;
  await page.locator('#editor .cm-content').click(); await page.keyboard.press('Control+Alt+g');
  await page.locator('.cm-goto-line input').fill(String(line)); await page.locator('.cm-goto-line input').press('Enter');
  await expect(page.locator('#cursor-status')).toContainText('Ln ' + line + ',');
}
async function selectPreview(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range); });
}
async function previewTop(target: Locator) {
  return target.evaluate(element => element.getBoundingClientRect().top - document.querySelector('#preview')!.getBoundingClientRect().top);
}

test('aligns preview from a visible source cursor and from scrolling past an offscreen cursor', async () => {
  await goTo('Paragraph 35:');
  const originalCursor = await page.locator('#cursor-status').textContent();
  await page.locator('#show-in-preview').focus(); await page.keyboard.press('Enter');
  const paragraph = page.locator('#preview p').filter({ hasText: 'Paragraph 35:' });
  await expect.poll(() => previewTop(paragraph)).toBeCloseTo(12, 0);
  await expect(page.locator('#cursor-status')).toHaveText(originalCursor!);
  const scroller = page.locator('#editor .cm-scroller');
  const readingScroll = await scroller.evaluate(el => el.scrollTop);
  await goTo('# Position demo');
  // Wait for the cursor reveal before applying the independent reading scroll.
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBe(0);
  await scroller.evaluate((el, top) => { el.scrollTop = top; }, readingScroll);
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  const firstVisibleText = () => page.locator('#editor .cm-line').evaluateAll(lines => {
    const top = document.querySelector('#editor .cm-scroller')!.getBoundingClientRect().top + 8;
    return lines.find(line => line.textContent?.trim() && line.getBoundingClientRect().bottom > top)?.textContent ?? '';
  });
  // CodeMirror updates virtualized line nodes on a later animation frame after scrolling.
  await expect.poll(firstVisibleText).toMatch(/Paragraph \d+|REQ-\d+/);
  const visibleText = await firstVisibleText();
  const number = Number(visibleText.match(/Paragraph (\d+)|REQ-(\d+)/)?.slice(1).find(Boolean));
  expect(number).toBeGreaterThan(1);
  await page.locator('#preview').evaluate(el => { el.scrollTop = 0; });
  await page.locator('#show-in-preview').click();
  const expected = visibleText.includes('Paragraph') ? page.locator('#preview p').filter({ hasText: 'Paragraph ' + number + ':' }) : page.locator('#preview h2').filter({ hasText: 'REQ-' + String(number).padStart(3, '0') });
  await expect(expected).toBeInViewport();
  await expect(page.locator('#cursor-status')).toContainText('Ln 1,');
});

test('aligns source from selected preview text without replacing either selection or changing the file', async () => {
  await goTo('# Position demo');
  await page.keyboard.press('Shift+End');
  const sourceCursor = await page.locator('#cursor-status').textContent();
  const paragraph = page.locator('#preview p').filter({ hasText: 'Paragraph 48:' });
  await selectPreview(paragraph);
  const selected = await page.evaluate(() => window.getSelection()!.toString());
  await page.locator('#show-in-source').click();
  await expect(page.locator('#editor .cm-line').filter({ hasText: 'Paragraph 48:' })).toBeInViewport();
  expect(await page.evaluate(() => window.getSelection()!.toString())).toBe(selected);
  await expect(page.locator('#cursor-status')).toHaveText(sourceCursor!);
  await expect(page.locator('#token-status')).toContainText('selected');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.locator('#preview p').filter({ hasText: 'Paragraph 22:' }).evaluate(element => {
    const preview = document.querySelector('#preview')!;
    preview.scrollTop += element.getBoundingClientRect().top - preview.getBoundingClientRect().top - 12;
  });
  await page.locator('#show-in-source').click();
  await expect(page.locator('#editor .cm-line').filter({ hasText: 'Paragraph 22:' })).toBeInViewport();
  await expect(page.locator('#dirty-indicator')).toHaveText('Saved');
  expect(await readFile(path.join(project, 'guide.md'), 'utf8')).toBe(text.replace(/\n/g, '\r\n'));
});

test('maps lists, quotes, table cells, code and Mermaid to their source, including the separate diagrams view', async () => {
  for (const [selector, label, source] of [
    ['li', 'Nested list target', '- Nested **list target**'],
    ['blockquote p', 'Quoted target', '> Quoted target'],
    ['td', 'Table target', '| Table target'],
    ['pre', 'const codeTarget', '~~~typescript'],
  ]) {
    await goTo('# Position demo');
    const block = page.locator('#preview ' + selector).filter({ hasText: label });
    await selectPreview(block); await page.locator('#show-in-source').click();
    await expect(page.locator('#editor .cm-line').filter({ hasText: source })).toBeInViewport();
  }
  await goTo('stateDiagram-v2');
  await page.locator('#show-in-preview').click();
  await expect.poll(() => previewTop(page.locator('#preview .diagram-canvas'))).toBeCloseTo(12, 0);
  await page.locator('#diagrams-tab').click(); await expect(page.locator('#preview .diagram-card svg')).toBeVisible();
  await goTo('# Position demo');
  await page.evaluate(() => window.getSelection()?.removeAllRanges());
  await page.locator('#show-in-source').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#editor .cm-line').filter({ hasText: '~~~mermaid' })).toBeInViewport();
  await goTo('Paragraph 20:'); await page.locator('#show-in-preview').click();
  await expect(page.locator('#preview-tab')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => previewTop(page.locator('#preview p').filter({ hasText: 'Paragraph 20:' }))).toBeCloseTo(12, 0);
  await page.screenshot({ path: 'test-results/preview-navigation.png' });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 680));
  const divider = page.locator('#panel-divider');
  for (const key of ['Home', 'End']) {
    await divider.focus(); await page.keyboard.press(key);
    for (const [pane, action] of [['source-panel', 'show-in-preview'], ['preview-panel', 'show-in-source']]) {
      await expect.poll(() => page.locator('#' + action).evaluate((element, paneId) => {
        const bounds = document.querySelector('#' + paneId + ' .pane-heading')!.getBoundingClientRect(), button = element.getBoundingClientRect();
        return button.left >= bounds.left && button.right <= bounds.right && button.bottom <= bounds.bottom;
      }, pane)).toBe(true);
      await page.locator('#' + action).click({ trial: true });
    }
  }
  await page.screenshot({ path: 'test-results/preview-navigation-minimum.png' });
});

test('uses fresh offsets after unsaved edits and disables alignment for code and empty documents', async () => {
  await goTo('# Position demo');
  await page.keyboard.insertText('New unsaved introduction.\n\n');
  await page.keyboard.press('Control+Home');
  await page.locator('#show-in-preview').click();
  await expect(page.locator('#preview p').filter({ hasText: 'New unsaved introduction.' })).toBeInViewport();
  const paragraph = page.locator('#preview p').filter({ hasText: 'Paragraph 30:' });
  await selectPreview(paragraph); await page.locator('#show-in-source').click();
  await expect(page.locator('#editor .cm-line').filter({ hasText: 'Paragraph 30:' })).toBeInViewport();
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  for (const file of ['code.ts', 'empty.md']) {
    await page.locator('[data-file="' + file + '"]').click();
    await expect(page.locator('#show-in-source')).toBeDisabled(); await expect(page.locator('#show-in-preview')).toBeDisabled();
  }
  await page.locator('[data-file="guide.md"]').click();
  await expect(page.locator('#show-in-preview')).toBeEnabled();
  expect(await readFile(path.join(project, 'guide.md'), 'utf8')).toBe(text.replace(/\n/g, '\r\n'));
});


test('hides source with unsaved state, restores its split and scroll, and reveals navigation targets', async () => {
  await goTo('Paragraph 35:');
  await page.keyboard.insertText('Unsaved marker ');
  await page.keyboard.press('Shift+End');
  const cursor = await page.locator('#cursor-status').textContent();
  const divider = page.locator('#panel-divider');
  await divider.focus(); await page.keyboard.press('ArrowRight');
  const ratio = await divider.getAttribute('aria-valuenow');
  const scroller = page.locator('#editor .cm-scroller');
  await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(1000);
  const readingPosition = () => page.locator('#editor .cm-line').evaluateAll(lines => {
    const top = document.querySelector('#editor .cm-scroller')!.getBoundingClientRect().top;
    const line = lines.find(el => el.getBoundingClientRect().bottom > top);
    return { text: line?.textContent, offset: Math.round((line?.getBoundingClientRect().top ?? top) - top) };
  });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const reading = await readingPosition();
  const toggle = page.locator('#toggle-source');
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#source-panel')).toBeHidden();
  await expect(divider).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(await page.locator('#preview-panel').evaluate(el => Math.abs(el.getBoundingClientRect().width - document.querySelector('.document-split')!.getBoundingClientRect().width))).toBeLessThan(2);
  await page.locator('[data-file="empty.md"]').click();
  await expect(page.locator('#source-panel')).toBeHidden();
  await page.locator('[data-file="code.ts"]').click();
  await expect(page.locator('#source-panel')).toBeVisible();
  await expect(toggle).toBeDisabled();
  await page.locator('[data-file="guide.md"]').click();
  await expect(page.locator('#source-panel')).toBeHidden();
  await toggle.focus(); await page.keyboard.press('Space');
  await expect(page.locator('#source-panel')).toBeVisible();
  await expect(page.locator('#cursor-status')).toHaveText(cursor!);
  await expect(divider).toHaveAttribute('aria-valuenow', ratio!);
  await expect.poll(readingPosition).toEqual(reading);
  await expect(page.locator('#dirty-indicator')).toHaveText(/Pending changes|Save failed|Conflict/);
  await expect(page.locator('#preview')).toContainText('Unsaved marker');
  expect(await readFile(path.join(project, 'guide.md'), 'utf8')).not.toContain('Unsaved marker');
  await toggle.click();
  const paragraph = page.locator('#preview p').filter({ hasText: 'Paragraph 48:' });
  await selectPreview(paragraph);
  await page.locator('#show-in-source').click();
  await expect(page.locator('#source-panel')).toBeVisible();
  await expect(page.locator('#editor .cm-content')).toBeFocused();
  await expect(page.locator('#editor .cm-line').filter({ hasText: 'Paragraph 48:' })).toBeInViewport();
  await toggle.click();
  await page.locator('#diagrams-tab').click();
  await expect(page.locator('#preview .diagram-card svg')).toBeVisible();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(980, 680));
  await expect(toggle).toBeInViewport();
  await page.screenshot({ path: 'test-results/source-hidden-minimum.png' });
  await page.locator('#show-in-source').click();
  await expect(page.locator('#source-panel')).toBeVisible();
  await expect(page.locator('#editor .cm-line').filter({ hasText: '~~~mermaid' })).toBeInViewport();
});
