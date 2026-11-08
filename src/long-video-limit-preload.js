'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('longVideoLimitWindow', {
  get: () => ipcRenderer.invoke('long-video-limit-get'),
  save: (enabled, minutes) => ipcRenderer.send('long-video-limit-save', { enabled, minutes }),
  close: () => ipcRenderer.send('long-video-limit-close'),
});
