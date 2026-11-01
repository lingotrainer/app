// Lückentext (Auswahl oder Tippen) und Satzbau (Wortkacheln ordnen) aus den Lektionssätzen (/api/sentences)
import { h, shuffle, pick, log, api } from '../util.js';
import { D, lessonIdx, knownLetters, vocabBy, LANG, SRC, trOf, glossText, txt } from '../data.js';
import { playBtn } from '../audio.js';
import { keyboard, setKeyHandler } from '../keyboard.js';
import { mistake, lapse } from '../mistakes.js';
import { verifiedBadge } from '../checkbadge.js';
import { formsAt } from './forms.js';
import { t } from '../i18n.js';

// Eigene Stile hier statt in style.css (Datei wird von mehreren Übungen geteilt)
document.head.append(h('style', {}, `
.cz-sent { font-family: var(--ka); font-size: 28px; line-height: 1.6; }
.cz-gap { display: inline-block; min-width: 3.5em; border-bottom: 2px solid var(--accent); text-align: center; color: var(--accent); }
.cz-gap.ok { color: var(--ok); border-color: var(--ok); } .cz-gap.bad { color: var(--bad); border-color: var(--bad); }
.cz-de { font-size: 19px; margin: 4px 0 10px; }
.cz-tiles { display: flex; flex-wrap: wrap; gap: 8px; min-height: 54px; padding: 8px; border-radius: 10px; }
.cz-line { border: 1px dashed var(--line); background: var(--card); }
.cz-tiles button { font-family: var(--ka); font-size: 22px; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); color: var(--fg); cursor: pointer; }
.cz-tiles button:hover { border-color: var(--accent); }
.cz-line.ok { border: 1px solid var(--ok); background: var(--ok-soft); } .cz-line.alt { border: 1px solid var(--muted); }
.cz-modes { margin-bottom: 6px; } .cz-modes button.on { border-color: var(--accent); background: var(--accent-soft); }
`));

let cache = null;
export const sentences = async () => cache ??= await api('/api/sentences');
const lessonSents = async L => { const ids = new Set(L.sentences ?? []); return (await sentences()).filter(s => ids.has(s.id)); };
// feste Sätze (Fehlerheft), Reihenfolge wie übergeben
const sentsById = async ids => { const all = await sentences(); return ids.map(id => all.find(s => s.id === id)).filter(Boolean); };

