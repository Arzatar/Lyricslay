'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ownLyricsWindow', {
  getPrefill: () => ipcRenderer.invoke('own-lyrics-get-prefill'),
  save: (text, title, artist) => ipcRenderer.invoke('own-lyrics-save', { text, title, artist }),
  close: () => ipcRenderer.send('own-lyrics-close'),
});
