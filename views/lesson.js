// Lektionsansicht mit drei Tabs Einführung · Üben · Wörter (I10); Einführung/Buchstaben/Wörter direkt hier, Übungen in eigenen Dateien.
import { h, md, tri, $app } from '../util.js';
import { D, letterBy, vocabBy, letterItem, isKa, glossText, SRC, langName } from '../data.js';
import { setLesson } from '../opts.js';
import { playBtn } from '../audio.js';
import { comparePanel } from '../spectrogram.js';
import { asrStatus, ensureAsr, recorder } from '../asr.js';
import { quiz } from './quiz.js';
import { flashcards } from './flashcards.js';
import { typing } from './typing.js';
import { speak } from './speak.js';
import { listen } from './listen.js';
import { cloze, build } from './cloze.js';
import { viewHome } from './home.js';
import { writing } from '../writing.js';
import { forms, hasForms } from './forms.js';
import { dialog } from './dialog.js';
import { ctx } from '../ctx.js';
import { cardsFor } from '../srs.js';
import { t } from '../i18n.js';

// Abschnitte nur für den Chat (/lektion) bzw. der alte feste Ablauf gehören nicht in die App; geübt wird über „Heute“
const HIDDEN = /^## (Für Claude|Ablauf)/;
const appBody = body => body.split(/^(?=## )/m).filter(s => !HIDDEN.test(s)).join('');
function intro(L, el) {
  el.append(h('p', { class: 'card small' }, t('Am besten übst du diese Lektion über '), h('a', { href: '#/today' }, h('b', {}, t('Heute'))),
    t(' – unter '), h('b', {}, t('Üben')), t(' wählst du einzelne Übungen gezielt.')),
    // Erklärung fehlt in der Ausgangssprache → Rückfallsprache (scripts/lib.mjs → loadLessons, textLang)
    // (el.append schreibt null als Text „null“ → leere Liste statt null)
    ...(L.textLang && L.textLang !== SRC() ? [h('p', { class: 'small muted' }, t('Diese Erklärung gibt es noch nicht in deiner Sprache – hier auf {lang}.', { lang: langName(L.textLang) }))] : []),
    h('div', { class: 'md', html: md(appBody(L.body)) }));
}

function letters(L, el) {
  const ls = L.letters.map(letterBy);
  const detail = h('div', { class: 'card detail' });
  const show = l => {
    const ex = vocabBy(l.example);
    detail.replaceChildren(
      h('div', { class: 'row', style: 'gap:24px' },
        h('div', { class: 'glyph' }, l.char),
        h('div', {}, h('div', {}, h('b', { style: 'font-size:22px' }, l.translit), ' ', h('span', { class: 'ipa', style: 'font-size:20px' }, l.ipa)),
          h('div', { class: 'muted' }, t('Name: '), h('span', { class: 'ka' }, l.name), ` (${l.nameTr})`),
          h('div', { class: 'row', style: 'margin-top:6px' }, playBtn(l), recorder(letterItem(l, L.id))))),
      h('p', {}, l.sound),
      ex ? h('p', {}, t('Beispiel: '), tri(ex.t, ex.translit, ex.ipa, ''), ' – ', glossText(ex), ' ', playBtn(ex)) : null);
    grid.querySelectorAll('.letter').forEach(e => e.classList.toggle('sel', e.dataset.c === l.char));
  };
  const grid = h('div', { class: 'grid-letters' }, ls.map(l => h('div', { class: 'card letter', 'data-c': l.char, onclick: () => show(l) },
    h('div', { class: 'glyph' }, l.char), h('div', {}, h('b', {}, l.translit), ' ', h('span', { class: 'ipa' }, l.ipa)))));
  comparePanel.style.display = 'none';
  ensureAsr();
  el.append(detail, asrStatus, comparePanel, grid);
  show(ls[0]);
}

// Formen für Sprachen ohne Formen-Drill (sv, Schlüssel aus lang.json)
const FORM_DE = { def: t('best.'), pl: t('Pl.'), defpl: t('best. Pl.'), pres: t('Präs.'), pret: t('Prät.'), sup: t('Supinum'), imp: t('Imp.'), n: t('Neutr.'), plAdj: t('Pl.'), comp: t('Komp.'), superl: t('Superl.') };
const formLine = v => !isKa() && Object.keys(v.forms ?? {}).length
  ? h('div', { class: 'small muted' }, Object.entries(v.forms).map(([k, f]) => `${FORM_DE[k] ?? k} ${f}`).join(' · ')) : null;

function words(L, el) {
  const vs = (L.vocab ?? []).map(vocabBy).filter(Boolean);
  el.append(h('table', { class: 'words' }, vs.map(v => h('tr', {},
    h('td', { class: 'ka' }, v.t), h('td', {}, h('span', { class: 'tr', 'data-ka': v.t }, v.translit), h('br'), h('span', { class: 'ipa small', 'data-ka': v.t }, v.ipa)),
    h('td', {}, glossText(v), formLine(v), v.notes ? h('div', { class: 'small muted' }, v.notes) : null),
    h('td', { style: 'white-space:nowrap' }, playBtn(v))))));
}

// Übungen im Tab „Üben“ (Auswahlzeile): [Schlüssel, Name, Funktion(L, el), optional Bedingung(L)] – neue Übungen hier eintragen.
// #/lesson/<id>/<übung> öffnet „Üben“ mit dieser Übung (Links aus Heute, Lesen, Buchstaben-Karte …).
export const EXERCISES = [
  ['quiz', t('Quiz'), quiz], ['flashcards', t('Karteikarten'), flashcards, L => cardsFor(L.id).length], ['typing', t('Tippen'), typing],
  ['listen', t('Hören'), listen], ['speak', t('Sprechen'), speak], ['writing', t('Schreiben'), (L, el) => writing(L, el, ctx()), L => L.letters?.length],
  ['forms', t('Formen'), forms, hasForms],
  ['cloze', t('Lückentext'), cloze, L => L.exercises?.includes('cloze')], ['build', t('Satzbau'), build, L => L.exercises?.includes('cloze')],
  ['dialog', t('Dialog'), dialog, L => L.exercises?.includes('dialog')],
];
const avail = L => ([, , , when]) => !when || when(L);

// zuletzt gewählte Übung je Lektion (Tab „Üben“ ohne Angabe öffnet sie wieder)
const LAST = 'lesson.ex';
const lastEx = id => { try { return JSON.parse(localStorage.getItem(LAST))?.[id]; } catch { return null; } };
const saveEx = (id, k) => { try { localStorage.setItem(LAST, JSON.stringify({ ...JSON.parse(localStorage.getItem(LAST) ?? '{}'), [id]: k })); } catch {} };

function practice(L, el, ex) {
  const shown = EXERCISES.filter(avail(L));
  const cur = shown.find(([k]) => k === ex) ?? shown.find(([k]) => k === lastEx(L.id)) ?? shown[0];
  saveEx(L.id, cur[0]);
  const row = h('div', { class: 'subtabs' }, shown.map(([k, name]) =>
    h('button', { class: 'btn' + (k === cur[0] ? ' on' : ''), onclick: () => location.hash = `#/lesson/${L.id}/${k}` }, name)));
  const body = h('div');
  el.append(row, body);
  scrollTo(row, row.querySelector('.on'));
  cur[2](L, body);
}

// Buchstaben (A0) und Wortliste zum Nachschlagen
function lookup(L, el) {
  if (L.letters?.length) letters(L, el);
  if (L.vocab?.length) words(L, el);
}

// Hauptreiter: [Schlüssel, Name, Funktion(L, el, übung), optional Bedingung(L)]
export const TABS = [
  ['intro', t('Einführung'), intro], ['practice', t('Üben'), practice],
  ['words', t('Wörter'), lookup, L => L.vocab?.length || L.letters?.length],
];
// schmale Bildschirme: Leiste scrollt waagrecht → aktiven Eintrag zeigen
const scrollTo = (bar, on) => { if (on) bar.scrollLeft = on.offsetLeft - bar.offsetLeft - (bar.clientWidth - on.offsetWidth) / 2; };

export function viewLesson(id, tab = 'intro') {
  const L = D.lessons.find(l => l.id === id);
  if (!L) return viewHome();
  setLesson(L);
  const body = h('div');
  let ex = null;
  if (EXERCISES.some(([k]) => k === tab)) [ex, tab] = [tab, 'practice'];    // alte Links #/lesson/<id>/quiz …
  else if (tab === 'letters') tab = 'words';
  const shown = TABS.filter(avail(L));
  if (!shown.some(([k]) => k === tab)) tab = 'intro';
  const name = (k, n) => k === 'words' && L.letters?.length ? (L.vocab?.length ? t('Buchstaben & Wörter') : t('Buchstaben')) : n;
  const tabs = h('div', { class: 'tabs' }, shown.map(([k, n]) =>
    h('button', { class: k === tab ? 'on' : '', onclick: () => location.hash = `#/lesson/${id}/${k}` }, name(k, n))));
  $app.replaceChildren(h('a', { href: '#/' }, t('← Übersicht')), h('h1', {}, `${L.id} · ${L.title}`), tabs, body);
  scrollTo(tabs, tabs.querySelector('.on'));
  shown.find(([k]) => k === tab)[2](L, body, ex);
}
