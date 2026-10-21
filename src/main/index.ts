import { PluginManager } from '../core/plugin-manager';
import { CustomPluginRuntime, PluginRuntime } from './plugin-runtime';
import { parseRequest } from '../shared/plugin-runtime';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, net, protocol, session, safeStorage } from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { cp, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inside, Workspace } from '../core/workspace';
import type { CreateDocumentResult, WorkspaceOpenResult, WorkspaceSnapshot } from '../shared/types';
import { parseWorkspaceSession, Settings } from '../core/settings';
import { discoverAgent } from '../core/agent-discovery';
import type { AgentCheckResult, AgentId } from '../shared/types';
import { CodexConnection } from '../core/codex-connection';
import { CredentialStore } from '../core/credential-store';
import { CodexAccess } from '../core/codex-access';
import { CodexConversation } from '../core/codex-conversation';
import { ConversationHistory } from '../core/conversation-history';
import { Terminals } from '../core/terminals';
import { Worker } from 'node:worker_threads';
import { AgentToolHost } from '../core/agent-tool-host';
import { CodexDiscoveryAdapter } from '../core/codex-discovery';
import { ClaudeDiscoveryAdapter } from '../core/claude-discovery';
import { DiscoveryRun, runLimits, toolCallLimitError, type AgentDiscoveryRequest, type ProgressKind } from '../core/discovery-run';
import { validateIdConfiguration } from '../core/id-configuration';

