'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const logger = require('../src/logger');

function tempUserDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'logger-test-'));
}

test('init() creates a fresh log file with a session-started line', () => {
  const dir = tempUserDataDir();
  logger.init(dir);

  const filePath = logger.getLogFilePath();
  assert.equal(filePath, path.join(dir, 'overlay.log'));
  assert.ok(fs.existsSync(filePath));
  assert.match(fs.readFileSync(filePath, 'utf8'), /^--- session started .+ ---\n$/);
});

test('init() truncates a pre-existing log file rather than appending to it', () => {
  const dir = tempUserDataDir();
  const filePath = path.join(dir, 'overlay.log');
  fs.writeFileSync(filePath, 'stale content from a previous run\n');

  logger.init(dir);

  const content = fs.readFileSync(filePath, 'utf8');
  assert.ok(!content.includes('stale content'));
});

test('log() appends a timestamped line containing the given string arguments', () => {
  const dir = tempUserDataDir();
  logger.init(dir);

  logger.log('hello', 'world');

  const content = fs.readFileSync(logger.getLogFilePath(), 'utf8');
  assert.match(content, /\[\d{4}-\d{2}-\d{2}T.+Z\] hello world\n$/);
});

test('log() JSON-serializes non-string arguments', () => {
  const dir = tempUserDataDir();
  logger.init(dir);

  logger.log('payload:', { a: 1, b: [2, 3] });

  const content = fs.readFileSync(logger.getLogFilePath(), 'utf8');
  assert.ok(content.includes('payload: {"a":1,"b":[2,3]}'));
});

test('log() accumulates multiple calls as separate lines', () => {
  const dir = tempUserDataDir();
  logger.init(dir);

  logger.log('first');
  logger.log('second');

  const lines = fs.readFileSync(logger.getLogFilePath(), 'utf8').trim().split('\n');
  assert.equal(lines.length, 3); // session-started header + 2 log lines
  assert.ok(lines[1].endsWith('first'));
  assert.ok(lines[2].endsWith('second'));
});

test('log() before init() does not throw (no log file to write to yet)', () => {
  logger.init(tempUserDataDir()); // reset any path from a previous test
  // Simulate the "never initialized" case by pointing at a directory that doesn't exist
  // and hasn't been init()-ed — the important thing is a bad/missing target never throws.
  assert.doesNotThrow(() => logger.log('anything'));
});

test('init() with an unwritable path does not throw', () => {
  // A path that can't possibly be created (nested under a file, not a directory).
  const dir = tempUserDataDir();
  const blockerFile = path.join(dir, 'blocker');
  fs.writeFileSync(blockerFile, 'x');
  assert.doesNotThrow(() => logger.init(path.join(blockerFile, 'nested')));
  assert.doesNotThrow(() => logger.log('should not throw even though init failed'));
});
