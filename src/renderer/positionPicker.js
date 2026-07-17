'use strict';

document.querySelectorAll('.cell').forEach((cell) => {
  cell.addEventListener('click', () => {
    window.positionPicker.choose(cell.dataset.anchor);
  });
});
