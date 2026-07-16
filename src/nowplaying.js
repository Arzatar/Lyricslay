'use strict';

const { spawn } = require('child_process');
const path = require('path');
const { EventEmitter } = require('events');
const readline = require('readline');

// Wraps nowplaying.ps1, which streams Windows SMTC "now playing" info (title/artist/
// position/status) as JSON lines. Emits 'track' on every tick and 'error' if the
// PowerShell bridge dies (it's auto-restarted).
class NowPlayingWatcher extends EventEmitter {
  constructor() {
    super();
    this.proc = null;
    this.restartTimer = null;
    this.stopped = false;
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
    // powershell.exe is a separate OS process that can't read into an .asar
    // archive, so in a packaged build this has to point at the unpacked copy
    // (see the "asarUnpack" entry in package.json's build config) rather than
    // the path __dirname naturally gives, which sits inside app.asar. In dev,
    // __dirname never contains "app.asar" so this replace is a no-op.
    const scriptPath = path.join(__dirname, 'nowplaying.ps1').replace('app.asar', 'app.asar.unpacked');
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
        this.emit('track', data);
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
        this.emit('error', new Error('nowplaying.ps1 exited, restarting'));
        this.restartTimer = setTimeout(() => this._spawn(), 2000);
      }
    });
  }
}

module.exports = { NowPlayingWatcher };
