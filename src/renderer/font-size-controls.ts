import { DEFAULT_FONT_SIZES, MIN_FONT_SIZE, MAX_FONT_SIZE, parseFontSizes, type FontSizes } from '../shared/font-sizes';
import type { SpecularBridge } from '../shared/types';

export class FontSizeControls {
  private sizes: FontSizes = { ...DEFAULT_FONT_SIZES };
  private ready = false;
  private readonly controls = new Map<keyof FontSizes, { decrease: HTMLButtonElement; increase: HTMLButtonElement; reset: HTMLButtonElement; value: HTMLOutputElement }>();

  constructor(private readonly api: SpecularBridge, private readonly measureSource: () => void,
    private readonly notify: (message: string) => void) {
    for (const pane of ['source', 'preview'] as const) {
      const label = pane === 'source' ? 'Source' : 'Preview';
      const group = document.createElement('div');
      group.className = 'font-size-controls';
      group.setAttribute('role', 'group'); group.setAttribute('aria-label', `${label} font size`);
      const makeButton = (action: string, text: string, change: () => void) => {
        const button = document.createElement('button');
        button.className = 'quiet-button'; button.type = 'button'; button.textContent = text;
        button.id = `${pane}-font-${action.toLowerCase()}`;
        button.title = `${action} ${label} font size`; button.setAttribute('aria-label', button.title);
        // Keep text selections when using pointer controls. Keyboard activation uses native buttons.
        button.addEventListener('mousedown', event => { if (event.button === 0) event.preventDefault(); });
        button.onclick = change;
        return button;
      };
      const decrease = makeButton('Decrease', 'A−', () => this.change(pane, this.sizes[pane] - 1));
      const increase = makeButton('Increase', 'A+', () => this.change(pane, this.sizes[pane] + 1));
      const reset = makeButton('Reset', 'Reset', () => this.change(pane, DEFAULT_FONT_SIZES[pane]));
      const value = document.createElement('output');
      value.id = `${pane}-font-size`; value.setAttribute('aria-label', `${label} font size`);
      group.append(decrease, value, increase, reset);
      document.querySelector(`#${pane}-panel .pane-heading`)!.append(group);
      this.controls.set(pane, { decrease, increase, reset, value });
    }
    this.render();
  }

  async load() {
    try { this.sizes = parseFontSizes(await this.api.fontSizes()); }
    catch { this.notify('Font-size preferences could not be loaded. Using defaults.'); }
    this.ready = true;
    this.render();
  }

  private change(pane: keyof FontSizes, size: number) {
    if (!this.ready) return;
    this.sizes = { ...this.sizes, [pane]: Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size)) };
    this.render();
    // The main process serializes atomic writes, including rapid adjustments and workspace saves.
    void this.api.saveFontSizes({ ...this.sizes }).then(result => {
      if (!result.ok) this.notify(result.message ?? 'Font sizes apply for this session but could not be saved.');
    }).catch(() => this.notify('Font sizes apply for this session but could not be saved.'));
  }

  private render() {
    for (const [pane, controls] of this.controls) {
      document.documentElement.style.setProperty(`--${pane}-font-size`, `${this.sizes[pane]}px`);
      controls.value.value = `${this.sizes[pane]} px`;
      controls.decrease.disabled = !this.ready || this.sizes[pane] === MIN_FONT_SIZE;
      controls.increase.disabled = !this.ready || this.sizes[pane] === MAX_FONT_SIZE;
      controls.reset.disabled = !this.ready;
    }
    this.measureSource();
  }
}
