'use strict';

const codeEl = document.getElementById('code');
const statusEl = document.getElementById('status');
const reopenBtn = document.getElementById('reopen-btn');
const closeBtn = document.getElementById('close-btn');

reopenBtn.addEventListener('click', () => window.loginWindow.reopenBrowser());
closeBtn.addEventListener('click', () => window.loginWindow.close());

window.loginWindow.onCode(({ userCode }) => {
  codeEl.textContent = userCode;
  statusEl.textContent = 'Waiting for you to confirm in the browser…';
});

window.loginWindow.onStatus(({ state, message }) => {
  statusEl.textContent = message;
  statusEl.className = 'status ' + (state === 'success' ? 'success' : state === 'error' ? 'error' : '');
});
