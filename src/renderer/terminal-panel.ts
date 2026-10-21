import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { SpecularBridge, TerminalInfo, TerminalKind } from '../shared/types';
import { encodeTerminalBrief } from '../shared/terminal-brief';
import { currentAppearance } from './appearance';

function terminalTheme() {
  const { mode, colors } = currentAppearance();
  return { background: mode === 'dark' ? '#101820' : colors.background, foreground: colors.text,
    cursor: colors.accent, selectionBackground: colors.selection,
    ...(mode === 'light' ? { black: '#243442', red: '#a52b38', green: '#226c39', yellow: '#80520c', blue: '#2459a6', magenta: '#833da0', cyan: '#126e78', white: '#526575',
      brightBlack: '#526575', brightRed: '#b42c35', brightGreen: '#267536', brightYellow: '#875900', brightBlue: '#285ac0', brightMagenta: '#8d3db0', brightCyan: '#00737d', brightWhite: '#243442' }
      : { black: '#000000', red: '#cd0000', green: '#00cd00', yellow: '#cdcd00', blue: '#0000ee', magenta: '#cd00cd', cyan: '#00cdcd', white: '#e5e5e5',
        brightBlack: '#7f7f7f', brightRed: '#ff0000', brightGreen: '#00ff00', brightYellow: '#ffff00', brightBlue: '#5c5cff', brightMagenta: '#ff00ff', brightCyan: '#00ffff', brightWhite: '#ffffff' }) };
}

