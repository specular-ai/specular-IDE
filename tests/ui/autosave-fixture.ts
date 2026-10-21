import type { ElectronApplication } from '@playwright/test';

/** Keep pending buffers available for existing selection/brief/navigation regression tests. */
export async function failAutosave(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => {
    (globalThis as any).originalAutosaveHandler = (ipcMain as any)._invokeHandlers.get('document:save');
    ipcMain.removeHandler('document:save');
    ipcMain.handle('document:save', () => { throw new Error('Test save failure: pending buffer retained.'); });
  });
}
export async function restoreAutosave(app: ElectronApplication) {
  await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('document:save'); ipcMain.handle('document:save', (globalThis as any).originalAutosaveHandler); });
}
