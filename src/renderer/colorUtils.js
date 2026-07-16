'use strict';

// Converts a "#rrggbb" (or shorthand "#rgb") hex color into a "r, g, b" string —
// the format CSS custom properties need to plug into `rgba(var(--x), alpha)`,
// which is how the lyrics color stays reusable across every alpha level
// (active/near/default/paused) from a single picked color.
function hexToRgbString(hex) {
  if (typeof hex !== 'string') return '255, 255, 255';

  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '255, 255, 255';

  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}

const colorUtilsApi = { hexToRgbString };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = colorUtilsApi;
}
if (typeof window !== 'undefined') {
  window.colorUtils = colorUtilsApi;
}
