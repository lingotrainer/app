// Bildschirmtastatur im Layout „Georgian (QWERTY)“, nur georgische Zeichen (keine lateinischen Tastenbeschriftungen – Nutzerwunsch, lenkt vom Lesen ab); Sprachen in Lateinschrift: alle Buchstaben im Layout aus lang.json keyboard (qwertz|qwerty)
import { h } from './util.js';
import { t } from './i18n.js';
import { D, LANG } from './data.js';

// Physische Tastatur → aktive Übung (der Router setzt bei jedem Seitenwechsel zurück)
let keyHandler = null;
document.addEventListener('keydown', e => keyHandler?.(e));
export const setKeyHandler = fn => { keyHandler = fn; };
// Tasten einer Übung ohne Bildschirmtastatur (Enter/Leertaste = Weiter, Ziffern = Antwort): fn(key) → true = verbraucht.
// Gilt nur, solange el im Dokument hängt (Tab- oder Schrittwechsel ohne Aufräumen), und nicht beim Tippen in Feldern.
export const stepKeys = (el, fn) => setKeyHandler(e => {
  if (!el.isConnected) return setKeyHandler(null);
  if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  const k = e.key === ' ' ? 'Space' : e.key;
  // Leertaste auf einem fokussierten Knopf würde ihn zusätzlich auslösen
  if (fn(k)) { e.preventDefault(); document.activeElement?.blur?.(); }
});
// Nächste Aufgabe: Übungskarte wieder oben zeigen, falls sie (am Handy, nach langer Rückmeldung) nach oben aus dem Bild gescrollt ist
export const showTop = card => requestAnimationFrame(() => {
  if (card.isConnected && card.getBoundingClientRect().top < 0) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
});

// Handys öffnen ohne Eingabefeld keine eigene Tastatur → alle Buchstaben aus lang.json (letters → chars) zeigen,
// angeordnet nach lang.json keyboard (qwertz: Deutsch mit ü ß ö ä; qwerty: Englisch, Schwedisch mit å ö ä), übrige hinten an der letzten Reihe.
// Reihen = physische Tasten des US-Layouts (CODES): so tippt auch, wer am Rechner ein anderes Layout aktiv hat (z. B. Georgisch), die richtigen Buchstaben.
const LAYOUTS = { qwerty: ['qwertyuiopå', 'asdfghjklöä', 'zxcvbnm'], qwertz: ['qwertzuiopüß', 'asdfghjklöä', 'yxcvbnm'] };
const CODES = [[...'QWERTYUIOP'].map(c => 'Key' + c).concat('BracketLeft', 'Minus'), [...'ASDFGHJKL'].map(c => 'Key' + c).concat('Semicolon', 'Quote'),
  [...'ZXCVBNM'].map(c => 'Key' + c)];
// ß hat keinen Großbuchstaben auf der Tastatur (toUpperCase → „SS“)
const up = c => c.toUpperCase().length === 1 ? c.toUpperCase() : c;
function latinKeyboard(onKey) {
  const letters = [...(LANG().chars ?? 'abcdefghijklmnopqrstuvwxyz'), ...(LANG().keys ?? [])];
  const layout = LAYOUTS[LANG().keyboard] ?? LAYOUTS.qwerty;
  const byCode = Object.fromEntries(layout.flatMap((r, ri) => [...r].map((c, i) => [CODES[ri][i], c])).filter(([, c]) => letters.includes(c)));
  const rows = layout.map(r => [...r].filter(c => letters.includes(c)));
  rows[2].push(...new Set(letters.filter(c => !rows.flat().includes(c))));
  const kb = h('div', { class: 'kbd' });
  let shift = false;
  const render = () => {
    kb.className = 'kbd latin';
    kb.replaceChildren(...rows.map((r, ri) => h('div', { class: 'krow' },
      ri === 2 ? h('button', { class: 'wide', onclick: () => { shift = !shift; render(); } }, shift ? t('⇧ an') : '⇧') : null,
      r.map(c => {
        const ch = shift ? up(c) : c;
        return h('button', { onclick: () => { onKey(ch); if (shift) { shift = false; render(); } } }, h('span', { class: 'main' }, ch));
      }),
      ri === 2 ? h('button', { class: 'wide', onclick: () => onKey('Backspace') }, '⌫') : null)),
      h('div', { class: 'krow' }, h('button', { class: 'wide', style: 'width:40%', onclick: () => onKey(' ') }, t('Leertaste')),
        h('button', { class: 'wide', onclick: () => onKey('Enter') }, t('Prüfen ⏎'))));
  };
  render();
  kb.physical = e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace' || e.key === 'Enter') { e.preventDefault(); return onKey(e.key); }
    if (e.key.length !== 1) return;
    // Buchstabe einer anderen Schrift (Tastaturlayout des Rechners) → Buchstabe an derselben Taste im Layout der Zielsprache
    const ch = /\p{L}/u.test(e.key) && !letters.includes(e.key.toLowerCase()) && byCode[e.code] ? (e.shiftKey ? up(byCode[e.code]) : byCode[e.code]) : e.key;
    e.preventDefault(); onKey(ch);
  };
  return kb;
}

export function keyboard(onKey, known) {
  if (!LANG().letters) return latinKeyboard(onKey);
  const byKey = Object.fromEntries(D.alphabet.map(l => [l.key, l.char]));
  const kb = h('div', { class: 'kbd' });
  let shift = false;
  const rows = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'];
  const render = () => {
    kb.className = 'kbd' + (shift ? ' shift' : '');
    kb.replaceChildren(...rows.map((r, ri) => h('div', { class: 'krow' },
      ri === 2 ? h('button', { class: 'wide', onclick: () => { shift = !shift; render(); } }, shift ? t('⇧ an') : '⇧') : null,
      [...r].map(k => {
        const main = byKey[k], sh = byKey[k.toUpperCase()];
        const ch = shift ? sh : main;
        return h('button', { class: (ch && !known.has(ch) ? 'unknown' : '') + (shift && !sh ? ' noshift' : ''),
          onclick: () => { if (ch) onKey(ch); if (shift) { shift = false; render(); } } },
          h('span', { class: 'main' }, main ?? ''), sh ? h('span', { class: 'sh' }, sh) : null);
      }),
      ri === 2 ? h('button', { class: 'wide', onclick: () => onKey('Backspace') }, '⌫') : null)),
      h('div', { class: 'krow' }, h('button', { class: 'wide', style: 'width:40%', onclick: () => onKey(' ') }, t('Leertaste')),
        h('button', { class: 'wide', onclick: () => onKey('Enter') }, t('Prüfen ⏎'))));
  };
  render();
  kb.physical = e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); return onKey(e.key); }
    const ch = byKey[e.key];
    if (ch) { e.preventDefault(); onKey(ch); }
  };
  return kb;
}
