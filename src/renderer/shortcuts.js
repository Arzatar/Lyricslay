'use strict';

const listEl = document.getElementById('list');
const resetBtn = document.getElementById('reset-btn');
const closeBtn = document.getElementById('close-btn');

let defs = [];
let current = {};
// id of the shortcut currently waiting for a keypress, or null when nothing is
// being recorded. Only one row can record at a time.
let recordingId = null;

function formatAccelerator(accelerator) {
  return accelerator ? accelerator.replace(/Control/g, 'Ctrl') : 'Unassigned';
}

function render() {
  listEl.innerHTML = '';
  for (const def of defs) {
    const recording = recordingId === def.id;

    const row = document.createElement('div');
    row.className = 'row' + (recording ? ' recording' : '');

    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = def.label;

    const key = document.createElement('span');
    key.className = 'key';
    key.textContent = recording ? 'Press a key combination…' : formatAccelerator(current[def.id]);

    const changeBtn = document.createElement('button');
    changeBtn.textContent = recording ? 'Cancel' : 'Change';
    changeBtn.addEventListener('click', () => {
      recordingId = recording ? null : def.id;
      render();
    });

    row.append(label, key, changeBtn);
    listEl.appendChild(row);
  }
}

// Captured globally (not per-row) since only one row can ever be recording —
// preventDefault() on every keydown while recording stops things like Tab
// shifting focus or Enter clicking whatever button happens to be focused.
document.addEventListener('keydown', async (e) => {
  if (!recordingId) return;
  e.preventDefault();

  if (e.key === 'Escape') {
    recordingId = null;
    render();
    return;
  }

  const accelerator = window.shortcutUtils.keyEventToAccelerator(e);
  if (!accelerator) return; // only modifier keys held so far — keep waiting

  const id = recordingId;
  recordingId = null;
  const result = await window.shortcutsWindow.setShortcut(id, accelerator);
  if (result.ok) {
    current[id] = result.accelerator;
  } else {
    alert(result.error || 'Could not set that shortcut.');
  }
  render();
});

resetBtn.addEventListener('click', async () => {
  current = await window.shortcutsWindow.resetShortcuts();
  recordingId = null;
  render();
});

closeBtn.addEventListener('click', () => window.shortcutsWindow.close());

window.shortcutsWindow.getShortcuts().then(({ defs: loadedDefs, current: loadedCurrent }) => {
  defs = loadedDefs;
  current = loadedCurrent;
  render();
});
