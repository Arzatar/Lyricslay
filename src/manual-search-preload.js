'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('manualSearchWindow', {
  getPrefill: () => ipcRenderer.invoke('manual-search-get-prefill'),
  search: (title, artist) => ipcRenderer.send('manual-search-submit', { title, artist }),
  close: () => ipcRenderer.send('manual-search-close'),
});
