'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('positionPicker', {
  choose: (anchor) => ipcRenderer.send('position-picker-choose', anchor),
});
