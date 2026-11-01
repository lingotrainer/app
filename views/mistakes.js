// Fehlerheft (#/mistakes): fällige Fehlerkarten (mistakes.js) in ihrer ursprünglichen Übungsform abfragen.
// Die Übungen selbst melden richtig/falsch an mistake() – hier wird nur ausgewählt und nacheinander gestartet.
import { h, $app } from '../util.js';
import { D, P, vocabBy, pairWordBy } from '../data.js';
import { setLesson } from '../opts.js';
import { setKeyHandler } from '../keyboard.js';
import { openErrs, dueErrs, ERR_OK } from '../mistakes.js';
import { cloze, build, sentences } from './cloze.js';
import { formsOnly } from './forms.js';
import { dialogLines } from './dialog.js';
import { pairsDrill, dictation, sentenceDictation, sentencePool } from './listen.js';
import { drill as numbersDrill } from './numbers.js';
import { t, LOCALE } from '../i18n.js';

const NAME = { cloze: t('Lückentext'), build: t('Satzbau'), forms: t('Formen'), dialog: t('Dialog'), pair: t('Minimalpaar'), dict: t('Diktat'), sent: t('Satzdiktat'), num: t('Zahlen') };
const NUM = { write: t('Ziffer → Wort'), read: t('Wort → Ziffer'), listen: t('Hören → Ziffer'), clock: t('Uhrzeit'), price: t('Preis') };
const lessonOf = id => D.lessons.find(l => l.id === id) ?? D.lessons[0];
const refOf = k => k.split(':').slice(2).join(':');

// Kurzbeschreibung für die Liste
function label(k) {
  const c = P[k], ref = refOf(k);
  if (c.kind === 'forms') { const v = vocabBy(c.v); return h('span', {}, h('span', { class: 'ka' }, v?.t ?? c.v), ` · ${c.f}`); }
  if (c.kind === 'dict') return h('span', { class: 'ka' }, vocabBy(ref)?.t ?? ref);
  if (c.kind === 'pair') return h('span', { class: 'ka' }, ref.split('|').map(id => (vocabBy(id) ?? pairWordBy(id))?.t ?? id.replace('letter-', '')).join(' / '));
  if (c.kind === 'num') return `${NUM[c.mode] ?? c.mode}: ${c.item}`;
  if (c.kind === 'dialog') return t('{d}, Zeile {n}', { d: c.d, n: c.line + 1 });
  const el = h('span', { class: 'ka' }, ref);        // Satz (cloze/build/Satzdiktat): Text nachladen
  if (c.kind === 'sent') { sentencePool(D.lessons.at(-1)).then(ss => { const s = ss.find(x => x.id === ref); if (s) el.textContent = s.t; }).catch(() => {}); return el; }
  sentences().then(ss => { const s = ss.find(x => x.id === ref); if (s) el.textContent = s.t; }).catch(() => {});
  return el;
}

// Karten zu Läufen bündeln: gleiche Übung (+ Lektion/Dialog/Zahlenmodus) = ein Aufruf der Übung
function groups(keys) {
  const g = new Map();
  for (const k of keys) {
    const c = P[k];
    const id = c.kind === 'dialog' ? `dialog:${c.d}` : c.kind === 'num' ? `num:${c.mode}` : c.kind === 'forms' ? 'forms' : `${c.kind}:${c.lesson}`;
    if (!g.has(id)) g.set(id, { kind: c.kind, cards: [] });
    g.get(id).cards.push({ ...c, ref: refOf(k) });
  }
  return [...g.values()];
}
// counter(i, n): Übungen, die ihren Fortschritt melden können, zeigen keinen eigenen Zähler (sonst stünden zwei übereinander)
const start = (gr, el, onDone, counter) => {
  const cs = gr.cards, L = lessonOf(cs[0].lesson);
  if (gr.kind === 'cloze') return cloze(L, el, { only: cs.map(c => ({ s: c.s, v: c.v })), mode: 'choice', onDone, counter });
  if (gr.kind === 'build') return build(L, el, { only: cs.map(c => c.ref), onDone, counter });
  if (gr.kind === 'forms') return formsOnly(cs.map(c => `${c.v}:${c.f}`), el, { onDone, counter });
  if (gr.kind === 'dialog') return dialogLines(cs[0].d, cs.map(c => c.line), el, { onDone, counter });
  if (gr.kind === 'pair') return pairsDrill(L, el, { only: new Set(cs.map(c => c.ref)), onDone, counter });
  if (gr.kind === 'dict') return dictation(L, el, { items: cs.map(c => vocabBy(c.ref)).filter(Boolean), onDone, counter });
  if (gr.kind === 'sent') return sentenceDictation(L, el, { ids: cs.map(c => c.ref), onDone, counter });
  if (gr.kind === 'num') return numbersDrill(el, cs[0].mode, cs[0].range, { items: cs.map(c => c.item), onDone, counter });
  onDone({ skipped: true });
};

