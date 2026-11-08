'use strict';

const enabledInput = document.getElementById('enabled-input');
const minutesInput = document.getElementById('minutes-input');
const minutesLabel = document.getElementById('minutes-label');
const statusEl = document.getElementById('status');
const saveBtn = document.getElementById('save-btn');
const cancelBtn = document.getElementById('cancel-btn');

let bounds = { min: 1, max: 600 };

function syncDisabled() {
  minutesInput.disabled = !enabledInput.checked;
  minutesLabel.classList.toggle('disabled', !enabledInput.checked);
}

function showError(message) {
  statusEl.textContent = message;
  statusEl.classList.add('error');
}

window.longVideoLimitWindow.get().then(({ enabled, minutes, min, max }) => {
  bounds = { min, max };
  enabledInput.checked = !!enabled;
  minutesInput.min = String(min);
  minutesInput.max = String(max);
  minutesInput.value = String(minutes);
  syncDisabled();
  if (enabled) {
    minutesInput.focus();
    minutesInput.select();
  }
});

function submit() {
  const n = Number(minutesInput.value);
  // The number only matters while the limit is on — turning it off with a
  // half-typed value shouldn't be blocked by validation.
  if (enabledInput.checked && (!Number.isInteger(n) || n < bounds.min || n > bounds.max)) {
    showError(`Enter a whole number of minutes between ${bounds.min} and ${bounds.max}.`);
    minutesInput.focus();
    return;
  }
  const minutes = Number.isInteger(n) && n >= bounds.min && n <= bounds.max ? n : null;
  window.longVideoLimitWindow.save(enabledInput.checked, minutes);
}

enabledInput.addEventListener('change', syncDisabled);
minutesInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submit();
});
saveBtn.addEventListener('click', submit);
cancelBtn.addEventListener('click', () => window.longVideoLimitWindow.close());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.longVideoLimitWindow.close();
});
