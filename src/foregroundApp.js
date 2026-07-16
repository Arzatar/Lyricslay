'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const readline = require('readline');

// Wraps foregroundApp.ps1, which streams the foreground window's owning
// process name as one JSON line per tick. Emits 'change' only when that name
// actually differs from the last tick — main.js uses this to know which app
// the overlay is currently sitting on top of, to remember/restore a
// per-app position.
class ForegroundAppWatcher extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.restartTimer = null;
    this.stopped = false;
    this.lastProcessName = undefined;
  }

  start() {
    this.stopped = false;
    this._spawn();
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  _spawn() {
    // See nowplaying.js for why this has to point at the asar-unpacked copy
    // in a packaged build — powershell.exe can't read a path inside app.asar.
    const scriptPath = path.join(__dirname, 'foregroundApp.ps1').replace('app.asar', 'app.asar.unpacked');
    this.proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-STA', '-File', scriptPath],
      { windowsHide: true }
    );

    const rl = readline.createInterface({ input: this.proc.stdout });
    rl.on('line', (line) => {
      line = line.trim();
      if (!line) return;
      try {
        const data = JSON.parse(line);
        if (data.processName === this.lastProcessName) return;
        this.lastProcessName = data.processName;
        this.emit('change', data.processName);
      } catch {
        // ignore malformed/partial lines
      }
    });

    this.proc.stderr.on('data', () => {
      // swallow PowerShell diagnostic noise; failures surface via 'exit' + restart
    });

    this.proc.on('exit', () => {
      this.proc = null;
      if (!this.stopped) {
        this.emit('error', new Error('foregroundApp.ps1 exited, restarting'));
        this.restartTimer = setTimeout(() => this._spawn(), 2000);
      }
    });
  }
}

module.exports = { ForegroundAppWatcher };