const names = { powershell: 'PowerShell', cmd: 'Command Prompt', codex: 'Codex', claude: 'Claude' };
type Tab = { info: TerminalInfo; terminal: Terminal; fit: FitAddon; host: HTMLElement; button: HTMLButtonElement };
export class TerminalPanel {
  private panel = document.createElement('section');
  private tabs = new Map<string, Tab>();
  private active?: string;
  private opening = false;
  private closing = false;
  private height = 340;
  private maximized = false;
  private drag?: { id: number; y: number; height: number; preferred: number };
  constructor(private api: SpecularBridge, private agentPath: (kind: 'codex' | 'claude') => string, private returnFocus: () => void) {
    window.addEventListener('specular:appearance', () => { for (const tab of this.tabs.values()) tab.terminal.options.theme = terminalTheme(); });
    this.panel.id = 'terminal-panel'; this.panel.hidden = true; this.panel.setAttribute('aria-labelledby', 'terminal-title');
    this.panel.innerHTML = `<div id="terminal-divider" role="separator" tabindex="0" aria-label="Terminal height" aria-orientation="horizontal" aria-controls="terminal-panel workbench" title="Drag to resize. Up/Down: adjust; Home/End: limits; Enter or double-click: reset."></div>
      <div class="terminal-heading"><h2 id="terminal-title">Project terminals</h2><span class="terminal-hint" title="Uses your shell and agent settings. Agent paths come from Agent setup or PATH.">Commands can modify files</span><button id="terminal-maximize" class="quiet-button">Maximize</button><button id="terminal-hide" class="quiet-button" title="Hide terminals (Ctrl+Shift+T); sessions keep running">Hide</button></div>
      <div class="terminal-launch"><span>New terminal</span>${Object.entries(names).map(([kind, name]) => `<button class="button secondary" data-terminal-kind="${kind}">${name}</button>`).join('')}</div>
      <div id="terminal-tabs" role="tablist" aria-label="Terminal sessions"></div>
      <div class="terminal-heading"><span id="terminal-scope">Open a project and choose a terminal.</span><button id="terminal-close" class="quiet-button" disabled>Close terminal</button></div>
      <div id="terminal-content"><p id="terminal-empty">Use Codex or Claude here with their native commands and login flows.</p></div>
      <div id="terminal-notice" role="status" aria-live="polite"></div>`;
    document.querySelector('.statusbar')!.before(this.panel);
    const toggle = document.querySelector('#show-terminals')!;
    toggle.setAttribute('aria-controls', this.panel.id); toggle.setAttribute('aria-expanded', 'false');
    // Renderer-delivered keys (including automated input) bypass native menu accelerators.
    // Capture only the dock shortcut before xterm consumes it; native shell keys pass through.
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && !event.altKey && event.key.toLowerCase() === 't') {
        event.preventDefault(); event.stopPropagation(); if (!event.repeat) this.toggle();
      }
    }, true);
    this.element('terminal-hide').onclick = () => this.hide();
    this.element('terminal-maximize').onclick = () => { this.finishDrag(); this.maximized = !this.maximized; this.layout(); };
    this.element('terminal-close').onclick = () => { void this.close(); };
    this.panel.querySelectorAll<HTMLButtonElement>('[data-terminal-kind]').forEach(button => { button.onclick = () => { void this.open(button.dataset.terminalKind as TerminalKind); }; });
    const divider = this.element('terminal-divider');
    divider.onpointerdown = event => {
      if (event.button !== 0 || !event.isPrimary || this.maximized || this.drag) return;
      event.preventDefault(); divider.focus({ preventScroll: true });
      this.drag = { id: event.pointerId, y: event.clientY, height: this.panel.getBoundingClientRect().height, preferred: this.height };
      divider.setPointerCapture(event.pointerId); document.body.classList.add('resizing-terminal');
    };
    divider.onpointermove = event => { if (this.drag?.id === event.pointerId) this.setHeight(this.drag.height + this.drag.y - event.clientY); };
    divider.onpointerup = event => { if (this.drag?.id === event.pointerId) this.finishDrag(); };
    divider.onpointercancel = () => this.finishDrag(true);
    divider.onlostpointercapture = () => this.finishDrag();
    window.addEventListener('blur', () => this.finishDrag());
    divider.onkeydown = event => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const height = this.panel.getBoundingClientRect().height, step = event.shiftKey ? 5 : 25;
      if (event.key === 'ArrowUp') this.setHeight(height + step);
      else if (event.key === 'ArrowDown') this.setHeight(height - step);
      else if (event.key === 'Home') this.setHeight(0);
      else if (event.key === 'End') this.setHeight(Infinity);
      else if (event.key === 'Enter') this.setHeight(340);
      else if (event.key === 'Escape' && this.drag) this.finishDrag(true);
      else return;
      event.preventDefault();
    };
    divider.ondblclick = () => this.setHeight(340);
    api.onTerminalEvent(event => {
      const tab = this.tabs.get(event.type === 'data' ? event.id : event.terminal.id); if (!tab) return;
      if (event.type === 'data') tab.terminal.write(event.data, () => api.terminalAcknowledge(event.id, event.data.length));
      else { tab.info = event.terminal; this.labels(); }
    });
    new ResizeObserver(() => this.fit()).observe(this.element('terminal-content'));
    new ResizeObserver(() => this.layout()).observe(document.querySelector('#app')!);
  }
  private element<T extends HTMLElement = HTMLElement>(id: string) { return this.panel.querySelector<T>(`#${id}`)!; }
  briefTargets() { return [...this.tabs.values()].filter(tab => tab.info.kind === 'codex' || tab.info.kind === 'claude').map(tab => ({ ...tab.info })); }
  async insertBrief(id: string, root: string, text: string) {
    const tab = this.tabs.get(id);
    if (!tab || tab.info.status !== 'running' || !['codex', 'claude'].includes(tab.info.kind)) return { ok: false, message: 'This agent terminal is no longer running. Choose another terminal.' };
    if (tab.info.root.toLowerCase() !== root.toLowerCase()) return { ok: false, message: 'Choose an agent terminal started in this project.' };
    // Raw newlines can submit commands. Do not fall back to ordinary terminal input.
    if (!tab.terminal.modes.bracketedPasteMode) return { ok: false, message: 'The agent is not ready for multiline paste. Open its prompt, then retry, or use Copy brief.' };
    try { encodeTerminalBrief(text); } catch (error) { return { ok: false, message: (error as Error).message }; }
    return this.api.insertTerminalBrief(id, root, text);
  }
  revealBrief(id: string) {
    if (this.panel.hidden) this.toggle();
    this.select(id);
    this.element('terminal-notice').textContent = 'Brief inserted without pressing Enter. Review the agent input, then press Enter when ready.';
  }
  toggle() {
    if (document.querySelector('dialog[open]')) return;
    if (!this.panel.hidden) { this.hide(); return; }
    this.panel.hidden = false; document.querySelector('#show-terminals')!.setAttribute('aria-expanded', 'true'); this.layout();
    requestAnimationFrame(() => { if (this.panel.hidden) return; this.fit(); const tab = this.tabs.get(this.active ?? ''); if (tab) tab.terminal.focus(); else this.element('terminal-hide').focus(); });
  }
  private hide() {
    this.finishDrag(); this.panel.hidden = true;
    document.querySelector('#app')!.classList.remove('terminal-maximized');
    document.querySelector('#show-terminals')!.setAttribute('aria-expanded', 'false'); this.returnFocus();
  }
  private bounds() {
    const available = Math.max(0, document.querySelector('.statusbar')!.getBoundingClientRect().top - document.querySelector('.topbar')!.getBoundingClientRect().bottom);
    return { available, min: Math.min(220, available / 2), max: Math.max(available / 2, available - 200) };
  }
  private setHeight(height: number) { const { min, max } = this.bounds(); this.height = Math.max(min, Math.min(max, height)); this.layout(); }
  private finishDrag(cancel = false) {
    const drag = this.drag; if (!drag) return; this.drag = undefined;
    const divider = this.element('terminal-divider'); if (divider.hasPointerCapture(drag.id)) divider.releasePointerCapture(drag.id);
    document.body.classList.remove('resizing-terminal');
    if (cancel) { this.height = drag.preferred; this.layout(); }
  }
  private layout() {
    if (this.panel.hidden) return;
    const { available, min, max } = this.bounds();
    const actual = this.maximized ? available : Math.max(min, Math.min(max, this.height));
    document.querySelector('#app')!.classList.toggle('terminal-maximized', this.maximized);
    this.panel.style.height = `${actual}px`;
    const divider = this.element('terminal-divider'); divider.hidden = this.maximized;
    divider.setAttribute('aria-valuemin', String(Math.round(min))); divider.setAttribute('aria-valuemax', String(Math.round(max)));
    divider.setAttribute('aria-valuenow', String(Math.round(actual))); divider.setAttribute('aria-valuetext', `${Math.round(actual)} pixels`);
    this.element('terminal-maximize').textContent = this.maximized ? 'Restore' : 'Maximize';
    this.fit();
  }
  private fit() { const tab = this.tabs.get(this.active ?? ''); if (tab && !this.panel.hidden && tab.host.clientHeight > 0 && tab.host.clientWidth > 0) { tab.fit.fit(); this.api.terminalResize(tab.info.id, tab.terminal.cols, tab.terminal.rows); } }
  private labels() {
    for (const tab of this.tabs.values()) { tab.button.textContent = `${names[tab.info.kind]} · ${tab.info.status}`; tab.button.title = tab.info.root; tab.button.setAttribute('aria-selected', String(tab.info.id === this.active)); }
    const tab = this.tabs.get(this.active ?? '');
    this.element('terminal-scope').textContent = tab ? `Started in: ${tab.info.root} · ${tab.info.status}${tab.info.exitCode !== undefined ? ` (${tab.info.exitCode})` : ''}` : 'Open a project and choose a terminal.';
    this.element('terminal-scope').title = tab?.info.root ?? '';
    this.element<HTMLButtonElement>('terminal-close').disabled = !tab || this.closing;
    this.element('terminal-empty').hidden = this.tabs.size > 0;
  }
  private select(id: string) { this.active = id; for (const tab of this.tabs.values()) tab.host.hidden = tab.info.id !== id; this.labels(); this.fit(); if (!this.panel.hidden && !document.querySelector('dialog[open]')) this.tabs.get(id)?.terminal.focus(); }
  private async open(kind: TerminalKind) {
    if (this.opening) return; this.opening = true;
    this.panel.querySelectorAll<HTMLButtonElement>('[data-terminal-kind]').forEach(b => { b.disabled = true; });
    this.element('terminal-notice').textContent = 'Starting terminal…';
    try {
      const result = await this.api.terminalOpen(kind, kind === 'codex' || kind === 'claude' ? this.agentPath(kind) : '');
      if (!result.ok || !result.terminal) { this.element('terminal-notice').textContent = result.message ?? 'Could not start terminal.'; return; }
      const info = result.terminal; const terminal = new Terminal({ cursorBlink: true, scrollback: 3000, fontFamily: 'Consolas, monospace', fontSize: 14, allowProposedApi: false, theme: terminalTheme() });
      const fit = new FitAddon(); terminal.loadAddon(fit);
      const host = document.createElement('div'); host.className = 'terminal-host'; host.dataset.terminalId = info.id; this.element('terminal-content').append(host);
      const button = document.createElement('button'); button.className = 'quiet-button'; button.setAttribute('role', 'tab'); button.onclick = () => this.select(info.id); this.element('terminal-tabs').append(button);
      const tab = { info, terminal, fit, host, button }; this.tabs.set(info.id, tab); terminal.open(host);
      terminal.onData(data => this.api.terminalInput(info.id, data));
      this.select(info.id); this.api.terminalAttach(info.id); this.element('terminal-notice').textContent = '';
    } catch { this.element('terminal-notice').textContent = 'Could not start terminal. Check the installation and retry.'; }
    finally { this.opening = false; this.panel.querySelectorAll<HTMLButtonElement>('[data-terminal-kind]').forEach(b => { b.disabled = false; }); }
  }
  private async close() {
    const id = this.active; if (!id || this.closing) return; this.closing = true; this.labels();
    try {
      const result = await this.api.terminalClose(id);
      if (!result.ok) { this.element('terminal-notice').textContent = result.message ?? 'Terminal kept open.'; return; }
      const tab = this.tabs.get(id); tab?.terminal.dispose(); tab?.host.remove(); tab?.button.remove(); this.tabs.delete(id);
      if (this.active === id) this.select([...this.tabs.keys()].at(-1) ?? '');
      this.element('terminal-notice').textContent = 'Terminal closed.';
    } catch { this.element('terminal-notice').textContent = 'Could not confirm terminal exit. Retry closing it.'; }
    finally { this.closing = false; this.labels(); }
  }
}
