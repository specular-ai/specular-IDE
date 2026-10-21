import { expect, type ElectronApplication, type Frame } from '@playwright/test';

/** Reacquire after source return or mode switching: custom surfaces are disposable. */
export async function pluginFrame(app: ElectronApplication, selector = '#plugin-root > section'): Promise<Frame> {
  let frame: Frame | undefined;
  await expect.poll(async () => {
    const candidates = app.context().pages().filter(p => !p.isClosed() && p.url().includes('/custom.html')).flatMap(p => p.frames()).filter(f => f.url().startsWith('specular-plugin-ui://')).reverse();
    for (const candidate of candidates) if (await candidate.locator(selector).isVisible().catch(() => false)) { frame = candidate; return true; }
    return false;
  }).toBe(true);
  return frame!;
}
