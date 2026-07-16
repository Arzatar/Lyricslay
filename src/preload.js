'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('overlay', {
  getInitState: () => ipcRenderer.invoke('get-init-state'),
  setDesiredHeight: (px) => ipcRenderer.send('set-desired-height', px),
  setLyricsColor: (hex) => ipcRenderer.send('set-lyrics-color', hex),
  setInteractive: (interactive) => ipcRenderer.send('set-interactive', interactive),
  setPickerOpen: (open) => ipcRenderer.send('set-picker-open', open),

  onNowPlaying: (cb) => ipcRenderer.on('now-playing', (_e, data) => cb(data)),
  onLyricsLoading: (cb) => ipcRenderer.on('lyrics-loading', (_e, data) => cb(data)),
  onLyricsResult: (cb) => ipcRenderer.on('lyrics-result', (_e, data) => cb(data)),
  onFontSizeChanged: (cb) => ipcRenderer.on('font-size-changed', (_e, size) => cb(size)),
  onOpacityChanged: (cb) => ipcRenderer.on('opacity-changed', (_e, op) => cb(op)),
  onLockedChanged: (cb) => ipcRenderer.on('locked-changed', (_e, locked) => cb(locked)),
  onVisibleLinesChanged: (cb) => ipcRenderer.on('visible-lines-changed', (_e, count) => cb(count)),
  onColorSwatchVisibleChanged: (cb) => ipcRenderer.on('color-swatch-visible-changed', (_e, visible) => cb(visible)),
  onOffsetChanged: (cb) => ipcRenderer.on('offset-changed', (_e, offsetMs) => cb(offsetMs)),
});
