import { contextBridge, ipcRenderer } from 'electron';
// This preload belongs only to the trusted, hidden worker supervisor, never the plugin worker.
contextBridge.exposeInMainWorld('supervisor', {
  receive: (callback: (message: unknown) => void) => ipcRenderer.on('plugin:command', (_event, message) => callback(message)),
  send: (message: unknown) => ipcRenderer.send('plugin:response', message),
});
