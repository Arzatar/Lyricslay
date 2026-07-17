'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('geminiKeyWindow', {
  getStatus: () => ipcRenderer.invoke('gemini-key-status'),
  save: (key) => ipcRenderer.invoke('gemini-key-save', key),
  clear: () => ipcRenderer.invoke('gemini-key-clear'),
  openKeyPage: () => ipcRenderer.send('gemini-key-open-page'),
  close: () => ipcRenderer.send('gemini-key-close'),
});
