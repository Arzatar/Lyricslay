'use strict';

const titleInput = document.getElementById('title-input');
const artistInput = document.getElementById('artist-input');
const statusEl = document.getElementById('status');
const searchBtn = document.getElementById('search-btn');
const cancelBtn = document.getElementById('cancel-btn');

function focusAndSelect(input) {
  input.focus();
  input.select();
}

function showError(message) {
  statusEl.textContent = message;
  statusEl.classList.add('error');
}

// Prefilled with whatever's currently detected — usually only one of the two
// fields is actually wrong (e.g. a re-upload's channel name as "artist"), so
// most of the time this is a one-field edit, not retyping both from scratch.
window.manualSearchWindow.getPrefill().then(({ title, artist }) => {
  titleInput.value = title || '';
  artistInput.value = artist || '';
  focusAndSelect(titleInput);
});

function submit() {
  const title = titleInput.value.trim();
  if (!title) {
    showError('Enter at least a song title.');
    titleInput.focus();
    return;
  }
  window.manualSearchWindow.search(title, artistInput.value.trim());
}

// Type, Enter, type, Enter — no mouse/clicking required. Enter in the title
// field advances to the artist field (already selected, so overwriting it is
// a single keystroke) instead of submitting immediately, since the artist is
// so often the field that's actually wrong.
titleInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (!titleInput.value.trim()) {
    showError('Enter at least a song title.');
    return;
  }
  focusAndSelect(artistInput);
});

artistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});

searchBtn.addEventListener('click', submit);
cancelBtn.addEventListener('click', () => window.manualSearchWindow.close());