const PUNCT = /[.,!?;:«»„“"…—–()]/g;
const bare = w => w.replace(PUNCT, '');
const tokens = ka => ka.split(/\s+/).filter(w => bare(w));

// Alle Einzelwort-Formen einer Vokabel (Grundform + forms, z. B. ვარ/ხარ/არის, სახელს, სახელები)
const formsOf = v => [...new Set([v.t, ...Object.values(v.forms ?? {})].flatMap(f => String(f).split(/[\/,;]/))
  .map(f => f.trim()).filter(f => f && !/\s/.test(f)))];
// Hinweis zur Wortstellung je Zielsprache, wenn die gelegten Wörter vom Original abweichen
const ORDER = {
  ka: t('Anders als im Original – die georgische Wortstellung ist recht frei, deine Reihenfolge ist vielleicht auch möglich (Possessiva und Adjektive stehen aber vor dem Nomen).'),
  sv: t('Anders als im Original. Achtung: Im Schwedischen steht das Verb im Aussagesatz an 2. Stelle, in Ja/Nein-Fragen vorne.'),
  de: t('Anders als im Original. Achtung: Im Deutschen steht das Verb im Aussagesatz an 2. Stelle, in Ja/Nein-Fragen vorne.'),
  en: t('Anders als im Original. Achtung: Im Englischen gilt Subjekt – Verb – Objekt, Fragen beginnen meist mit do/does oder einer Form von be.'),
};
// Wort im Satz → Vokabel: erst exakte Form, dann Stamm + kurze Endung (მეგობარია = მეგობარი + -ა „ist“)
function matchVocab(w, vs) {
  for (const v of vs) if (formsOf(v).includes(w)) return v;
  for (const v of vs) for (const f of formsOf(v)) {
    const stem = f.replace(/[ია]$/, '');
    if (stem.length >= 3 && w.startsWith(stem) && w.length - stem.length <= 3) return v;
  }
}

// Lückentext-Aufgaben: pro Satz ein Wort aus der Lektion (sonst aus früheren Lektionen) ausblenden
export function clozeItems(L, sents) {
  const lessonVs = (L.vocab ?? []).map(vocabBy).filter(Boolean);
  const olderVs = D.vocab.filter(v => lessonIdx(v.lesson) < lessonIdx(L.id) && !lessonVs.includes(v));
  return sents.flatMap(s => {
    const ws = tokens(s.t).map(bare);
    const hits = ws.map((w, i) => ({ i, w, v: matchVocab(w, lessonVs) })).filter(x => x.v);
    const pool = hits.length ? hits : ws.map((w, i) => ({ i, w, v: matchVocab(w, olderVs) })).filter(x => x.v);
    if (!pool.length) return [];
    const x = pick(pool);
    return [{ s, idx: x.i, answer: x.w, v: x.v }];
  });
}

// 3 Ablenker: bevorzugt andere Formen derselben Vokabel (ვარ/ხარ/არის), dann andere Lektionswörter
function distractors(it, L) {
  const lessonVs = (L.vocab ?? []).map(vocabBy).filter(Boolean);
  const out = new Set();
  const known = new Set([it.v.t, ...formsAt(it.v, L)]);
  for (const f of shuffle(formsOf(it.v))) if (out.size < 2 && f !== it.answer && known.has(f)) out.add(f);
  const more = [...shuffle(lessonVs), ...shuffle(D.vocab.filter(v => lessonIdx(v.lesson) <= lessonIdx(L.id)))];
  for (const v of more) { if (out.size >= 3) break; if (v !== it.v && !/\s/.test(v.t) && v.t !== it.answer) out.add(v.t); }
  return [...out];
}

// Kopf mit Übersetzung (Ausgangssprache, sonst Rückfall gedämpft) und dezenten Hinweisen zur Herkunft
const deLine = s => { const tr = trOf(s); return h('div', { class: 'cz-de' }, tr.lang === SRC() ? tr.all.join(' / ') : h('span', { class: 'muted' }, tr.all.join(' / ')),
  tr.claude ? h('span', { class: 'small muted', title: t('Deutsche Übersetzung von Claude (Tatoeba hat nur Englisch)') }, ' ' + t('(Ü: Claude)')) : null,
  verifiedBadge(s, t('Eigener Satz von Claude, noch nicht gegen eine Quelle geprüft'))); };
const solved = s => h('div', { class: 'row', style: 'margin-top:8px' }, h('span', { class: 'ka', style: 'font-size:22px' }, s.t), playBtn(s),
  h('span', { class: 'tr', 'data-ka': s.t }, s.translit), h('span', { class: 'ipa small', 'data-ka': s.t }, s.ipa));
const empty = (el, msg) => el.append(h('div', { class: 'card' }, h('p', { class: 'muted' }, msg)));
const result = (el, score, n, again, msg = t('{score} / {n} richtig', { score, n })) => el.replaceChildren(h('div', { class: 'card flash' }, h('h2', {}, msg),
  h('button', { class: 'btn primary', onclick: again }, t('Nochmal'))));

// ---------- Lückentext ----------
// onDone({score, of, wrong}) statt Ergebniskarte (Heute-Ablauf); ohne Sätze onDone({skipped: true})
// only: [{s, v}] = genau diese Sätze mit dieser Vokabel als Lücke (Fehlerheft)
export async function cloze(L, el, { n = 10, mode, onDone, only, counter = null } = {}) {
  el.replaceChildren(h('p', { class: 'muted' }, t('Lade Sätze …')));
  const items = only ? (await sentsById(only.map(o => o.s))).flatMap(s => {
    const v = vocabBy(only.find(o => o.s === s.id).v), i = v ? tokens(s.t).map(bare).findIndex(w => matchVocab(w, [v])) : -1;
    return i >= 0 ? [{ s, idx: i, answer: bare(tokens(s.t)[i]), v }] : clozeItems(L, [s]);
  }) : shuffle(clozeItems(L, await lessonSents(L))).slice(0, n);
  el.replaceChildren();
  if (!items.length) return onDone ? onDone({ skipped: true }) : empty(el, t('Für diese Lektion gibt es noch keine passenden Sätze für Lückentexte.'));
  try { mode ??= localStorage.getItem('clozeMode') ?? 'choice'; } catch { mode ??= 'choice'; }
  const setMode = m => { try { localStorage.setItem('clozeMode', m); } catch {} cloze(L, el, { n, mode: m, onDone, only }); };
  const modes = h('div', { class: 'row cz-modes' }, h('span', { class: 'small muted' }, t('Antwort:')),
    [['choice', t('Auswahl')], ['type', t('Tippen')]].map(([m, name]) => h('button', { class: 'btn' + (m === mode ? ' on' : ''), onclick: () => setMode(m) }, name)));
  const card = h('div', { class: 'card' });
  el.append(modes, card);
  const known = new Set(knownLetters(L.id).map(l => l.char));
  let i = 0, score = 0;
  const wrong = [];

  const next = () => {
    setKeyHandler(null);
    if (i === items.length) return onDone ? onDone({ score, of: items.length, wrong }) : result(el, score, items.length, () => cloze(L, el, { n, mode }));
    const it = items[i++], ws = tokens(it.s.t);
    const gap = h('span', { class: 'cz-gap' }, '＿＿');
    const sent = h('div', { class: 'cz-sent' }, ws.flatMap((w, k) => [k ? ' ' : '', k === it.idx ? h('span', {}, gap, w.slice(bare(w).length)) : w]));
    const fb = h('p', { class: 'feedback' }), after = h('div');
    let checked = false;
    const check = given => {
      if (checked) return; checked = true;
      const ok = given.trim() === it.answer;
      if (ok) score++; else wrong.push(it.answer);
      gap.textContent = it.answer; gap.className = 'cz-gap ' + (ok ? 'ok' : 'bad');
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      const lemma = it.v.t !== it.answer ? h('span', { class: 'muted small' }, ' ' + t('(Grundform {ka} – {de})', { ka: it.v.t, de: glossText(it.v) })) : h('span', { class: 'muted small' }, ` (${glossText(it.v)})`);
      fb.replaceChildren(ok ? t('✓ richtig') : h('span', {}, t('✗ richtig:') + ' ', h('span', { class: 'ka', style: 'font-size:22px' }, it.answer)), lemma);
      after.replaceChildren(solved(it.s), h('div', { style: 'margin-top:10px' }, h('button', { class: 'btn primary', onclick: next }, t('Weiter ⏎'))));
      log({ lesson: L.id, ex: 'cloze', mode, item: it.s.id, word: it.v.id, ok, given: given.trim() });
      mistake('cloze', it.s.id, { lesson: L.id, s: it.s.id, v: it.v.id }, ok);
      if (!ok) lapse(`v:${it.v.id}:de`);
      return ok;
    };
    counter?.(i, items.length);
    const head = [h('div', { class: 'small muted' }, counter ? t('Welches Wort fehlt?') : `${i} / ${items.length} · ` + t('Welches Wort fehlt?')), deLine(it.s), sent];
    if (mode === 'type') {
      let text = '';
      const typed = h('div', { class: 'typed' });
      const kb = keyboard(k => {
        if (k === 'Enter') { if (checked) return next(); if (text.trim()) { typed.className = 'typed ' + (check(text) ? 'ok' : 'bad'); } return; }
        if (checked) return;
        text = k === 'Backspace' ? text.slice(0, -1) : text + k;
        typed.textContent = text; gap.textContent = text || '＿＿';
      }, known);
      setKeyHandler(kb.physical);
      card.replaceChildren(...head, typed, fb, after, kb);
    } else {
      const opts = shuffle([it.answer, ...distractors(it, L)]);
      const btns = opts.map((o, k) => h('button', { class: 'ka', onclick: () => choose(k) }, o));
      const choose = k => {
        if (checked) return;
        check(opts[k]);
        btns.forEach((b, j) => b.classList.toggle('ok', opts[j] === it.answer));
        if (opts[k] !== it.answer) btns[k].classList.add('bad');
      };
      setKeyHandler(e => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (/^[1-4]$/.test(e.key) && btns[e.key - 1]) { e.preventDefault(); choose(e.key - 1); }
        else if (e.key === 'Enter' && checked) { e.preventDefault(); next(); }
      });
      card.replaceChildren(...head, h('div', { class: 'options' }, btns), fb, after, h('p', { class: 'small muted' }, t('Tasten 1–4 wählen, ⏎ weiter.')));
    }
  };
  next();
}

