import { BrowserWindow, ipcMain, session, WebContentsView, type Rectangle } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { OUTPUT_LIMIT, forPlugin, parseDiscoveryResult, parseResult, validSource, type PluginManifest, type RenderRequest, type RenderResult } from '../shared/plugin-runtime';
import type { DiscoveryRequest, DiscoveryResult } from '../../packages/plugin-api/src/index';

// The supervisor is trusted; only the worker imports external code. CSP is inherited by blob workers.
function supervisor() {
  const bridge = (window as any).supervisor;
  let worker: Worker;
  bridge.receive((message: any) => {
    if (message.type === 'init') {
      const bootstrap = `let plugin, exported; const send = self.postMessage.bind(self); const stringify = JSON.stringify; self.onmessage = async ({data}) => {
        try {
          if (data.type === 'init') { plugin = await import(URL.createObjectURL(new Blob([data.code], {type:'text/javascript'}))); exported = data.exported; if (typeof plugin[exported] !== 'function') throw new Error('Missing export'); send({type:'ready'}); }
          else if (data.type === 'dispose') { await plugin?.dispose?.(); send({type:'disposed'}); }
          else { const result = stringify(await plugin[exported](data.request)); if (typeof result !== 'string' || result.length > 1048576) throw new Error('Response exceeds 1 MiB'); send({type:'result', json:result}); }
        } catch { send({type:'error'}); }
      };`;
      worker = new Worker(URL.createObjectURL(new Blob([bootstrap], { type: 'text/javascript' })), { type: 'module' });
      let completed = false;
      worker.onmessage = ({ data }) => {
        // Bound what reaches privileged IPC even if external code calls postMessage directly.
        if (!data || typeof data !== 'object') { bridge.send({ type: 'error' }); return; }
        if (data.type === 'ready' && !completed) { completed = true; bridge.send({ type: 'ready' }); }
        else if (data.type === 'disposed') bridge.send({ type: 'disposed' });
        else if (data.type === 'result' && typeof data.json === 'string' && data.json.length <= 1048576) bridge.send({ type: 'result', json: data.json });
        else bridge.send({ type: 'error' });
      };
      worker.onerror = () => bridge.send({ type: 'error' });
      worker.onmessageerror = () => bridge.send({ type: 'error' });
    }
    worker.postMessage(message);
  });
  bridge.send({ type: 'supervisor-ready' });
}
export class PluginRuntime {
  private window: BrowserWindow;
  private pending?: { resolve: (value: any) => void; reject: (error: Error) => void; parse: (json: string) => unknown; timer: ReturnType<typeof setTimeout> };
  private ready: Promise<void>;
  private dead = false;
  private stopping = false;
  private initialized = false;
  private supervisorReady = false;
  private rejectReady!: (error: Error) => void;
  private readyTimer: ReturnType<typeof setTimeout>;
  private listener: (event: Electron.IpcMainEvent, value: any) => void;
  /** Increment 97c: `discover` runs a discovery contribution's export instead of `render`. */
  constructor(private manifest: PluginManifest, code: string, private report: (message: string) => void, private exported: 'render' | 'discover' = 'render') {
    const partition = session.fromPartition(`plugin-${randomUUID()}`, { cache: false });
    partition.setPermissionCheckHandler(() => false);
    partition.setPermissionRequestHandler((_wc, _permission, done) => done(false));
    partition.setDevicePermissionHandler(() => false);
    partition.webRequest.onBeforeRequest((details, done) => done({ cancel: details.url !== 'specular-plugin://host/index.html' && !details.url.startsWith('blob:') }));
    partition.on('will-download', event => event.preventDefault());
    this.window = new BrowserWindow({ show: false, webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      webSecurity: true, webviewTag: false, devTools: false, backgroundThrottling: false,
      session: partition, preload: path.join(__dirname, 'plugin-preload.cjs'),
    } });
    this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.window.webContents.on('will-navigate', event => event.preventDefault());
    this.window.webContents.on('will-attach-webview', event => event.preventDefault());
    this.window.webContents.on('render-process-gone', () => this.fail('Plugin process stopped. Reopen its view to retry.'));
    this.window.on('closed', () => { this.fail('Plugin stopped.'); void partition.clearStorageData().catch(() => {}); });
    let resolveReady!: () => void;
    this.ready = new Promise((resolve, reject) => { resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    this.readyTimer = setTimeout(() => this.fail('Plugin activation timed out.'), 10000);
    this.listener = (event, value) => {
      if (event.sender !== this.window.webContents || event.senderFrame !== this.window.webContents.mainFrame || this.dead) return;
      if (value?.type === 'supervisor-ready' && !this.supervisorReady) { this.supervisorReady = true; this.window.webContents.send('plugin:command', { type: 'init', code, exported: this.exported }); }
      else if (value?.type === 'ready' && !this.initialized) { this.initialized = true; clearTimeout(this.readyTimer); resolveReady(); }
      else if (value?.type === 'disposed' && this.stopping) this.destroy();
      else if (value?.type === 'result' && this.pending && typeof value.json === 'string' && value.json.length <= OUTPUT_LIMIT) {
        try {
          const result = this.pending.parse(value.json);
          const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); pending.resolve(result);
        } catch (error) { this.fail(error instanceof Error ? error.message : 'Invalid plugin response.'); }
      } else this.fail(this.exported === 'discover' ? 'Discovery failed or sent an invalid response.' : 'Plugin failed or sent an invalid response. Reopen its view to retry.');
    };
    ipcMain.on('plugin:response', this.listener);
    const nonce = randomUUID();
    const csp = `default-src 'none'; script-src 'nonce-${nonce}' blob:; worker-src blob:; connect-src 'none'; img-src 'none'; style-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    const html = `<meta http-equiv="Content-Security-Policy" content="${csp}"><script nonce="${nonce}">(${supervisor.toString()})()</script>`;
    partition.protocol.handle('specular-plugin', request => request.url === 'specular-plugin://host/index.html' ? new Response(html, { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': csp } }) : new Response('Forbidden', { status: 403 }));
    void this.window.loadURL('specular-plugin://host/index.html').catch(() => this.fail('Plugin sandbox could not start.'));
  }
  async render(request: RenderRequest) {
    await this.ready;
    if (this.dead) throw new Error('Plugin is stopped. Reopen its view to retry.');
    if (this.pending) throw new Error('Plugin is still processing a snapshot.');
    return new Promise<RenderResult>((resolve, reject) => {
      this.pending = { resolve, reject, parse: json => parseResult(json, request, this.manifest), timer: setTimeout(() => this.fail('Plugin timed out after 5 seconds. Reopen its view to retry.'), 5000) };
      this.window.webContents.send('plugin:command', { type: 'render', request: forPlugin(request, this.manifest) });
    });
  }
  /** Increment 97c: one discovery run, bounded in time; the result's shape is checked here and its content by the review. */
  async discover(request: DiscoveryRequest, timeout = 10000) {
    await this.ready;
    if (this.dead) throw new Error('Plugin is stopped.');
    if (this.pending) throw new Error('Plugin is still discovering.');
    return new Promise<DiscoveryResult>((resolve, reject) => {
      this.pending = { resolve, reject, parse: json => parseDiscoveryResult(json, request), timer: setTimeout(() => this.fail(`Discovery timed out after ${timeout / 1000} seconds.`), timeout) };
      this.window.webContents.send('plugin:command', { type: 'discover', request });
    });
  }
  private fail(message: string) {
    if (this.dead) return;
    this.report(message);
    this.rejectReady(new Error(message));
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error(message)); this.pending = undefined; }
    this.destroy();
  }
  private destroy() {
    if (this.dead) return;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('Plugin stopped.')); this.pending = undefined; }
    this.rejectReady(new Error('Plugin stopped.'));
    this.dead = true; clearTimeout(this.readyTimer); ipcMain.removeListener('plugin:response', this.listener);
    if (!this.window.isDestroyed()) this.window.destroy();
  }
  dispose() {
    if (this.dead) return;
    if (this.pending) { this.fail('Plugin view closed.'); return; }
    this.stopping = true;
    this.window.webContents.send('plugin:command', { type: 'dispose' });
    setTimeout(() => this.fail('Plugin disposed.'), 200);
  }
  terminate() { this.fail('Plugin project or view changed.'); }
}

function customSupervisor() {
  const bridge = (window as any).supervisor;
  let frame: HTMLIFrameElement;
  bridge.receive((message: any) => {
    if (message.type === 'init') {
      frame = document.createElement('iframe'); frame.setAttribute('sandbox', 'allow-scripts allow-same-origin'); frame.setAttribute('title', 'Plugin interface');
      Object.assign(frame.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', border: '0' });
      frame.onload = () => frame.contentWindow?.postMessage(message, '*');
      frame.src = 'specular-plugin-ui://plugin/index.html'; document.body.append(frame);
    } else frame?.contentWindow?.postMessage(message, '*');
  });
  addEventListener('message', ({ source, data }) => {
    if (source !== frame?.contentWindow || !data || typeof data !== 'object') return;
    if (data.type === 'ready' || data.type === 'disposed' || data.type === 'error') bridge.send({ type: data.type });
    else if (data.type === 'updated' && typeof data.requestId === 'string' && data.requestId.length <= 128) bridge.send({ type: 'updated', requestId: data.requestId });
    else if (data.type === 'state' && typeof data.state === 'string' && data.state.length <= 65536) bridge.send({ type: 'state', state: data.state });
    else if (data.type === 'navigate' && data.source && typeof data.source === 'object') bridge.send({ type: 'navigate', source: data.source });
    // Increment 94: summary calls name a subject only; the host builds any text sent to a model.
    else if (data.type === 'summary' && typeof data.id === 'string' && data.id.length <= 64 && ['get', 'generate', 'cancel'].includes(data.op) && data.subject && typeof data.subject === 'object' && JSON.stringify(data).length <= 65536)
      bridge.send({ type: 'summary', id: data.id, op: data.op, subject: data.subject, ...(data.options && typeof data.options === 'object' ? { options: data.options } : {}) });
    else bridge.send({ type: 'error' });
  });
  bridge.send({ type: 'supervisor-ready' });
}

function customFrame() {
  let plugin: any, instance: any, summaries: any, calls = 0;
  const root = document.querySelector('#plugin-root') as HTMLElement;
  const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const call = (op: string, subject: unknown, options?: unknown) => new Promise((resolve, reject) => {
    const id = `summary-${++calls}`; pending.set(id, { resolve, reject });
    parent.postMessage({ type: 'summary', id, op, subject, ...(options === undefined ? {} : { options }) }, '*');
  });
  addEventListener('message', async ({ data }) => {
    if (data?.type === 'summary-result') {
      const waiting = pending.get(data.id); pending.delete(data.id);
      if (waiting) { if (data.ok) waiting.resolve(data.record ?? undefined); else waiting.reject(new Error(String(data.message ?? 'Summary failed.'))); }
      return;
    }
    try {
      if (data.type === 'init') {
        if (data.summaries) summaries = Object.freeze({ get: (subject: unknown) => call('get', subject), generate: (subject: unknown, options: unknown) => call('generate', subject, options),
          cancel: (subject: unknown) => { parent.postMessage({ type: 'summary', id: `summary-${++calls}`, op: 'cancel', subject }, '*'); } });
        plugin = await import(URL.createObjectURL(new Blob([data.code], { type: 'text/javascript' })));
        if (typeof plugin.activate !== 'function') throw new Error('Missing activate export');
        parent.postMessage({ type: 'ready' }, '*');
      } else if (data.type === 'update') {
        const appearance = data.request.appearance;
        if (appearance) {
          document.documentElement.dataset.theme = appearance.mode;
          document.documentElement.style.colorScheme = appearance.mode;
          for (const [name, value] of Object.entries(appearance.colors)) document.documentElement.style.setProperty('--specular-' + name, String(value));
        }
        if (!instance) { instance = await plugin.activate({ root, request: data.request, openSource: (source: any) => parent.postMessage({ type: 'navigate', source }, '*'), saveState: (state: string) => { if (typeof state !== 'string' || state.length > 65536) throw new Error('Custom state exceeds 64 KiB.'); parent.postMessage({ type: 'state', state }, '*'); }, ...(summaries ? { summaries } : {}) }); if (!instance || typeof instance.update !== 'function') throw new Error('Missing custom view update'); }
        else { if (typeof instance.update !== 'function') throw new Error('Missing custom view update'); await instance.update(data.request); }
        parent.postMessage({ type: 'updated', requestId: data.request.requestId }, '*');
      } else if (data.type === 'dispose') { await instance?.dispose?.(); parent.postMessage({ type: 'disposed' }, '*'); }
    } catch { parent.postMessage({ type: 'error' }, '*'); }
  });
}

/** A plugin-owned DOM surface layered into the application without sharing its renderer or preload. */
export class CustomPluginRuntime {
  private view: WebContentsView;
  private obscured = false;
  private presented = false;
  private current?: RenderRequest;
  private pending?: { requestId: string; resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
  private ready: Promise<void>;
  private rejectReady!: (error: Error) => void;
  private readyTimer: ReturnType<typeof setTimeout>;
  private listener: (event: Electron.IpcMainEvent, value: any) => void;
  private dead = false;
  private initialized = false;
  private supervisorReady = false;
  private stopping = false;
  constructor(private parent: BrowserWindow, private manifest: PluginManifest, code: string,
    private report: (message: string) => void,
    private navigate: (request: RenderRequest, source: unknown) => void,
    private saveState: (request: RenderRequest, state: string) => void = () => {},
    private summary: (request: RenderRequest, call: { id: string; op: 'get' | 'generate' | 'cancel'; subject: unknown; options?: unknown }) => void = () => {}) {
    const partition = session.fromPartition(`plugin-custom-${randomUUID()}`, { cache: false });
    partition.setPermissionCheckHandler(() => false);
    partition.setPermissionRequestHandler((_wc, _permission, done) => done(false));
    partition.setDevicePermissionHandler(() => false);
    partition.webRequest.onBeforeRequest((details, done) => done({ cancel: details.url !== 'specular-plugin://host/custom.html' && details.url !== 'specular-plugin-ui://plugin/index.html' && !details.url.startsWith('blob:') && !details.url.startsWith('data:') }));
    partition.on('will-download', event => event.preventDefault());
    this.view = new WebContentsView({ webPreferences: {
      sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      webSecurity: true, webviewTag: false, devTools: false, backgroundThrottling: false,
      session: partition, preload: path.join(__dirname, 'plugin-preload.cjs'),
    } });
    this.view.setVisible(false); this.view.setBackgroundColor('#101820'); parent.contentView.addChildView(this.view);
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.view.webContents.on('will-navigate', event => event.preventDefault());
    this.view.webContents.on('will-attach-webview', event => event.preventDefault());
    this.view.webContents.on('context-menu', event => event.preventDefault());
    this.view.webContents.on('render-process-gone', () => this.fail('Plugin process stopped. Reopen its view to retry.'));
    this.view.webContents.on('destroyed', () => { if (!this.dead) this.fail('Plugin stopped.'); void partition.clearStorageData().catch(() => {}); });
    let resolveReady!: () => void;
    this.ready = new Promise((resolve, reject) => { resolveReady = resolve; this.rejectReady = reject; });
    this.ready.catch(() => {});
    this.readyTimer = setTimeout(() => this.fail('Plugin activation timed out.'), 10000);
    this.listener = (event, value) => {
      if (event.sender !== this.view.webContents || event.senderFrame !== this.view.webContents.mainFrame || this.dead) return;
      if (value?.type === 'supervisor-ready' && !this.supervisorReady) {
        this.supervisorReady = true; this.view.webContents.send('plugin:command', { type: 'init', code, summaries: this.summaries });
      } else if (value?.type === 'ready' && !this.initialized) {
        this.initialized = true; clearTimeout(this.readyTimer); resolveReady();
      } else if (value?.type === 'updated' && this.pending && value.requestId === this.pending.requestId) {
        this.presented = true;
        this.view.setVisible(!this.obscured);
        const pending = this.pending; this.pending = undefined; clearTimeout(pending.timer); pending.resolve();
      } else if (value?.type === 'navigate' && this.current && this.manifest.capabilities.includes('source.navigate') && validSource(value.source, this.current)) {
        this.navigate(this.current, value.source);
      } else if (value?.type === 'state' && this.current && this.manifest.customApi !== undefined && typeof value.state === 'string' && value.state.length <= 65536) {
        this.saveState(this.current, value.state);
      } else if (value?.type === 'summary' && this.current && this.summaries && typeof value.id === 'string' && ['get', 'generate', 'cancel'].includes(value.op)) {
        this.summary(this.current, { id: value.id, op: value.op, subject: value.subject, ...(value.options === undefined ? {} : { options: value.options }) });
      } else if (value?.type === 'disposed' && this.stopping) this.destroy();
      else this.fail('Plugin failed or sent an invalid response. Reopen its view to retry.');
    };
    ipcMain.on('plugin:response', this.listener);
    const nonce = randomUUID();
    const csp = `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'none'; img-src 'none'; style-src 'unsafe-inline'; frame-src specular-plugin-ui:; object-src 'none'; base-uri 'none'; form-action 'none'`;
    const html = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>html,body{height:100%;margin:0;background:#101820}</style><script nonce="${nonce}">(${customSupervisor.toString()})()</script>`;
    partition.protocol.handle('specular-plugin', request => request.url === 'specular-plugin://host/custom.html' ? new Response(html, { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': csp } }) : new Response('Forbidden', { status: 403 }));
    const frameNonce = randomUUID();
    const frameCsp = `default-src 'none'; script-src 'nonce-${frameNonce}' blob:; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
    const frameHtml = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${frameCsp}"><style>html,body,#plugin-root{box-sizing:border-box;min-height:100%;margin:0}body{background:var(--specular-background,#101820);color:var(--specular-text,#d8e2e8);font:14px system-ui,sans-serif}button,input,select,textarea{font:inherit}</style><main id="plugin-root"></main><script nonce="${frameNonce}">(${customFrame.toString()})()</script>`;
    partition.protocol.handle('specular-plugin-ui', request => request.url === 'specular-plugin-ui://plugin/index.html' ? new Response(frameHtml, { headers: { 'Content-Type': 'text/html', 'Content-Security-Policy': frameCsp } }) : new Response('Forbidden', { status: 403 }));
    void this.view.webContents.loadURL('specular-plugin://host/custom.html').catch(() => this.fail('Plugin sandbox could not start.'));
  }
  /** Increment 94: summaries need customApi 2 and the declared capability. */
  private get summaries() { return this.manifest.customApi === 2 && this.manifest.capabilities.includes('summary.generate'); }
  /** Delivers a host summary result to the frame's pending call. */
  summaryResult(id: string, result: { ok: true; record?: unknown } | { ok: false; message: string }) {
    if (!this.dead) this.view.webContents.send('plugin:command', { type: 'summary-result', id, ...result });
  }
  async render(request: RenderRequest, bounds: Rectangle) {
    await this.ready;
    if (this.dead) throw new Error('Plugin is stopped. Reopen its view to retry.');
    if (this.pending) throw new Error('Plugin is still processing a snapshot.');
    this.current = request; this.layout(bounds);
    this.view.setBackgroundColor(request.appearance?.colors.background ?? '#101820');
    return new Promise<void>((resolve, reject) => {
      this.pending = { requestId: request.requestId, resolve, reject, timer: setTimeout(() => this.fail('Plugin timed out after 5 seconds. Reopen its view to retry.'), 5000) };
      this.view.webContents.send('plugin:command', { type: 'update', request: forPlugin(request, this.manifest) });
    });
  }
  setObscured(obscured: boolean) {
    this.obscured = obscured;
    if (!this.dead && !this.stopping) this.view.setVisible(this.presented && !obscured);
  }
  layout(bounds: Rectangle) {
    if (this.dead) return;
    this.view.setBounds({ x: Math.max(0, Math.round(bounds.x)), y: Math.max(0, Math.round(bounds.y)), width: Math.max(1, Math.round(bounds.width)), height: Math.max(1, Math.round(bounds.height)) });
  }
  private fail(message: string) {
    if (this.dead) return;
    this.report(message); this.rejectReady(new Error(message));
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error(message)); this.pending = undefined; }
    this.destroy();
  }
  private destroy() {
    if (this.dead) return;
    this.dead = true; clearTimeout(this.readyTimer); ipcMain.removeListener('plugin:response', this.listener);
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('Plugin stopped.')); this.pending = undefined; }
    this.rejectReady(new Error('Plugin stopped.'));
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close({ waitForBeforeUnload: false });
    try { this.view.setVisible(false); if (!this.parent.isDestroyed()) this.parent.contentView.removeChildView(this.view); } catch {}
  }
  dispose() {
    if (this.dead) return;
    if (this.pending) { this.fail('Plugin view closed.'); return; }
    this.stopping = true; this.view.setVisible(false); this.view.webContents.send('plugin:command', { type: 'dispose' });
    setTimeout(() => this.fail('Plugin disposed.'), 200);
  }
  terminate() { this.fail('Plugin project or view changed.'); }
}
