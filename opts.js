// Anzeigeoptionen (Translit/IPA), abhängig von der aktuellen Lektion
// Umschrift (I13): Stufe opts.tr = always | adaptive (Standard) | never. Lektionen mit `translit: hide` (ab A0-06) nehmen
// opts.trHide (Standard never). Verdeckt heißt nicht weg: .tr.cov zeigt „👁 Umschrift“, Antippen deckt nur dieses Element
// (und die IPA desselben Worts) auf und loggt {ex:'peek'}. adaptive: verdeckt, wenn alle Buchstaben von data-ka laut
// /api/letters „sicher“ sind; ohne data-ka oder ohne Buchstabenstand bleibt die Umschrift sichtbar. Nur ka.
import { api, log } from './util.js';
import { isKa } from './data.js';
import { t } from './i18n.js';

const ka = () => { try { return isKa(); } catch { return false; } };   // vor loadData() noch unbekannt

const opts = { translit: true, ipa: true, autoNext: true };
try { Object.assign(opts, JSON.parse(localStorage.getItem('opts') ?? '{}')); } catch {}
// alte Einstellungen: translit false = nie, translitForce (in hide-Lektionen trotzdem zeigen) = immer
opts.tr ??= opts.translit === false ? 'never' : 'adaptive';
opts.trHide ??= opts.translitForce ? 'always' : 'never';
const save = () => { try { localStorage.setItem('opts', JSON.stringify(opts)); } catch {} };
let currentLesson = null;

const hideLesson = () => currentLesson?.translit === 'hide';
const trMode = () => hideLesson() ? opts.trHide : opts.tr;

// Buchstabenstand (char → state), höchstens alle 5 min neu geholt
let solid = null, fetched = 0;
function refreshLetters() {
  if (!ka() || Date.now() - fetched < 5 * 60e3) return;
  fetched = Date.now();
  api('/api/letters').then(r => {
    if (!r.letters?.length) return;
    solid = new Set(r.letters.filter(l => l.state === 'solid').map(l => l.char));
    coverAll();
  }).catch(() => { fetched = 0; });
}
const isSolid = ka => { const cs = (ka ?? '').match(/[ა-ჿ]/g); return !!(solid && cs?.length && cs.every(c => solid.has(c))); };

function cover(el) {
  if (el.classList.contains('peek')) return;
  const mode = ka() ? trMode() : 'always';
  const on = mode === 'never' || (mode === 'adaptive' && isSolid(el.dataset.ka));
  el.classList.toggle('cov', on);
  if (!el.classList.contains('tr')) return;
  if (on) { el.tabIndex = 0; el.setAttribute('role', 'button'); el.title = t('Umschrift zeigen'); }
  else if (el.getAttribute('role') === 'button') { el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('title'); }
}
// IPA desselben Worts (gleiches data-ka) folgt der Umschrift; IPA ohne data-ka bleibt wie eingestellt
const SEL = '.tr, .ipa[data-ka]';
const coverAll = (root = document) => root.querySelectorAll(SEL).forEach(cover);
new MutationObserver(ms => {
  for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) { if (n.matches(SEL)) cover(n); coverAll(n); }
}).observe(document.body, { childList: true, subtree: true });

// Aufdecken: delegiert, vor den Klick-Handlern der Views (Auswahlknöpfe, Tabellenzeilen) abfangen
const peeks = new Map(), logged = new Set();
let peekTimer;
function reveal(el) {
  const ka = el.dataset.ka;
  el.classList.remove('cov'); el.classList.add('peek');
  el.removeAttribute('tabindex'); el.removeAttribute('role'); el.removeAttribute('title');
  if (ka) el.parentElement?.querySelectorAll('.ipa.cov').forEach(i => { if (i.dataset.ka === ka) { i.classList.remove('cov'); i.classList.add('peek'); } });
  // je Wort höchstens einmal pro Tag und Seite loggen, gesammelt nach 4 s Ruhe
  const key = new Date().toDateString() + ka;
  if (ka && !logged.has(key)) { logged.add(key); peeks.set(ka, currentLesson?.id); clearTimeout(peekTimer); peekTimer = setTimeout(flushPeeks, 4000); }
}
function flushPeeks() {
  clearTimeout(peekTimer);
  for (const [item, lesson] of peeks) log({ ex: 'peek', item, ...(lesson ? { lesson } : {}) });
  peeks.clear();
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && peeks.size && flushPeeks());
document.addEventListener('click', e => {
  const el = e.target.closest?.('.tr.cov');
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  reveal(el);
}, true);
document.addEventListener('keydown', e => {
  if ((e.key !== 'Enter' && e.key !== ' ') || !e.target.matches?.('.tr.cov')) return;
  e.preventDefault(); e.stopPropagation();
  reveal(e.target);
}, true);

function applyOpts(lesson) {
  const sel = document.getElementById('opt-translit');
  sel.value = trMode();
  sel.title = hideLesson() ? t('Umschrift in dieser Lektion (ab A0-06 standardmäßig „nie“)') : t('Umschrift: adaptiv = nur bei Wörtern mit noch unsicheren Buchstaben');
  document.body.classList.toggle('hide-ipa', !opts.ipa);
  document.getElementById('opt-ipa').checked = opts.ipa;
  document.querySelectorAll('.peek').forEach(el => el.classList.remove('peek'));
  refreshLetters();
  coverAll();
}
export function setLesson(L) { currentLesson = L; applyOpts(L); }
window.addEventListener('hashchange', refreshLetters);

document.getElementById('opt-translit').onchange = e => {
  if (hideLesson()) opts.trHide = e.target.value; else opts.tr = e.target.value;
  save();
  applyOpts(currentLesson);
};
document.getElementById('opt-ipa').onchange = e => {
  opts.ipa = e.target.checked;
  save();
  applyOpts(currentLesson);
};
// Übungen: nach „richtig“ automatisch zur nächsten Aufgabe (bei „falsch“ immer anhalten)
export const autoNext = () => opts.autoNext !== false;
const auto = document.getElementById('opt-autonext');
if (auto) {
  auto.checked = autoNext();
  auto.onchange = e => { opts.autoNext = e.target.checked; save(); };
}
