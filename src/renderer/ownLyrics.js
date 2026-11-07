'use strict';

const input = document.getElementById('lyrics-input');
const statusEl = document.getElementById('status');
const trackLabel = document.getElementById('track-label');
const titleInput = document.getElementById('title-input');
const artistInput = document.getElementById('artist-input');
const fileInput = document.getElementById('file-input');
const saveBtn = document.getElementById('save-btn');
const cancelBtn = document.getElementById('cancel-btn');

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

// Prefilled with the song's current lyrics (as LRC when they're timed), so
// fixing a few lines or timestamps is an edit rather than a rewrite. The
// title/artist fields hold what the overlay shows: the detected values, or
// whatever was typed here before. Leaving them as detected (or blank) means
// "show what Windows reports".
window.ownLyricsWindow.getPrefill().then(({ detectedTitle, detectedArtist, title, artist, text }) => {
  trackLabel.textContent = `${detectedTitle || ''}${detectedArtist ? ` — ${detectedArtist}` : ''}`;
  titleInput.value = title || '';
  artistInput.value = artist || '';
  input.value = text || '';
  setStatus(text ? 'Showing the lyrics this song currently has.' : 'This song has no lyrics yet.');
  input.focus();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    input.value = String(reader.result || '');
    setStatus(`Loaded ${file.name} — review it, then Save.`);
  };
  reader.onerror = () => setStatus(`Couldn't read ${file.name}.`, true);
  reader.readAsText(file, 'utf-8');
  fileInput.value = '';
});

async function save() {
  if (!input.value.trim()) {
    setStatus('Paste or type some lyrics first.', true);
    return;
  }
  saveBtn.disabled = true;
  const result = await window.ownLyricsWindow.save(input.value, titleInput.value, artistInput.value);
  saveBtn.disabled = false;
  if (!result?.ok) setStatus(result?.error || "Couldn't save these lyrics.", true);
  // On success main.js closes the window.
}

// Ctrl+Enter saves from anywhere — plain Enter has to stay a newline in the
// textarea; in the title/artist fields it just moves on to the next field.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault();
    save();
  } else if (e.key === 'Escape') {
    window.ownLyricsWindow.close();
  }
});
titleInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.ctrlKey) artistInput.focus();
});
artistInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.ctrlKey) input.focus();
});
saveBtn.addEventListener('click', save);
cancelBtn.addEventListener('click', () => window.ownLyricsWindow.close());
