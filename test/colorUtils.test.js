'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { hexToRgbString } = require('../src/renderer/colorUtils');

test('hexToRgbString converts a 6-digit hex color to an "r, g, b" string', () => {
  assert.equal(hexToRgbString('#ff8800'), '255, 136, 0');
  assert.equal(hexToRgbString('#000000'), '0, 0, 0');
  assert.equal(hexToRgbString('#ffffff'), '255, 255, 255');
});

test('hexToRgbString works without a leading #', () => {
  assert.equal(hexToRgbString('ff8800'), '255, 136, 0');
});

test('hexToRgbString expands 3-digit shorthand hex', () => {
  assert.equal(hexToRgbString('#f80'), '255, 136, 0');
});

test('hexToRgbString falls back to white for invalid input', () => {
  assert.equal(hexToRgbString('not-a-color'), '255, 255, 255');
  assert.equal(hexToRgbString(''), '255, 255, 255');
  assert.equal(hexToRgbString(null), '255, 255, 255');
  assert.equal(hexToRgbString(undefined), '255, 255, 255');
});

test('hexToRgbString is case-insensitive', () => {
  assert.equal(hexToRgbString('#FF8800'), '255, 136, 0');
});
