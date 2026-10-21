import { expect, type Page } from '@playwright/test';

export async function selectConfigurationTab(page: Page, id: string) {
  await page.locator(`#config-tab-${id}`).click();
  await expandConfigurationEntries(page);
}

export async function expectInternalKeysHidden(page: Page, keys: string[] = []) {
  const dialog = page.locator('#project-configuration-dialog');
  await expect(dialog.getByRole('textbox', { name: /key/i })).toHaveCount(0);
  await expect(dialog.locator('textarea')).toHaveCount(0);
  // Include collapsed text, tooltips and accessible names, but allow internal option values.
  const presentation = await dialog.evaluate(element => [element.textContent, ...Array.from(element.querySelectorAll('*')).flatMap(node => [node.getAttribute('aria-label'), node.getAttribute('title'), node instanceof HTMLInputElement && node.type === 'text' ? node.value : ''])].join('\n'));
  for (const key of keys) expect(presentation).not.toContain(key);
}
/** Existing editing workflows explicitly open the entries they exercise. */
export async function expandConfigurationEntries(page: Page) {
  // Expand the current DOM in one browser turn. Index-based locators can switch
  // to a hidden tab's entries if a configuration refresh replaces the list.
  await page.locator('.config-entry > summary, .config-category-section > summary').evaluateAll(summaries => {
    for (const summary of summaries) if (summary instanceof HTMLElement && summary.getClientRects().length && !(summary.parentElement as HTMLDetailsElement).open) summary.click();
  });
}

/** Open the discovery methods used by existing workflow checks. */
export async function expandDiscoveryMethods(page: Page) {
  for (const id of ['discovery-patterns']) {
    const section = page.locator('#' + id);
    if (await section.getAttribute('open') === null) await section.locator(':scope > summary').click();
  }
}