app.setName('Specular');
if (process.env.SPECULAR_USER_DATA) app.setPath('userData', path.resolve(process.env.SPECULAR_USER_DATA));
protocol.registerSchemesAsPrivileged([{ scheme: 'specular-plugin', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }, { scheme: 'specular-plugin-ui', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }, { scheme: 'specular', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
let window: BrowserWindow;
let workspace: Workspace | undefined;
let watcher: FSWatcher | undefined;
let changedTimer: ReturnType<typeof setTimeout>;
let dirty = false;
let closing = false;
let settings: Settings;
let rebuildMenu = () => {};
let opening = false;
let closePending = false;
const agentChecks = new Map<AgentId, { controller: AbortController; pending: Promise<AgentCheckResult> }>();
let codex: CodexConnection;
let codexAccess: CodexAccess;
let conversation: CodexConversation;
let agentRun: { id: string; run: DiscoveryRun } | undefined;
const stopAgentRun = () => { const active = agentRun; agentRun = undefined; void active?.run.cancel(); };
let terminals: Terminals;
let pluginManager: PluginManager;
type ActivePluginRuntime = { runtime: PluginRuntime | CustomPluginRuntime; project: string; custom: boolean };
let customPluginsObscured = false;
const pluginRuntimes = new Map<string, ActivePluginRuntime>();
function stopPlugins() { for (const { runtime } of pluginRuntimes.values()) runtime.terminate(); pluginRuntimes.clear(); }

async function switchWorkspace(task: () => Promise<WorkspaceSnapshot | null>): Promise<WorkspaceOpenResult> {
  if (opening) return { ok: false, message: 'A project is already being opened.' };
  opening = true;
  stopAgentRun();
  try { return { ok: true, workspace: await task() }; }
  catch { return { ok: false, message: 'Could not open the project folder. It may have moved or be unavailable. Choose it with Open project or remove its recent entry.' }; }
  finally { opening = false; }
}

const textArg = (value: unknown, limit = 4_194_304): string => {
  if (typeof value !== 'string' || value.length > limit || value.includes('\0')) throw new Error('Invalid request.');
  return value;
};
const pluginBounds = (value: unknown): Electron.Rectangle => {
  if (!value || typeof value !== 'object') throw new Error('Invalid plugin bounds.');
  const input = value as Record<string, unknown>;
  if (!['x', 'y', 'width', 'height'].every(key => typeof input[key] === 'number' && Number.isFinite(input[key]))) throw new Error('Invalid plugin bounds.');
  const content = window.getContentBounds();
  const x = Math.max(0, Math.min(content.width - 1, Math.round(input.x as number)));
  const y = Math.max(0, Math.min(content.height - 1, Math.round(input.y as number)));
  return { x, y, width: Math.max(1, Math.min(content.width - x, Math.round(input.width as number))), height: Math.max(1, Math.min(content.height - y, Math.round(input.height as number))) };
};
const active = () => { if (!workspace) throw new Error('Open a project first.'); return workspace; };
const trust = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
  if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame?.url.startsWith('specular://app/')) throw new Error('Untrusted request.');
};
const handle = (channel: string, listener: (...args: unknown[]) => unknown) => ipcMain.handle(channel, (event, ...args) => { trust(event); return listener(...args); });

async function openWorkspace(root: string, recordHistory = true) {
  await settings.flush();
  const next = await Workspace.open(root);
  const snapshot = await next.snapshot();
  // snapshot tolerates unreadable subfolders; the project root itself must be readable.
  await readdir(next.root);
  const saved = settings.workspaceSession(next.root);
  if (saved) {
    const key = (file: string) => process.platform === 'win32' ? file.toLowerCase() : file;
    const available = new Map(snapshot.files.map(file => [key(file.path), file.path]));
    const files = saved.files.map(file => available.get(key(file))).filter((file): file is string => !!file);
    const missing = saved.files.filter(file => !available.has(key(file)));
    if (missing.length) snapshot.warnings.push(`Skipped unavailable saved tabs: ${missing.join(', ')}`);
    const activeFile = saved.activeFile ? available.get(key(saved.activeFile)) : undefined;
    snapshot.session = { files: [...new Set(files)], activeFile: activeFile && files.includes(activeFile) ? activeFile : files[0] };
  }
  watcher?.close();
  clearTimeout(changedTimer);
  stopPlugins();
  workspace = next;
  conversation?.setOpenProject(next.root);
  dirty = false;
  try {
    watcher = watch(next.root, { recursive: true }, (_event, file) => {
      if (!file || /(?:^|[\\/])(?:node_modules|\.git|dist|out|\.cache|test-results)(?:[\\/]|$)/.test(file.toString()) || file.toString().includes('.specular-save-')) return;
      clearTimeout(changedTimer);
      changedTimer = setTimeout(() => { if (!window.isDestroyed()) window.webContents.send('workspace:changed'); }, 350);
    });
    watcher.on('error', () => { if (!window.isDestroyed()) window.webContents.send('workspace:changed'); });
  } catch { snapshot.warnings.push('File watching is unavailable. Use Refresh to discover external changes.'); }
  const recent = recordHistory ? await settings.record(next.root) : settings.snapshot();
  if (recent.warning) snapshot.warnings.push(recent.warning);
  rebuildMenu();
  return snapshot;
}

app.whenReady().then(async () => {
  settings = await Settings.load(path.join(app.getPath('userData'), 'settings.json'));
  pluginManager = await PluginManager.load(path.join(app.getPath('userData'), 'plugins'), [path.join(__dirname, 'bundled-plugins', 'relationships')]);
  const renderer = path.join(__dirname, 'renderer');
  protocol.handle('specular', request => {
    const url = new URL(request.url);
    let resource: string;
    try { resource = path.resolve(renderer, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)); }
    catch { return new Response('Invalid path', { status: 400 }); }
    if (url.host !== 'app' || !inside(renderer, resource)) return new Response('Forbidden', { status: 403 });
    return net.fetch(pathToFileURL(resource).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  window = new BrowserWindow({ width: 1480, height: 940, minWidth: 980, minHeight: 680, title: 'Specular',
    backgroundColor: settings.theme() === 'light' ? '#f4f7fa' : '#101318', show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  codex = new CodexConnection(app.getPath('userData'), state => {
    if (!window.isDestroyed()) window.webContents.send('codex:state', state);
  });
  const credentialStore = await CredentialStore.load(path.join(app.getPath('userData'), 'codex-credentials'), {
    available: async () => process.platform === 'win32' && await safeStorage.isAsyncEncryptionAvailable(),
    encrypt: key => safeStorage.encryptStringAsync(key),
    decrypt: async bytes => (await safeStorage.decryptStringAsync(bytes)).result,
  });
  codexAccess = new CodexAccess(codex, credentialStore);
  const history = await ConversationHistory.load(path.join(app.getPath('userData'), 'codex-conversation.json'));
  conversation = new CodexConversation(codex, state => { if (!window.isDestroyed()) window.webContents.send('codex:conversation-state', state); }, undefined, history);
  terminals = new Terminals(event => { if (!window.isDestroyed()) window.webContents.send('terminal:event', event); }, app.getPath('userData'));
  window.webContents.on('render-process-gone', () => { stopAgentRun(); void terminals.shutdown(); });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.on('close', event => {
    if (closing) return;
    event.preventDefault();
    if (closePending) return;
    closePending = true;
    stopAgentRun();
    window.webContents.send('app:action', 'capture-before-close');
  });
  // Renderer reveals the window only after applying the stored appearance.
  rebuildMenu = () => {
  const action = (name: string) => () => window.webContents.send('app:action', name);
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'Open project…', accelerator: 'CmdOrCtrl+O', click: action('open') },
      { label: 'Open recent', submenu: [
        ...settings.snapshot().projects.map(project => ({ label: `${project.name} — ${project.path}`.replace(/&/g, '&&'), click: action(`recent:${project.path}`) })),
        ...(settings.snapshot().projects.length ? [{ type: 'separator' as const }] : [{ label: 'No recent projects', enabled: false }]),
        { label: 'Manage recent projects…', click: action('recent-projects') },
      ] },
      { label: 'New Markdown file…', accelerator: 'CmdOrCtrl+N', click: action('new-file') },
      { label: 'Close tab', accelerator: 'CmdOrCtrl+W', click: action('close-tab') },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { label: 'Edit', submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Navigate', submenu: [
      { label: 'Go to definition', accelerator: 'F12', click: action('definition') },
      { label: 'Find references', accelerator: 'Shift+F12', click: action('references') },
      { label: 'Search project IDs', accelerator: 'CmdOrCtrl+P', click: action('search') },
      { label: 'Find in current Markdown file', click: action('markdown-find') },
      { label: 'Search project Markdown', click: action('markdown-search') },
    ] },
    { label: 'View', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'toggleDevTools' }] },
    { label: 'Agents', submenu: [{ label: 'Agent setup…', click: action('agent-setup') }, { label: 'Codex conversation…', click: action('codex-conversation') }] },
    { label: 'Terminal', submenu: [{ label: 'Show/hide terminals', accelerator: 'CmdOrCtrl+Shift+T', click: action('terminals') }] },
  ]));
  };
  rebuildMenu();
  handle('agent:choose-path', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Choose an installed agent executable', properties: ['openFile'],
      filters: [{ name: 'Agent executables', extensions: ['exe', 'cmd', 'bat'] }] });
    return result.canceled ? null : result.filePaths[0];
  });
  handle('agent:check', async (id, value) => {
    if (id !== 'codex' && id !== 'claude') throw new Error('Unknown agent.');
    if (closing || closePending) return { agent: id, status: 'failed', message: 'Specular is closing.' };
    if (agentChecks.has(id)) return { agent: id, status: 'failed', message: 'A version check is already running for this agent.' };
    const controller = new AbortController();
    const pending = discoverAgent(id, value as string, { cwd: app.getPath('userData'), projectRoot: workspace?.root, signal: controller.signal });
    agentChecks.set(id, { controller, pending });
    try { return await pending; } finally { agentChecks.delete(id); }
  });
  handle('codex:status', async () => { await codex.refresh(); return codexAccess.snapshot(); });
  handle('codex:credentials', () => codexAccess.credentials());
  handle('codex:forget-key', () => codexAccess.forget());
  handle('codex:connect', (executable, key, remember, autoConnect) => {
    if (closing || closePending) return codex.snapshot();
    // Ordinary validation failures use structured results; secret-bearing errors never cross IPC.
    return codexAccess.connect(executable, key, remember, autoConnect, workspace?.root);
  });
  handle('codex:disconnect', () => codexAccess.disconnect());
  handle('codex:conversation', () => conversation.snapshot());
  handle('codex:resume', () => closing || closePending || opening ? { ok: false, message: 'Wait for the project change or window close.' } : conversation.resume());
  handle('codex:select-model', model => conversation.selectModel(model));
  handle('codex:fresh', async () => {
    if (closing || closePending || opening) return { ok: false, message: 'Wait for the project change or window close.' };
    const answer = await dialog.showMessageBox(window, { type: 'question', title: 'Start a fresh conversation?', message: 'Clear the displayed and saved transcript and start fresh context?', detail: 'Earlier messages will not be sent. Native runtime history is retained separately.', buttons: ['Keep history', 'Start fresh'], defaultId: 0, cancelId: 0, noLink: true });
    if (answer.response !== 1) return { ok: false, message: 'History kept.' };
    return conversation.startFresh();
  });
  handle('codex:models', () => conversation.models());
  handle('codex:send-brief', (root, text, model) => {
    if (closing || closePending || opening || !workspace || typeof root !== 'string' || root.toLowerCase() !== workspace.root.toLowerCase()) return { ok: false, message: 'The brief project is no longer available. Wait for any project change to finish, or reopen its project.' };
    return conversation.sendBrief(root, text, model);
  });
  handle('codex:send', (text, model) => closing || closePending || opening ? { ok: false, message: 'Wait for the project change or window close to finish.' } : conversation.send(text, model));
  handle('codex:stop', () => conversation.stop());
  handle('codex:use-project', () => closing || closePending || opening ? { ok: false, message: 'Wait for the project change or window close to finish.' } : conversation.useOpenProject());
  handle('terminal:open', async (kind, executable) => {
    if (closing || closePending || opening) return { ok: false, message: 'Wait for the project change or window close to finish.' };
    if (!workspace) return { ok: false, message: 'Open a project before starting a terminal.' };
    try { return { ok: true, terminal: await terminals.open(kind, workspace.root, executable) }; }
    catch { return { ok: false, message: 'Could not open the terminal. Check the project folder and agent installation/path in Agent setup. Close an existing tab if six terminals are open.' }; }
  });
  handle('terminal:insert-brief', (id, root, text) => {
    if (closing || closePending || opening || !workspace || typeof root !== 'string' || root.toLowerCase() !== workspace.root.toLowerCase()) {
      return { ok: false, message: 'The brief’s project is no longer available. Reopen the brief in the intended project.' };
    }
    return terminals.insertBrief(id, workspace.root, text);
  });
  handle('terminal:close', async id => {
    const key = textArg(id, 64); const terminal = terminals.list().find(t => t.id === key);
    if (terminal && terminal.status !== 'exited') {
      const answer = await dialog.showMessageBox(window, { type: 'question', title: 'Close terminal?', message: 'Stop this terminal and its running commands?', detail: terminal.root, buttons: ['Keep terminal', 'Close terminal'], defaultId: 0, cancelId: 0, noLink: true });
      if (answer.response !== 1) return { ok: false };
    }
    const ok = await terminals.close(key); return { ok, message: ok ? undefined : 'Terminal exit was not confirmed. Retry closing it.' };
  });
  for (const channel of ['attach', 'input', 'resize', 'ack']) ipcMain.on(`terminal:${channel}`, (event, id, a, b) => {
    trust(event); if (typeof id !== 'string' || id.length > 64) return;
    if (channel === 'attach') terminals.attach(id);
    else if (channel === 'input') terminals.input(id, a);
    else if (channel === 'resize') terminals.resize(id, a, b);
    else terminals.acknowledge(id, a);
  });
  const requestedProject = process.argv.find(arg => arg.startsWith('--project='))?.slice('--project='.length);
  handle('workspace:initial', () => switchWorkspace(async () => {
    if (workspace) return workspace.snapshot();
    const root = requestedProject || settings.lastProject();
    return root ? openWorkspace(root, !!requestedProject) : null;
  }));
  handle('workspace:choose', () => switchWorkspace(async () => {
    if (dirty) throw new Error('Pending Markdown changes must be resolved before switching projects.');
    const result = await dialog.showOpenDialog(window, { title: 'Open a Specular project', properties: ['openDirectory'] });
    return result.canceled ? null : openWorkspace(result.filePaths[0]);
  }));
  handle('workspace:demo', () => switchWorkspace(async () => {
    if (dirty) throw new Error('Pending Markdown changes must be resolved before switching projects.');
    const destination = path.join(app.getPath('userData'), 'demo-project');
    await mkdir(destination, { recursive: true });
    const sample = app.isPackaged
      ? path.join(process.resourcesPath, 'first-project')
      : path.join(app.getAppPath(), 'examples', 'first-project');
    await cp(sample, destination, { recursive: true, force: false, errorOnExist: false });
    return openWorkspace(destination);
  }));
  handle('recent:list', () => settings.snapshot());
  handle('appearance:theme', () => settings.theme());
  handle('appearance:save-theme', value => settings.saveTheme(value));
  handle('appearance:ready', () => { window.show(); });
  handle('appearance:font-sizes', () => settings.fontSizes());
  handle('appearance:save-font-sizes', sizes => settings.saveFontSizes(sizes));
  handle('recent:open', root => switchWorkspace(async () => {
    const target = textArg(root, 4096);
    if (!settings.contains(target)) throw new Error('The recent entry is no longer available.');
    if (dirty) throw new Error('Pending Markdown changes must be resolved before switching projects.');
    return openWorkspace(target);
  }));
  handle('recent:remove', async root => { const result = await settings.remove(textArg(root, 4096)); rebuildMenu(); return result; });
  handle('recent:clear', async () => { const result = await settings.clear(); rebuildMenu(); return result; });
  handle('workspace:refresh', () => active().snapshot());
  handle('agent-discovery:cancel', value => { const id = textArg(value, 80); if (agentRun?.id === id) stopAgentRun(); });
  handle('agent-discovery:run', async value => {
    const request = value as AgentDiscoveryRequest;
    let run: DiscoveryRun | undefined;
    try {
      if (agentRun) throw new Error('A discovery run is already in progress.');
      if (!request || JSON.stringify(request).length > 1_000_000 || !/^[a-zA-Z0-9-]{1,80}$/.test(request.requestId) || (request.agent !== 'codex' && request.agent !== 'claude') || (request.executable !== undefined && (typeof request.executable !== 'string' || request.executable.length > 4096))) throw new Error('Invalid discovery request.');
      if (request.model !== undefined && (typeof request.model !== 'string' || !/^[a-zA-Z0-9._:/-]{1,128}$/.test(request.model))) throw new Error('Invalid model ID.');
      const limitError = request.toolCalls === undefined ? undefined : toolCallLimitError(request.toolCalls);
      if (limitError) throw new Error(limitError);
      const target = active(), id = request.requestId;
      const current = () => agentRun?.id === id && workspace === target && !opening && !closing && !closePending;
      if (request.root !== target.root) throw new Error('The active project changed. Reopen Project configuration.');
      const configuration = validateIdConfiguration(request.configuration);
      // The run sees the disk snapshot the review was opened on; any change during the run invalidates its proposal.
      const fresh = async () => {
        const snapshot = await target.snapshot();
        if (snapshot.idConfiguration?.diskVersion !== request.diskVersion || !request.documentVersions || Object.keys(snapshot.documentVersions!).length !== Object.keys(request.documentVersions).length || Object.entries(snapshot.documentVersions!).some(([file, version]) => request.documentVersions[file] !== version)) throw new Error('Markdown or configuration changed on disk. Refresh and run discovery again. No configuration was changed.');
        return snapshot;
      };
      const snapshot = await fresh();
      const send = (message: string, kind: ProgressKind = 'status') => { if (!window.isDestroyed() && agentRun?.id === id) window.webContents.send('agent-discovery:progress', { requestId: id, message, kind }); };
      const host = new AgentToolHost({ documents: snapshot.documents, configuration }, data => new Worker(path.join(__dirname, 'agent-tools-worker.cjs'), { workerData: data }));
      const adapter = request.agent === 'claude' ? new ClaudeDiscoveryAdapter({ executable: request.executable ?? '', runRoot: path.join(app.getPath('userData'), 'claude-discovery') }) : new CodexDiscoveryAdapter(codex);
      run = new DiscoveryRun({ adapter, host, model: request.model, progress: send, limits: runLimits(request.toolCalls),
        proxy: { command: process.execPath, args: [path.join(__dirname, 'specular-mcp.cjs')], env: { ELECTRON_RUN_AS_NODE: '1' } } });
      agentRun = { id, run };
      const result = await run.start();
      await run.stopped();
      if (!current()) return { ok: false, message: 'Discovery was cancelled or the project changed. No configuration was changed.', toolCalls: result.toolCalls };
      if (result.ok) await fresh();
      return result;
    } catch (error) { await run?.cancel(); return { ok: false, message: error instanceof Error ? error.message : 'Discovery failed. Retry.', toolCalls: 0 }; }
    finally { if (agentRun?.run === run) agentRun = undefined; }
  });
  handle('workspace:save-configuration', async (root, configuration, diskVersion, documentVersions) => {
    try {
      const target = active();
      const current = () => workspace === target && !opening && !closing && !closePending;
      if (textArg(root, 4096) !== target.root || !current()) throw new Error('The active project changed. Reopen Project configuration.');
      if (JSON.stringify(configuration)?.length > 65536) throw new Error('Project configuration exceeds 64 KB.');
      await target.saveConfiguration(configuration, textArg(diskVersion, 128), documentVersions, current);
      if (current()) window.webContents.send('workspace:changed');
      return { ok: true };
    } catch (error) { return { ok: false, message: error instanceof Error ? error.message : String(error) }; }
  });
  handle('workspace:session', async (root, value) => {
    if (!workspace || textArg(root, 4096) !== workspace.root) return { ok: false, message: 'The active project changed before its tabs could be recorded.' };
    const session = parseWorkspaceSession(value);
    if (!session) return { ok: false, message: 'Workspace restoration supports at most 100 tabs with relative project paths.' };
    const result = await settings.saveWorkspaceSession(workspace.root, session);
    return { ok: !result.warning, message: result.warning };
  });
  handle('workspace:close-cancel', () => { closePending = false; });
  handle('workspace:close-ready', async () => {
    if (!closePending || dirty) { closePending = false; return false; }
    if (terminals.list().some(t => t.status !== 'exited')) {
      const answer = await dialog.showMessageBox(window, { type: 'question', title: 'Close terminal sessions?', message: 'Closing Specular will stop its terminal sessions and running commands.', buttons: ['Keep Specular open', 'Close Specular'], defaultId: 0, cancelId: 0, noLink: true });
      if (answer.response !== 1) { closePending = false; return false; }
    }
    await settings.flush();
    await codexAccess.disconnect();
    await conversation.flush();
    await terminals.shutdown();
    for (const check of agentChecks.values()) check.controller.abort();
    await Promise.all([...agentChecks.values()].map(check => check.pending));
    closing = true; window.close(); return true;
  });
  handle('plugin:choose', async () => {
    const selected = await dialog.showOpenDialog(window, { title: 'Install plugin folder', properties: ['openDirectory'] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return installPlugin(selected.filePaths[0]);
  });
  async function installPlugin(source: string) {
    let result = await pluginManager.install(source);
    if (!result.installed) {
      const current = pluginManager.list().find(item => item.manifest.id === result.manifest.id)!;
      const choice = await dialog.showMessageBox(window, { type: 'question', title: 'Replace installed plugin?',
        message: `Replace ${result.manifest.id}?`, detail: `Installed: ${current.manifest.version}\nSelected: ${result.manifest.version}\n\nThe existing package remains active if validation or replacement fails.`,
        buttons: ['Cancel', 'Replace'], defaultId: 0, cancelId: 0, noLink: true });
      if (choice.response !== 1) return null;
      stopPlugin(result.manifest.id); result = await pluginManager.install(source, true);
    }
    return result.manifest;
  }
  const stopPlugin = (id: string) => { pluginRuntimes.get(id)?.runtime.terminate(); pluginRuntimes.delete(id); };
  handle('plugin:install-archive', async () => {
    const selected = await dialog.showOpenDialog(window, { title: 'Install plugin archive', properties: ['openFile'], filters: [{ name: 'Plugin archives', extensions: ['zip'] }] });
    if (selected.canceled || !selected.filePaths[0]) return null;
    return installPlugin(selected.filePaths[0]);
  });
  handle('plugin:list', () => pluginManager.list());
  handle('plugin:restore-bundled', async id => {
    const key = textArg(id, 128); stopPlugin(key); await pluginManager.restoreBundled(key); return pluginManager.list();
  });
  handle('plugin:enable', async (id, enabled) => {
    const key = textArg(id, 128); if (typeof enabled !== 'boolean') throw new Error('Invalid plugin state.');
    stopPlugin(key); await pluginManager.setEnabled(key, enabled); return pluginManager.list();
  });
  handle('plugin:uninstall', async id => {
    const key = textArg(id, 128), item = pluginManager.list().find(entry => entry.manifest.id === key); if (!item) throw new Error('Unknown plugin.');
    const choice = await dialog.showMessageBox(window, { type: 'warning', title: 'Uninstall plugin?', message: `Uninstall ${key}?`,
      detail: 'This removes the installed plugin package. Project files and unsaved editor changes are not affected.', buttons: ['Cancel', 'Uninstall'], defaultId: 0, cancelId: 0, noLink: true });
    if (choice.response === 1) { stopPlugin(key); await pluginManager.uninstall(key); }
    return pluginManager.list();
  });
  handle('plugin:render', async (id, json) => {
    active();
    const plugin = pluginManager.package(textArg(id, 128));
    if (!plugin) throw new Error('Unknown plugin.');
    const request = parseRequest(json, plugin.manifest);
    if (plugin.manifest.views.find(view => view.id === request.viewId)?.kind === 'custom') throw new Error('Custom views require an isolated interface surface.');
    let entry = pluginRuntimes.get(plugin.manifest.id);
    if (entry && (entry.project !== request.context.projectId || entry.custom)) { entry.runtime.terminate(); pluginRuntimes.delete(plugin.manifest.id); entry = undefined; }
    if (!entry) {
      const runtime = new PluginRuntime(plugin.manifest, plugin.code, message => {
        if (!window.isDestroyed() && pluginRuntimes.get(plugin.manifest.id)?.runtime === runtime) window.webContents.send('plugin:failed', { id: plugin.manifest.id, message });
      });
      entry = { runtime, project: request.context.projectId, custom: false }; pluginRuntimes.set(plugin.manifest.id, entry);
    }
    return (entry.runtime as PluginRuntime).render(request);
  });
  handle('plugin:custom-render', async (id, json, rawBounds) => {
    active();
    const plugin = pluginManager.package(textArg(id, 128));
    if (!plugin) throw new Error('Unknown plugin.');
    const request = parseRequest(json, plugin.manifest);
    if (plugin.manifest.views.find(view => view.id === request.viewId)?.kind !== 'custom') throw new Error('This is not a custom plugin view.');
    const bounds = pluginBounds(rawBounds);
    let entry = pluginRuntimes.get(plugin.manifest.id);
    if (entry && (entry.project !== request.context.projectId || !entry.custom)) { entry.runtime.terminate(); pluginRuntimes.delete(plugin.manifest.id); entry = undefined; }
    if (!entry) {
      const runtime = new CustomPluginRuntime(window, plugin.manifest, plugin.code, message => {
        if (!window.isDestroyed() && pluginRuntimes.get(plugin.manifest.id)?.runtime === runtime) window.webContents.send('plugin:failed', { id: plugin.manifest.id, message });
      }, (sourceRequest, source) => {
        if (!window.isDestroyed() && pluginRuntimes.get(plugin.manifest.id)?.runtime === runtime) window.webContents.send('plugin:custom-navigate', { id: plugin.manifest.id, viewId: sourceRequest.viewId, requestId: sourceRequest.requestId, source });
      }, (stateRequest, state) => {
        if (!window.isDestroyed() && pluginRuntimes.get(plugin.manifest.id)?.runtime === runtime) window.webContents.send('plugin:custom-state', { id: plugin.manifest.id, viewId: stateRequest.viewId, requestId: stateRequest.requestId, state });
      });
      runtime.setObscured(customPluginsObscured);
      entry = { runtime, project: request.context.projectId, custom: true }; pluginRuntimes.set(plugin.manifest.id, entry);
    }
    await (entry.runtime as CustomPluginRuntime).render(request, bounds);
  });
  handle('plugin:custom-layout', (id, rawBounds) => {
    const entry = pluginRuntimes.get(textArg(id, 128));
    if (entry?.custom) (entry.runtime as CustomPluginRuntime).layout(pluginBounds(rawBounds));
  });
  handle('plugin:custom-obscured', obscured => {
    if (typeof obscured !== 'boolean') throw new Error('Invalid custom surface visibility.');
    customPluginsObscured = obscured;
    for (const entry of pluginRuntimes.values()) if (entry.custom) (entry.runtime as CustomPluginRuntime).setObscured(obscured);
  });
  handle('plugin:stop', id => {
    const key = textArg(id, 128); pluginRuntimes.get(key)?.runtime.dispose(); pluginRuntimes.delete(key);
  });
  window.webContents.on('destroyed', stopPlugins);
  window.on('closed', stopPlugins);
  handle('document:read' , file => active().read(textArg(file, 4096)));
  handle('document:create', async (name): Promise<CreateDocumentResult> => {
    const filename = textArg(name, 4096);
    try { return { ok: true, document: await active().createMarkdown(filename) }; }
    catch (error) { return { ok: false, message: error instanceof Error ? error.message : 'Could not create the Markdown file.' }; }
  });
  handle('document:save', (file, text, version, root) => {
    const project = active();
    if (textArg(root, 4096) !== project.root) throw new Error('The project changed before saving. Your edits are preserved.');
    return project.save(textArg(file, 4096), textArg(text), textArg(version, 128));
  });
  handle('document:link', (file, href) => active().resolveLink(textArg(file, 4096), textArg(href, 4096)));
  handle('brief:copy', value => {
    const text = textArg(value);
    if (!text.trim()) throw new Error('The brief is empty.');
    return clipboard.writeText(text);
  });
  ipcMain.on('workspace:dirty', (event, value) => { trust(event); if (typeof value === 'boolean') dirty = value; });
  await window.loadURL('specular://app/index.html');
  if (!closing && !closePending && !window.isDestroyed()) {
    const state = await codexAccess.startup(workspace?.root);
    if (!window.isDestroyed()) window.webContents.send('codex:state', state);
  }
}).catch(error => { console.error(error); app.quit(); });
app.on('window-all-closed', () => {
  watcher?.close(); clearTimeout(changedTimer);
  for (const check of agentChecks.values()) check.controller.abort();
  void Promise.all([codexAccess?.disconnect() ?? codex?.disconnect(), terminals?.shutdown(), ...[...agentChecks.values()].map(check => check.pending)]).finally(async () => { await conversation?.flush(); app.quit(); });
});
