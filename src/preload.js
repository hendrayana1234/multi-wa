// Jembatan aman antara sidebar (index.html) dan proses utama.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('multiwa', {
  getState: () => ipcRenderer.invoke('state:get'),
  add: (name) => ipcRenderer.invoke('account:add', name),
  activate: (id) => ipcRenderer.invoke('account:activate', id),
  rename: (id, name) => ipcRenderer.invoke('account:rename', id, name),
  menu: (id) => ipcRenderer.invoke('account:menu', id),
  overlay: (open) => ipcRenderer.invoke('overlay', open),
  setBadge: (dataUrl, count) => ipcRenderer.send('badge', dataUrl, count),
  peek: (on) => ipcRenderer.send('sidebar:peek', on),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onOpenAdd: (cb) => ipcRenderer.on('open-add', () => cb()),
});
