'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('shortcutsWindow', {
  getShortcuts: () => ipcRenderer.invoke('get-shortcuts'),
  setShortcut: (id, accelerator) => ipcRenderer.invoke('set-shortcut', { id, accelerator }),
  resetShortcuts: () => ipcRenderer.invoke('reset-shortcuts'),
  close: () => ipcRenderer.send('shortcuts-close'),
});
