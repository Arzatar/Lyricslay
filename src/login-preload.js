'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('loginWindow', {
  reopenBrowser: () => ipcRenderer.send('login-reopen-browser'),
  close: () => ipcRenderer.send('login-close'),
  onCode: (cb) => ipcRenderer.on('login-code', (_e, data) => cb(data)),
  onStatus: (cb) => ipcRenderer.on('login-status', (_e, data) => cb(data)),
});
