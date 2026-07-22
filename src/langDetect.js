'use strict';

// Detects whether lyrics text contains Japanese script, gating the "show
// romaji" feature (see geminiRomaji.js). Checks for hiragana/katakana
// specifically rather than any CJK ideograph — kanji alone is ambiguous with
// Chinese, but hiragana/katakana are unique to Japanese, and virtually every
// real Japanese song mixes them in (particles, conjugations, loanwords) even
// when otherwise kanji-heavy, so this stays reliable without needing a real
// language-detection library for what's ultimately a cheap, offline check.
const HIRAGANA_KATAKANA = new RegExp('[\\u3040-\\u30ff]');

function isJapaneseText(text) {
  return typeof text === 'string' && HIRAGANA_KATAKANA.test(text);
}

// Accepts a lyrics object shaped like { timed, static }; true if any line
// (or the static block) contains Japanese script.
function lyricsAreJapanese(lyrics) {
  if (!lyrics) return false;
  if (Array.isArray(lyrics.timed) && lyrics.timed.some((l) => isJapaneseText(l?.text))) return true;
  if (isJapaneseText(lyrics.static)) return true;
  return false;
}

module.exports = { isJapaneseText, lyricsAreJapanese };
