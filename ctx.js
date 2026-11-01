// Kontext für die eigenständigen Module (stats.js, writing.js, record.js, flashread.js, spell.js): bekommen ihre Abhängigkeiten übergeben
// statt sie selbst zu importieren. Bei jedem Aufruf neu bauen, weil D und P erst nach loadData() gesetzt sind.
import { h, toast, api, log, shuffle, pick } from './util.js';
import { D, P, PARTNERS, letterBy, letterItem, translit, canSpell, gloss, glossText, trOf, trText, txt } from './data.js';
import { play, playBtn, canPlay } from './audio.js';
import { setKeyHandler } from './keyboard.js';
import { speakText } from './asr.js';
import { cardsFor } from './srs.js';
import { lettersCard, letterDetail } from './letters.js';
import { spellView } from './spell.js';

export const ctx = () => ({ D, P, h, toast, api, log, playBtn, cardsFor,
  play, canPlay, shuffle, pick, setKeyHandler, PARTNERS, letterBy, letterItem, translit, speakText, lettersCard, letterDetail, canSpell, spellView,
  gloss, glossText, trOf, trText, txt });   // + flashread.js, stats.js, spell.js
