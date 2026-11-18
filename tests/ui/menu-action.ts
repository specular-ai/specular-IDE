import type { ElectronApplication, Page } from '@playwright/test';

/** Triggers an application menu item, as `rebuildMenu` in the main process does. */
export const menuAction = (app: ElectronApplication, action: string) =>
  app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('app:action', value), action);

/** Opens the Project map (its tab when open, else the Lens shortcut) and switches it to its Overview view. */
export const openOverview = async (page: Page) => {
  const tab = page.getByRole('tab', { name: 'Project map', exact: true });
  if (await tab.count()) await tab.click();
  else await page.locator('#loaded-plugin-views button[data-plugin-id="specular.relationships"]').click();
  await page.getByRole('navigation', { name: 'Project map views' }).getByRole('button', { name: 'Overview', exact: true }).click();
};
