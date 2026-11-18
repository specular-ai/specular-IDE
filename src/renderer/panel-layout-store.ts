import { parsePanelLayout, type PanelLayout } from '../shared/panel-layout';
import type { SpecularBridge } from '../shared/types';

/** Saved panel layout: loaded once at startup, and saved after each finished change (never during a drag). */
export class PanelLayoutStore {
  private layout: PanelLayout = {};

  constructor(private readonly api: SpecularBridge, private readonly notify: (message: string) => void) {}

  async load(): Promise<PanelLayout> {
    try { this.layout = parsePanelLayout(await this.api.panelLayout()); }
    catch { this.notify('Panel widths could not be loaded. Using defaults.'); }
    return { ...this.layout };
  }

  set<K extends keyof PanelLayout>(field: K, value: PanelLayout[K] | undefined) {
    if (this.layout[field] === value) return;
    if (value === undefined) delete this.layout[field]; else this.layout[field] = value;
    // Saved at once, as font sizes are, so a change just before quitting is kept; the main process serializes the writes.
    void this.api.savePanelLayout({ ...this.layout }).then(result => {
      if (!result.ok) this.notify(result.message ?? 'Panel widths apply for this session but could not be saved.');
    }).catch(() => this.notify('Panel widths apply for this session but could not be saved.'));
  }
}
