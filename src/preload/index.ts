import { contextBridge, ipcRenderer } from 'electron';
import type { SpecularBridge } from '../shared/types';

const bridge: SpecularBridge = {
  runAgentDiscovery: request => ipcRenderer.invoke('agent-discovery:run', request),
  cancelAgentDiscovery: requestId => ipcRenderer.invoke('agent-discovery:cancel', requestId),
  onAgentDiscoveryProgress: callback => { const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value); ipcRenderer.on('agent-discovery:progress', listener); return () => ipcRenderer.removeListener('agent-discovery:progress', listener); },
  onPluginFailure: callback => { const listener = (_event: Electron.IpcRendererEvent, value: { id: string; message: string }) => callback(value); ipcRenderer.on('plugin:failed', listener); return () => ipcRenderer.removeListener('plugin:failed', listener); },
  onCustomPluginNavigate: callback => { const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value); ipcRenderer.on('plugin:custom-navigate', listener); return () => ipcRenderer.removeListener('plugin:custom-navigate', listener); },
  choosePlugin: () => ipcRenderer.invoke('plugin:choose'),
  pluginList: () => ipcRenderer.invoke('plugin:list'),
  installPluginArchive: () => ipcRenderer.invoke('plugin:install-archive'),
  setPluginEnabled: (id, enabled) => ipcRenderer.invoke('plugin:enable', id, enabled),
  uninstallPlugin: id => ipcRenderer.invoke('plugin:uninstall', id),
  restoreBundledPlugin: id => ipcRenderer.invoke('plugin:restore-bundled', id),
  onCustomPluginState: callback => { const listener = (_event: Electron.IpcRendererEvent, value: Parameters<typeof callback>[0]) => callback(value); ipcRenderer.on('plugin:custom-state', listener); return () => ipcRenderer.removeListener('plugin:custom-state', listener); },
  renderPlugin: (id, request) => ipcRenderer.invoke('plugin:render', id, request),
  renderCustomPlugin: (id, request, bounds) => ipcRenderer.invoke('plugin:custom-render', id, request, bounds),
  layoutCustomPlugin: (id, bounds) => ipcRenderer.invoke('plugin:custom-layout', id, bounds),
  stopPlugin: id => ipcRenderer.invoke('plugin:stop', id),
  terminalOpen: (kind, executable) => ipcRenderer.invoke('terminal:open', kind, executable),
  terminalAttach: id => ipcRenderer.send('terminal:attach', id),
  terminalInput: (id, data) => ipcRenderer.send('terminal:input', id, data),
  insertTerminalBrief: (id, root, text) => ipcRenderer.invoke('terminal:insert-brief', id, root, text),
  terminalResize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  terminalAcknowledge: (id, length) => ipcRenderer.send('terminal:ack', id, length),
  terminalClose: id => ipcRenderer.invoke('terminal:close', id),
  onTerminalEvent: callback => { const listener = (_: Electron.IpcRendererEvent, event: Parameters<typeof callback>[0]) => callback(event); ipcRenderer.on('terminal:event', listener); return () => ipcRenderer.removeListener('terminal:event', listener); },
  conversationState: () => ipcRenderer.invoke('codex:conversation'),
  resumeCodexConversation: () => ipcRenderer.invoke('codex:resume'),
  freshCodexConversation: () => ipcRenderer.invoke('codex:fresh'),
  selectCodexModel: model => ipcRenderer.invoke('codex:select-model', model),
  codexModels: () => ipcRenderer.invoke('codex:models'),
  sendCodexMessage: (text, model) => ipcRenderer.invoke('codex:send', text, model),
  sendCodexBrief: (root, text, model) => ipcRenderer.invoke('codex:send-brief', root, text, model),
  stopCodexTurn: () => ipcRenderer.invoke('codex:stop'),
  useOpenProjectForCodex: () => ipcRenderer.invoke('codex:use-project'),
  onConversationState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('codex:conversation-state', listener);
    return () => ipcRenderer.removeListener('codex:conversation-state', listener);
  },
  codexStatus: () => ipcRenderer.invoke('codex:status'),
  connectCodex: (path, apiKey, remember, autoConnect) => ipcRenderer.invoke('codex:connect', path, apiKey, remember, autoConnect),
  codexCredentials: () => ipcRenderer.invoke('codex:credentials'),
  forgetCodexKey: () => ipcRenderer.invoke('codex:forget-key'),
  disconnectCodex: () => ipcRenderer.invoke('codex:disconnect'),
  onCodexState: callback => {
    const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state);
    ipcRenderer.on('codex:state', listener);
    return () => ipcRenderer.removeListener('codex:state', listener);
  },
  checkAgent: (agent, path) => ipcRenderer.invoke('agent:check', agent, path),
  chooseAgentPath: () => ipcRenderer.invoke('agent:choose-path'),
  initialWorkspace: () => ipcRenderer.invoke('workspace:initial'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openDemo: () => ipcRenderer.invoke('workspace:demo'),
  recentProjects: () => ipcRenderer.invoke('recent:list'),
  theme: () => ipcRenderer.invoke('appearance:theme'),
  saveTheme: mode => ipcRenderer.invoke('appearance:save-theme', mode),
  appearanceReady: () => ipcRenderer.invoke('appearance:ready'),
  setCustomPluginsObscured: obscured => ipcRenderer.invoke('plugin:custom-obscured', obscured),
  fontSizes: () => ipcRenderer.invoke('appearance:font-sizes'),
  saveFontSizes: sizes => ipcRenderer.invoke('appearance:save-font-sizes', sizes),
  openRecent: path => ipcRenderer.invoke('recent:open', path),
  removeRecent: path => ipcRenderer.invoke('recent:remove', path),
  clearRecent: () => ipcRenderer.invoke('recent:clear'),
  refreshWorkspace: () => ipcRenderer.invoke('workspace:refresh'),
  saveProjectConfiguration: (root, configuration, diskVersion, documentVersions) => ipcRenderer.invoke('workspace:save-configuration', root, configuration, diskVersion, documentVersions),
  saveWorkspaceSession: (root, session) => ipcRenderer.invoke('workspace:session', root, session),
  finishClose: () => ipcRenderer.invoke('workspace:close-ready'),
  cancelClose: () => ipcRenderer.invoke('workspace:close-cancel'),
  readDocument: path => ipcRenderer.invoke('document:read', path),
  createMarkdown: name => ipcRenderer.invoke('document:create', name),
  saveDocument: (path, text, version, project) => ipcRenderer.invoke('document:save', path, text, version, project),
  resolveLink: (from, href) => ipcRenderer.invoke('document:link', from, href),
  copyBrief: text => ipcRenderer.invoke('brief:copy', text),
  setDirty: dirty => ipcRenderer.send('workspace:dirty', dirty),
  onWorkspaceChanged: callback => {
    const listener = () => callback();
    ipcRenderer.on('workspace:changed', listener);
    return () => ipcRenderer.removeListener('workspace:changed', listener);
  },
  onAction: callback => {
    const listener = (_event: Electron.IpcRendererEvent, action: string) => callback(action);
    ipcRenderer.on('app:action', listener);
    return () => ipcRenderer.removeListener('app:action', listener);
  },
};
contextBridge.exposeInMainWorld('specular', bridge);
