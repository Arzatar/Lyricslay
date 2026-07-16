'use strict';

// Pure keydown-event -> Electron accelerator string conversion, shared by
// shortcuts.js (via a plain <script> tag, hence the dual export below, same
// pattern as lyricsSync.js/colorUtils.js) and its tests.

// Modifier keys alone aren't a usable shortcut yet — held on their own, they
// should leave the recorder waiting rather than producing a bare "Control" or
// "Alt" accelerator.
const MODIFIER_CODES = new Set([
  'ControlLeft', 'ControlRight',
  'AltLeft', 'AltRight',
  'ShiftLeft', 'ShiftRight',
  'MetaLeft', 'MetaRight',
]);

// Keyed by KeyboardEvent.code (not .key) so this doesn't depend on keyboard
// layout or on which symbol Shift produces — Comma stays "Comma" whether or
// not Shift is held, unlike .key which would flip to "<".
const CODE_TO_ACCELERATOR_KEY = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Home: 'Home',
  End: 'End',
  Insert: 'Insert',
  Delete: 'Delete',
  Backspace: 'Backspace',
  Space: 'Space',
  Tab: 'Tab',
  Escape: 'Esc',
  Enter: 'Enter',
  Comma: ',',
  Period: '.',
};
for (let i = 0; i <= 9; i++) CODE_TO_ACCELERATOR_KEY[`Digit${i}`] = String(i);
for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') CODE_TO_ACCELERATOR_KEY[`Key${letter}`] = letter;
for (let i = 1; i <= 12; i++) CODE_TO_ACCELERATOR_KEY[`F${i}`] = `F${i}`;

// Takes a plain object with the KeyboardEvent fields that matter here (rather
// than a real KeyboardEvent) so this stays pure and testable under Node with
// no DOM. Returns an Electron accelerator string (e.g. "Control+Alt+Up"), or
// null if `event.code` is itself a modifier key or isn't a key this recorder
// supports — either way, the caller should keep waiting for the next keydown.
function keyEventToAccelerator(event) {
  if (!event || MODIFIER_CODES.has(event.code)) return null;
  const mainKey = CODE_TO_ACCELERATOR_KEY[event.code];
  if (!mainKey) return null;

  const parts = [];
  if (event.ctrlKey) parts.push('Control');
  if (event.altKey) parts.push('Alt');
  if (event.shiftKey) parts.push('Shift');
  if (event.metaKey) parts.push('Super');
  parts.push(mainKey);
  return parts.join('+');
}

const shortcutUtilsApi = { keyEventToAccelerator };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = shortcutUtilsApi;
}
if (typeof window !== 'undefined') {
  window.shortcutUtils = shortcutUtilsApi;
}