// ---------- Satzbau ----------
// Wortstellung im Georgischen ist recht frei: Abweichungen vom Original gelten nicht als falsch, es wird nur das Original gezeigt.
// only: [Satz-IDs] (Fehlerheft)
export async function build(L, el, { n = 8, onDone, only, counter = null } = {}) {
  el.replaceChildren(h('p', { class: 'muted' }, t('Lade Sätze …')));
  // nur Einzelsätze (Satzzeichen gehen auf den Kacheln verloren), 2–9 Wörter
  const single = s => !/[.!?…]/.test(s.t.trim().replace(/[.!?…]+$/, ''));
  const items = only ? await sentsById(only) : shuffle((await lessonSents(L)).filter(s => { const k = tokens(s.t).length; return k >= 2 && k <= 9 && trOf(s).lang === SRC() && single(s); })).slice(0, n);
  el.replaceChildren();
  if (!items.length) return onDone ? onDone({ skipped: true }) : empty(el, t('Für diese Lektion gibt es noch keine passenden Sätze für den Satzbau.'));
  const card = h('div', { class: 'card' });
  el.append(card);
  let i = 0, score = 0, retry = false;   // „Nochmal ordnen“ zählt nicht für die Punkte
  const wrong = [];

  const next = (again = false) => {
    setKeyHandler(null);
    retry = again;
    if (i === items.length) return onDone ? onDone({ score, of: items.length, wrong }) : result(el, score, items.length, () => build(L, el, { n }), t('{score} / {n} wie im Original', { score, n: items.length }));
    const s = items[i++];
    const ws = tokens(s.t).map(bare);
    let pool = ws.map((w, k) => ({ w, k }));
    if (new Set(ws).size > 1) do pool = shuffle(pool); while (pool.every((tile, j) => tile.w === ws[j]));
    const line = [], lineEl = h('div', { class: 'cz-tiles cz-line' }), poolEl = h('div', { class: 'cz-tiles' });
    const fb = h('p', { class: 'feedback' }), after = h('div');
    let checked = false;
    const render = () => {
      lineEl.replaceChildren(...line.map(tile => h('button', { onclick: () => move(tile, line, pool) }, tile.w)));
      poolEl.replaceChildren(...pool.map(tile => h('button', { onclick: () => move(tile, pool, line) }, tile.w)));
    };
    const move = (tile, from, to) => {
      if (checked) return;
      from.splice(from.indexOf(tile), 1); to.push(tile); render();
      if (line.length === ws.length) check();
    };
    const check = () => {
      checked = true; render();
      const given = line.map(tile => tile.w);
      const ok = given.join(' ') === ws.join(' ');
      if (ok && !retry) score++;
      if (!ok && !retry) wrong.push(bare(s.t.trim()));
      lineEl.className = 'cz-tiles cz-line ' + (ok ? 'ok' : 'alt');
      fb.className = 'feedback' + (ok ? ' ok' : '');
      fb.replaceChildren(ok ? t('✓ genau wie im Original') : h('span', {},
        (ORDER[LANG().code] ?? t('Anders als im Original.')) + ' ', h('br'),
        h('span', { class: 'muted' }, t('So steht der Satz im Original:'))));
      after.replaceChildren(solved(s), h('div', { class: 'row', style: 'margin-top:10px' },
        !ok ? h('button', { class: 'btn', onclick: () => { i--; next(true); } }, t('Nochmal ordnen')) : null,
        h('button', { class: 'btn primary', onclick: () => next() }, t('Weiter ⏎'))));
      log({ lesson: L.id, ex: 'build', retry, item: s.id, ok, given: given.join(' ') });
      if (!retry) mistake('build', s.id, { lesson: L.id }, ok);
    };
    setKeyHandler(e => { if (e.key === 'Enter' && checked) { e.preventDefault(); next(); } });
    counter?.(i, items.length);
    card.replaceChildren(h('div', { class: 'small muted' }, counter ? t('Bilde den Satz auf {lang}:', { lang: txt(LANG().name) }) : `${i} / ${items.length} · ` + t('Bilde den Satz auf {lang}:', { lang: txt(LANG().name) })), deLine(s),
      lineEl, poolEl,
      h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => { if (checked) return; pool.push(...line.splice(0)); render(); } }, t('Zurücksetzen')),
        h('span', { class: 'small muted' }, t('Kachel antippen = hinzufügen, oben antippen = zurücklegen.'))),
      fb, after);
    render();
  };
  next();
}
