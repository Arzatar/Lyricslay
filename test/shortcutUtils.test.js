'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { keyEventToAccelerator } = require('../src/renderer/shortcutUtils');

test('keyEventToAccelerator builds a Control+Alt+<key> accelerator', () => {
  const accelerator = keyEventToAccelerator({ ctrlKey: true, altKey: true, code: 'KeyL' });
  assert.equal(accelerator, 'Control+Alt+L');
});

test('keyEventToAccelerator handles arrow/page keys', () => {
  assert.equal(keyEventToAccelerator({ ctrlKey: true, altKey: true, code: 'ArrowRight' }), 'Control+Alt+Right');
  assert.equal(keyEventToAccelerator({ ctrlKey: true, altKey: true, code: 'PageUp' }), 'Control+Alt+PageUp');
});

test('keyEventToAccelerator handles comma/period regardless of shift-shifted symbol', () => {
  assert.equal(keyEventToAccelerator({ ctrlKey: true, altKey: true, code: 'Comma' }), 'Control+Alt+,');
  assert.equal(keyEventToAccelerator({ ctrlKey: true, altKey: true, shiftKey: true, code: 'Period' }), 'Control+Alt+Shift+.');
});

test('keyEventToAccelerator returns null while only modifier keys are held', () => {
  assert.equal(keyEventToAccelerator({ ctrlKey: true, code: 'ControlLeft' }), null);
  assert.equal(keyEventToAccelerator({ altKey: true, code: 'AltRight' }), null);
});

test('keyEventToAccelerator returns null for an unsupported key', () => {
  assert.equal(keyEventToAccelerator({ ctrlKey: true, code: 'Unidentified' }), null);
});

test('keyEventToAccelerator works with no modifiers held (a bare function key)', () => {
  assert.equal(keyEventToAccelerator({ code: 'F5' }), 'F5');
});

test('keyEventToAccelerator returns null for a missing event', () => {
  assert.equal(keyEventToAccelerator(null), null);
  assert.equal(keyEventToAccelerator(undefined), null);
});
