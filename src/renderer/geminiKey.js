'use strict';

const keyInput = document.getElementById('key-input');
const statusEl = document.getElementById('status');
const getKeyLink = document.getElementById('get-key-link');
const saveBtn = document.getElementById('save-btn');
const clearBtn = document.getElementById('clear-btn');
const closeBtn = document.getElementById('close-btn');

function render(configured) {
  statusEl.textContent = configured
    ? 'A key is currently saved (encrypted on disk).'
    : 'No key saved — the AI fallback step is skipped entirely until you add one.';
  clearBtn.disabled = !configured;
}

window.geminiKeyWindow.getStatus().then(({ configured }) => render(configured));

getKeyLink.addEventListener('click', (e) => {
  e.preventDefault();
  window.geminiKeyWindow.openKeyPage();
});

saveBtn.addEventListener('click', async () => {
  const key = keyInput.value.trim();
  if (!key) return;
  await window.geminiKeyWindow.save(key);
  keyInput.value = '';
  render(true);
});

clearBtn.addEventListener('click', async () => {
  await window.geminiKeyWindow.clear();
  render(false);
});

closeBtn.addEventListener('click', () => {
  window.geminiKeyWindow.close();
});