// Fällige Fehlerkarten abfragen; max = höchstens so viele (Heute: ~5 min). onDone({score, of, wrong, done})
export function runMistakes(el, { max = Infinity, onDone } = {}) {
  const keys = dueErrs().slice(0, max);
  if (!keys.length) return onDone({ skipped: true, done: 0 });
  const gs = groups(keys), sum = { score: 0, of: 0, wrong: [], done: keys.length };
  const box = h('div'), head = h('div', { class: 'small muted' });
  el.append(head, box);
  let i = 0, before = 0;
  const next = r => {
    setKeyHandler(null);
    if (r && !r.skipped) { sum.score += r.score ?? 0; sum.of += r.of ?? 0; sum.wrong.push(...(r.wrong ?? [])); }
    if (i === gs.length) return onDone(sum);
    if (i) before += gs[i - 1].cards.length;
    const gr = gs[i++], name = NAME[gr.kind], at = before;
    // ein Zähler über alle Fehlerkarten; Übungen ohne counter-Option zählen selbst (dann hier nur die Übungsart)
    head.textContent = t('Fehlerheft: {name}', { name });
    box.replaceChildren();
    start(gr, box, next, (k, n) => { head.textContent = t('Fehlerheft {i} / {n} · {name}', { i: at + Math.min(k, n), n: keys.length, name }); });
  };
  next();
}

export function viewMistakes() {
  setLesson(null);
  const open = openErrs().sort((a, b) => P[a].due - P[b].due), due = dueErrs();
  const body = h('div');
  const fmt = ts => ts <= Date.now() ? t('jetzt') : new Date(ts).toLocaleDateString(LOCALE === 'de' ? 'de-DE' : LOCALE, { weekday: 'short', day: 'numeric', month: 'numeric' });
  const list = open.length ? h('table', { class: 'words' },
    h('tr', {}, h('th', {}, t('Übung')), h('th', {}, t('Was')), h('th', {}, t('Fehler')), h('th', {}, t('richtig')), h('th', {}, t('fällig'))),
    open.map(k => h('tr', {}, h('td', {}, NAME[P[k].kind] ?? P[k].kind), h('td', {}, label(k)), h('td', {}, P[k].n),
      h('td', {}, `${P[k].ok} / ${ERR_OK}`), h('td', {}, fmt(P[k].due))))) : null;
  const go = () => {
    body.replaceChildren();
    runMistakes(body, { onDone: r => {
      body.replaceChildren(h('div', { class: 'card flash' }, h('h2', {}, r.skipped ? t('Nichts fällig ✓') : t('{score} / {n} richtig', { score: r.score, n: r.of })),
        h('p', { class: 'muted' }, t('Richtig beantwortete Karten kommen in 3 Tagen nochmal, nach 2× richtig sind sie erledigt.')),
        h('button', { class: 'btn primary', onclick: viewMistakes }, t('Zurück zum Fehlerheft'))));
    } });
  };
  $app.replaceChildren(h('a', { href: '#/review' }, t('← Wiederholen')), h('h1', {}, t('Fehlerheft')),
    h('p', { class: 'small muted' }, t('Fehler aus Lückentext, Satzbau, Formen, Dialog, Hören (auch Satzdiktat) und Zahlen kommen hier in derselben Übungsform wieder:') + ' ',
      t('gleich fällig, nach 1× richtig in 3 Tagen nochmal, nach 2× richtig gestrichen. Falsche Wörter (Lückentext, Diktat, Quiz) landen zusätzlich als fällige Karteikarte in „Wiederholen“.')),
    body);
  body.append(open.length ? h('div', { class: 'card row' }, h('b', {}, t('{n} von {m} offenen Fehlerkarten fällig', { n: due.length, m: open.length })),
    due.length ? h('button', { class: 'btn primary', onclick: go }, t('Jetzt üben')) : null) : h('p', { class: 'card' }, t('Keine offenen Fehler 🎉')), list);
}
