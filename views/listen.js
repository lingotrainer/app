// Hörtraining: Minimalpaare (welches Wort / welche Silbe war das?), Diktat (Wort hören → tippen) und Satzdiktat (ab A1)
import { h, shuffle, pick, log, $app } from '../util.js';
import { D, P, LANG, lessonIdx, knownLetters, letterBy, letterItem, arePartners, translit, isKa, isA0, vocabBy, pairWordBy, glossText, trText, txt } from '../data.js';
import { play, playBtn, canPlay, rateToggle } from '../audio.js';
import { keyboard, setKeyHandler, stepKeys, showTop } from '../keyboard.js';
import { speakText } from '../asr.js';
import { setLesson, autoNext } from '../opts.js';
import { mistake, lapse } from '../mistakes.js';
import { reading, ipaOf } from './read.js';
import { t } from '../i18n.js';

export const pairKey = p => [p.a.id, p.b.id].sort().join('|');

const TYPE = { ejective: t('ejektiv – ohne Hauch, „Knack“'), aspirated: t('behaucht – mit Lufthauch'), voiced: t('stimmhaft'),
  vowel: t('Vokal'), fricative: t('Reibelaut'), sonorant: t('Sonorant') };
// Vokale mit Aussprachehinweis aus alphabet.json („offenes e wie in Bett“), sonst Lautart
const describe = c => { const l = letterBy(c); return l ? `${c} ${l.translit} [${l.ipa}] ${l.type === 'vowel' ? '– ' + l.sound : TYPE[l.type] ?? ''}` : LANG().sounds?.[c] ? `[${c}] ${txt(LANG().sounds[c])}` : c; };
// Worauf man beim Hinhören achtet (Paare, die oft verwechselt werden; Schlüssel = beide Zeichen sortiert)
const PAIR_TIP = {
  'ეი': t('ე ist offener: Mund weiter auf, klingt fast wie ä. ი ist eng und hell, Lippen breit.'),
  'მნ': t('Hör auf den Übergang zum Vokal: nach მ (Lippen gehen auf) klingt er dunkler, nach ნ (Zunge löst sich hinter den Zähnen) heller.'),
};
const pairTip = (a, b) => PAIR_TIP[[a, b].sort().join('')];

// Anzeige eines hörbaren Elements: Wort oder Buchstaben-Silbe (Konsonant + ა, wie im Hörbeispiel)
function unit(item) {
  if (item.t) return { t: item.t, tr: item.translit, ipa: item.ipa, de: glossText(item) };
  const v = item.type === 'vowel';
  return { t: speakText(item), tr: item.translit + (v ? '' : 'a'), ipa: item.ipa + (v ? '' : 'ɑ') };
}
const unitView = (item, big = true) => { const u = unit(item); return h('span', {}, h('span', { class: 'ka', style: big ? 'font-size:34px' : '' }, u.t), ' ', h('span', { class: 'tr small', 'data-ka': u.t }, u.tr), ' ', h('span', { class: 'ipa small', 'data-ka': u.t }, u.ipa)); };

// Minimalpaare bis einschließlich Lektion L: Wörter gleicher Länge, die sich in genau einem Buchstaben
// aus einer Partnergruppe unterscheiden (z. B. ქარი/კარი), dazu Buchstaben-Silben (ქა/კა).
export function findPairs(L) {
  if (!isKa()) return findSoundPairs(L);
  const max = lessonIdx(L.id);
  const words = D.vocab.filter(v => lessonIdx(v.lesson) <= max && canPlay(v));
  const pairs = [];
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
    const a = [...words[i].t], b = [...words[j].t];
    if (a.length !== b.length) continue;
    const diff = a.flatMap((c, k) => c === b[k] ? [] : [k]);
    if (diff.length === 1 && arePartners(a[diff[0]], b[diff[0]])) pairs.push({ a: words[i], b: words[j], ca: a[diff[0]], cb: b[diff[0]], kind: 'word' });
  }
  const ls = knownLetters(L.id).filter(canPlay);
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++)
    if (arePartners(ls[i].char, ls[j].char)) pairs.push({ a: letterItem(ls[i]), b: letterItem(ls[j]), ca: ls[i].char, cb: ls[j].char, kind: 'letter' });
  return pairs;
}

// Sprachen ohne Buchstabenkurs (sv): Laute = IPA-Einheiten (Vokal mit Länge), Verwechslungspartner aus lang.json (partners).
// Automatisch: Wortschatzwörter bis L, deren IPA sich in genau einem Partnerlaut unterscheidet; dazu kuratierte Paare (pairs.json).
const VOWEL = /^[aeiouyæøɑɛɪɔʊʉɵœʏɐə]/;
export const ipaUnits = ipa => (ipa.replace(/\([^)]*\)|[ˈˌ²¹./[\]]/g, '').match(/\P{M}\p{M}*ː?/gu) ?? [])
  .map(u => VOWEL.test(u) ? u : u.replace('ː', ''));        // Konsonantenlänge (natː) zählt nicht
const soundPartners = (a, b) => { const p = LANG().partners ?? {}; return !!(p[a]?.includes(b) || p[b]?.includes(a)); };
function findSoundPairs(L) {
  if (!LANG().partners) return [];
  const max = lessonIdx(L.id), pairs = [];
  const words = D.vocab.filter(v => lessonIdx(v.lesson) <= max && v.ipa && canPlay(v)).map(v => [v, ipaUnits(v.ipa)]);
  for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) {
    const [[va, a], [vb, b]] = [words[i], words[j]];
    if (a.length !== b.length) continue;
    const diff = a.flatMap((c, k) => c === b[k] ? [] : [k]);
    if (diff.length === 1 && soundPartners(a[diff[0]], b[diff[0]])) pairs.push({ a: va, b: vb, ca: a[diff[0]], cb: b[diff[0]], kind: 'word' });
  }
  const item = id => vocabBy(id) ?? pairWordBy(id);
  for (const [ia, ib, ca, cb, les] of D.pairs?.pairs ?? []) {
    const a = item(ia), b = item(ib);
    if (!a || !b || !canPlay(a) || !canPlay(b) || Math.max(lessonIdx(les), ...[a, b].map(x => x.lesson ? lessonIdx(x.lesson) : -1)) > max) continue;
    const p = { a, b, ca, cb, kind: 'word' };
    if (!pairs.some(q => pairKey(q) === pairKey(p))) pairs.push(p);
  }
  return pairs;
}

const finish = (el, title, again, onDone, result) => {
  setKeyHandler(null);
  if (onDone) return onDone(result);
  el.replaceChildren(h('div', { class: 'card flash' }, h('h2', {}, title),
    result.wrong.length ? h('p', {}, t('Verwechselt:') + ' ', h('span', { class: 'ka', style: 'font-size:22px' }, [...new Set(result.wrong)].join('  '))) : h('p', {}, t('Perfekt gehört! 🎉')),
    h('button', { class: 'btn primary', onclick: again }, t('Nochmal'))));
};

// focus: Set von Buchstaben, deren Paare bevorzugt werden (Problemlaute); only: Set von pairKey (Fehlerheft, der Reihe nach);
// counter(i, n): Fortschritt meldet der Aufrufer selbst (ein Zähler statt zwei, z. B. Fehlerheft)
export function pairsDrill(L, el, { n = 10, focus = null, onDone, only = null, counter = null } = {}) {
  let pool = findPairs(L);
  if (only) { pool = pool.filter(p => only.has(pairKey(p))); n = pool.length; }
  if (focus?.size) { const f = pool.filter(p => focus.has(p.ca) || focus.has(p.cb)); if (f.length) pool = f; }
  if (!pool.length) {
    el.replaceChildren(h('p', { class: 'muted' }, t('Bis zu dieser Lektion gibt es noch keine Minimalpaare.')));
    return onDone?.({ score: 0, of: 0, wrong: [] });
  }
  // Wortpaare und Paare mit neuen Buchstaben der Lektion kommen häufiger dran
  const fresh = new Set(L.letters ?? []);
  const bag = pool.flatMap(p => Array((p.kind === 'word' ? 3 : 1) + (fresh.has(p.ca) || fresh.has(p.cb) ? 2 : 0)).fill(p));
  let i = 0, score = 0, last = null; const wrong = [];
  const next = () => {
    if (i === n) return finish(el, t('{score} / {n} richtig gehört', { score, n }), () => pairsDrill(L, el, { n, focus }), onDone, { score, of: n, wrong });
    i++;
    let p; if (only) p = pool[i - 1]; else { do p = pick(bag); while (p === last && pool.length > 1); } last = p;
    const [target, other, ct, co] = Math.random() < .5 ? [p.a, p.b, p.ca, p.cb] : [p.b, p.a, p.cb, p.ca];
    play(target);
    const fb = h('div', { class: 'feedback' }), bar = h('div', { class: 'actionbar' }), cur = i;
    const go = () => { if (cur === i && el.isConnected) next(); };
    const choose = btn => btn.click();
    const opts = h('div', { class: 'options' }, shuffle([target, other]).map(o => h('button', { onclick: e => {
      if (opts.dataset.done) return; opts.dataset.done = 1;
      const ok = o === target;
      if (ok) score++; else wrong.push(`${ct}/${co}`);
      e.currentTarget.classList.add(ok ? 'ok' : 'bad');
      [...opts.children][[...opts.children].indexOf(e.currentTarget) ^ (ok ? 0 : 1)].classList.add('ok');
      log({ lesson: L.id, ex: 'listen', mode: 'pair', item: target.id, ok, sound: ct, ...(ok ? {} : { confused: `${ct}→${co}` }) });
      mistake('pair', pairKey(p), { lesson: L.id }, ok);
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      fb.replaceChildren(h('p', {}, ok ? t('✓ richtig') : t('✗ Es war das andere.')),
        h('div', { class: 'small', style: 'text-align:left' },
          h('div', { class: 'row' }, playBtn(target), t('gehört:') + ' ', unitView(target, false), glossText(target) ? ` – ${glossText(target)}` : ''),
          h('div', { class: 'row' }, playBtn(other), t('anders:') + ' ', unitView(other, false), glossText(other) ? ` – ${glossText(other)}` : ''),
          h('p', { class: 'muted' }, t('Unterschied:') + ' ', describe(ct), ' ↔ ', describe(co)),
          pairTip(ct, co) && h('p', { class: 'muted' }, '💡 ', pairTip(ct, co))));
      bar.replaceChildren(h('button', { class: 'btn primary', onclick: go }, ok && autoNext() ? t('Weiter (automatisch)') : [t('Weiter'), h('span', { class: 'keyhint' }, ' ⏎')]));
      if (ok && autoNext()) setTimeout(go, 800);
    } }, unitView(o))));
    // Tasten: 1/2 = Antwort, Leertaste = nochmal hören, nach der Antwort Enter/Leertaste = Weiter
    stepKeys(el, k => {
      if (opts.dataset.done) return (k === 'Enter' || k === 'Space') && (go(), true);
      if (k === '1' || k === '2') return choose(opts.children[+k - 1]), true;
      if (k === 'Space') return play(target), true;
    });
    counter?.(i, n);
    const card = h('div', { class: 'card flash' }, h('div', { class: 'muted' }, t('Was hörst du?') + ' ', h('span', { class: 'small keyhint' }, t('(Taste 1/2)'))),
      h('button', { class: 'btn icon', style: 'font-size:28px;margin:8px', title: t('Nochmal anhören (Leertaste)'), onclick: () => play(target) }, '🔊'),
      opts, fb, bar);
    el.replaceChildren(counter ? '' : h('div', { class: 'muted small' }, t('Paar {i} / {n}', { i, n })), card);
    showTop(el);
  };
  next();
}

// Diktat: Wort hören → mit der Bildschirmtastatur schreiben. items: feste Wortliste (sonst Lektion + frühere)
export function dictation(L, el, { n = 8, items = null, onDone, counter = null } = {}) {
  const max = lessonIdx(L.id);
  const all = D.vocab.filter(v => lessonIdx(v.lesson) <= max && canPlay(v));
  const own = all.filter(v => v.lesson === L.id);
  const list = shuffle(items ?? [...new Set([...shuffle(own).slice(0, Math.ceil(n * .6)), ...shuffle(all)])].slice(0, n));
  if (!list.length) { el.replaceChildren(h('p', { class: 'muted' }, t('Noch keine Wörter mit Audio.'))); return onDone?.({ score: 0, of: 0, wrong: [] }); }
  const known = new Set(knownLetters(L.id).map(l => l.char));
  let i = 0, text = '', checked = false, score = 0; const wrong = [];
  const typed = h('div', { class: 'typed' }), fb = h('div', { class: 'feedback' }), head = h('div', { class: 'muted small' });
  const load = () => {
    text = ''; checked = false; typed.textContent = ''; typed.className = 'typed'; fb.replaceChildren();
    if (counter) counter(i + 1, list.length); else head.textContent = t('Wort {i} / {n}', { i: i + 1, n: list.length });
    play(list[i]); showTop(el);
  };
  const onKey = k => {
    const v = list[i];
    if (k === 'Enter' || (checked && k === ' ')) {
      if (checked) { if (!el.isConnected) return; i++; return i === list.length ? finish(el, t('{score} / {n} richtig geschrieben', { score, n: list.length }), () => dictation(L, el, { n, items }), onDone, { score, of: list.length, wrong }) : load(); }
      checked = true;
      const got = [...text.trim()], exp = [...v.t], ok = text.trim() === v.t;
      // gleiche Länge: Buchstabe für Buchstabe vergleichen und Verwechslungen protokollieren
      const confused = got.length === exp.length ? exp.flatMap((c, k) => c === got[k] ? [] : [`${c}→${got[k]}`]) : [];
      if (ok) score++; else wrong.push(v.t);
      typed.className = 'typed ' + (ok ? 'ok' : 'bad');
      if (got.length === exp.length && !ok) typed.replaceChildren(...got.map((c, k) => h('span', { class: 'sl ' + (c === exp[k] ? 'ok' : 'bad') }, c)));
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      fb.replaceChildren(ok ? t('✓ richtig') + ' ' : t('✗ richtig:') + ' ', h('span', { class: 'ka', style: 'font-size:24px' }, v.t), ' ', h('span', { class: 'tr', 'data-ka': v.t }, v.translit), ' ', h('span', { class: 'ipa', 'data-ka': v.t }, v.ipa),
        ` – ${glossText(v)}`, h('span', { class: 'muted small' }, '  ' + (ok && autoNext() ? t('(weiter …)') : t('(⏎ weiter)'))));
      log({ lesson: L.id, ex: 'listen', mode: 'dictation', item: v.id, ok, typed: text, ...(confused.length ? { confused } : {}) });
      mistake('dict', v.id, { lesson: L.id }, ok);
      if (!ok) lapse(`v:${v.id}:ka`);
      else if (autoNext()) { const cur = i; setTimeout(() => cur === i && checked && onKey('Enter'), 1200); }
      return;
    }
    if (checked) return;
    text = k === 'Backspace' ? text.slice(0, -1) : text + k;
    typed.textContent = text;
  };
  const kb = keyboard(onKey, known);
  setKeyHandler(kb.physical);
  el.replaceChildren(head, h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'muted' }, t('Hör zu und schreib das Wort:')),
      h('button', { class: 'btn icon', style: 'font-size:24px', title: t('Nochmal anhören'), onclick: () => play(list[i]) }, '🔊')),
    typed, fb, kb));
  load();
}

// ---------- Satzdiktat ----------
// Vergleich ohne Satzzeichen und Mehrfach-Leerzeichen (die Bildschirmtastatur hat nur Buchstaben und Leertaste)
// Lateinschrift: Groß-/Kleinschreibung egal (Satzanfang), Apostroph zwischen Buchstaben gehört zum Wort (don't)
export const normWords = (s, keepCase = false) => (isKa() ? s.replace(/[^ა-ჿ\s]/g, ' ')
  : (keepCase ? s : s.toLowerCase()).replace(/’/g, "'").replace(/[^\p{L}\p{M}'\s]|(?<!\p{L})'|'(?!\p{L})/gu, ' ')).trim().split(/\s+/).filter(Boolean);
// Wortweise Ausrichtung (Levenshtein über Wörter): [{op: 'eq'|'sub'|'del'|'ins', exp, got}]
// del = erwartetes Wort fehlt, ins = zusätzlich getipptes Wort. Ersetzen kostet 1 bei ähnlichen Wörtern (≤ halb so viele
// Buchstaben falsch), sonst 2 – so wird „ქვია“ dem Wort „მქვია“ zugeordnet und nicht einem ganz anderen.
const lev = (a, b) => {
  a = [...a]; b = [...b];
  let r = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const q = [i];
    for (let j = 1; j <= b.length; j++) q.push(Math.min(r[j] + 1, q[j - 1] + 1, r[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    r = q;
  }
  return r[b.length];
};
export function alignWords(exp, got) {
  const m = exp.length, n = got.length, d = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => i + j));
  const sub = (a, b) => a === b ? 0 : lev(a, b) * 2 <= Math.max([...a].length, [...b].length) ? 1 : 2;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + sub(exp[i - 1], got[j - 1]));
  const ops = [];
  for (let i = m, j = n; i || j;) {
    if (i && j && d[i][j] === d[i - 1][j - 1] + sub(exp[i - 1], got[j - 1])) { ops.push({ op: exp[i - 1] === got[j - 1] ? 'eq' : 'sub', exp: exp[--i], got: got[--j] }); }
    else if (i && d[i][j] === d[i - 1][j] + 1) ops.push({ op: 'del', exp: exp[--i] });
    else ops.push({ op: 'ins', got: got[--j] });
  }
  return ops.reverse();
}

// Hörbare Sätze bis Lektion L: Dialog-/Lesetextzeilen mit Zeilen-Audio und Lektionssätze mit Audio (eigene Aufnahme),
// ab 2 Wörtern, gleicher Text nur einmal. Neue Dateien in data/dialogs|texts + data/audio/lines kommen über /api/reading von selbst dazu.
export async function sentencePool(L) {
  const R = await reading(), max = lessonIdx(L.id), seen = new Set(), out = [];
  const add = (it) => {
    const k = normWords(it.t).join(' ');
    if (lessonIdx(it.lesson) > max || lessonIdx(it.lesson) < 0 || !it.audio || normWords(it.t).length < 2 || seen.has(k)) return;
    seen.add(k); out.push(it);
  };
  for (const [kind, ps] of [[t('Dialog'), R.dialogs], [t('Text'), R.texts]]) for (const p of ps) p.lines.forEach((l, i) =>
    add({ id: `${p.id}-${i + 1}`, t: l.t, tr: l.tr, lesson: p.lesson, audio: l.audio, src: `${kind}: ${txt(p.title)}` }));
  for (const s of R.sentences) add({ id: s.id, t: s.t, tr: s.tr, trClaude: s.trClaude, trChecked: s.trChecked, lesson: s.lesson, audio: s.audio, src: t('Lektionssatz') });
  return out;
}

// Satz hören → tippen → Wort-für-Wort-Vergleich. ids: feste Satz-IDs (Fehlerheft), sonst ~60 % aus der Lektion selbst
export async function sentenceDictation(L, el, { n = 5, ids = null, onDone, counter = null } = {}) {
  const pool = await sentencePool(ids ? D.lessons.at(-1) : L);
  const own = pool.filter(s => s.lesson === L.id);
  const list = ids ? ids.map(id => pool.find(s => s.id === id)).filter(Boolean)
    : shuffle([...new Set([...shuffle(own).slice(0, Math.ceil(n * .6)), ...shuffle(pool)])].slice(0, n));
  if (!list.length) { el.replaceChildren(h('p', { class: 'muted' }, t('Bis zu dieser Lektion gibt es noch keine Sätze mit Audio.'))); return onDone?.({ score: 0, of: 0, wrong: [] }); }
  const known = new Set(knownLetters(L.id).map(l => l.char));
  let i = 0, text = '', checked = false, score = 0; const wrong = [];
  const typed = h('div', { class: 'typed', style: 'font-size:26px' }), fb = h('div', { class: 'feedback' }), head = h('div', { class: 'muted small' });
  const load = () => {
    text = ''; checked = false; typed.textContent = ''; typed.className = 'typed'; fb.replaceChildren();
    head.textContent = counter ? list[i].src : t('Satz {i} / {n}', { i: i + 1, n: list.length }) + ` · ${list[i].src}`;
    counter?.(i + 1, list.length);
    play(list[i]); showTop(el);
  };
  const onKey = k => {
    const s = list[i];
    if (k === 'Enter' || (checked && k === ' ')) {
      if (checked) { i++; return i === list.length ? finish(el, t('{score} / {n} Sätze richtig', { score, n: list.length }), () => sentenceDictation(L, el, { n, ids }), onDone, { score, of: list.length, wrong }) : load(); }
      if (!text.trim()) return;
      checked = true;
      const ops = alignWords(normWords(s.t), normWords(text)), ok = ops.every(o => o.op === 'eq');
      const bad = ops.filter(o => o.op === 'sub' || o.op === 'del').map(o => o.exp);
      // gleich lange Wörter mit höchstens 2 falschen Buchstaben: Verwechslungen wie beim Wortdiktat (→ Problemlaute; nur ka – andere Sprachen zählen Laute, nicht Buchstaben)
      const confused = !isKa() ? [] : ops.filter(o => o.op === 'sub' && [...o.exp].length === [...o.got].length && lev(o.exp, o.got) <= 2)
        .flatMap(o => { const g = [...o.got]; return [...o.exp].flatMap((c, k) => c === g[k] ? [] : [`${c}→${g[k]}`]); });
      if (ok) score++; else wrong.push(...bad);
      typed.className = 'typed ' + (ok ? 'ok' : 'bad');
      typed.replaceChildren(...ops.filter(o => o.op !== 'del').flatMap(o => [h('span', { class: 'sl ' + (o.op === 'eq' ? 'ok' : 'bad'),
        style: o.op === 'ins' ? 'text-decoration:line-through' : '', title: o.op === 'sub' ? t('richtig: {w}', { w: o.exp }) : o.op === 'ins' ? t('zu viel') : '' }, o.got), ' ']));
      const it = { ...s, translit: translit(s.t), ipa: ipaOf(s.t) }, orig = normWords(s.t, true);   // Lösung in Originalschreibung
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      fb.replaceChildren(h('div', {}, ok ? t('✓ richtig') + ' ' : t('✗ richtig:') + ' ', playBtn(it), ' ',
          h('span', { class: 'ka', style: 'font-size:22px' }, ...ops.filter(o => o.op !== 'ins').flatMap((o, k) => [h('span', { class: o.op === 'eq' ? '' : 'sl bad' }, orig[k] ?? o.exp), ' ']))),
        isKa() ? h('div', { class: 'small' }, h('span', { class: 'tr', 'data-ka': it.t }, it.translit), ' ', h('span', { class: 'ipa', 'data-ka': it.t }, it.ipa)) : '',
        h('div', {}, `„${trText(s)}“`, h('span', { class: 'muted small' }, '  ' + t('(⏎ weiter)'))));
      log({ lesson: L.id, ex: 'listen', mode: 'sentence', item: s.id, ok, typed: normWords(text).join(' '), ...(ok ? {} : { wrong: bad }), ...(confused.length ? { confused } : {}) });
      mistake('sent', s.id, { lesson: L.id }, ok);
      return;
    }
    if (checked) return;
    text = k === 'Backspace' ? text.slice(0, -1) : text + k;
    typed.textContent = text;
  };
  const kb = keyboard(onKey, known);
  setKeyHandler(kb.physical);
  el.replaceChildren(head, h('div', { class: 'card' },
    h('div', { class: 'row' }, h('span', { class: 'muted' }, t('Hör zu und schreib den ganzen Satz (Satzzeichen egal):')),
      h('button', { class: 'btn icon', style: 'font-size:24px', title: t('Nochmal anhören'), onclick: () => play(list[i]) }, '🔊')),
    typed, fb, kb));
  load();
}

// Beispiele für die Einleitung (Sprachen mit partners): die häufigsten Lautpaare der Minimalpaare bis L, z. B. „[aː]/[a] (Saat/satt)“
function soundExamples(L) {
  const by = new Map();
  for (const p of findSoundPairs(L)) {
    const k = [p.ca, p.cb].sort().join('/');
    if (!by.has(k)) by.set(k, { n: 0, ex: `[${p.ca}]/[${p.cb}] (${p.a.t}/${p.b.t})` });
    by.get(k).n++;
  }
  const top = [...by.values()].sort((a, b) => b.n - a.n).slice(0, 4);
  return top.length ? ' ' + t('Zum Beispiel: {ex}.', { ex: top.map(x => x.ex).join(', ') }) : '';
}

// Lektions-Tab „Hören“
export function listen(L, el) {
  const body = h('div');
  const pairs = isKa() || !!LANG().partners;
  const modes = [...(pairs ? [['pairs', t('Minimalpaare'), pairsDrill]] : []), ['dictation', t('Diktat'), dictation],
    ...(isA0(L.id) ? [] : [['sentence', t('Satzdiktat'), sentenceDictation]])];
  const btns = modes.map(([m, name, fn]) => h('button', { class: 'btn', 'data-m': m, onclick: () => start(m) }, name));
  const start = m => {
    btns.forEach(b => b.classList.toggle('primary', b.dataset.m === m));
    setKeyHandler(null);
    modes.find(x => x[0] === m)[2](L, body);
  };
  // Minimalpaare: Georgisch über PARTNERS (Buchstaben), andere Sprachen über partners in lang.json (Laute)
  el.append(h('p', { class: 'small muted' }, isKa() ? t('Minimalpaare: Wort oder Silbe hören und zwischen zwei sehr ähnlichen wählen (Hauch/Ejektiv, stimmhaft/stimmlos …). Diktat: Wort hören und tippen.') + (isA0(L.id) ? '' : ' ' + t('Satzdiktat: ganzen Satz hören und tippen, Fehler werden je Wort markiert.')) + ' ' + t('Mit 🐢 langsamer abspielen.')
      : (pairs ? t('Minimalpaare: Wort hören und zwischen zwei sehr ähnlichen wählen.') + soundExamples(L) + ' ' : '') + t('Diktat: hören und tippen.') + (isA0(L.id) ? '' : ' ' + t('Satzdiktat: ganzen Satz hören und tippen, Fehler werden je Wort markiert.')) + ' ' + t('Mit 🐢 langsamer abspielen.')),
    h('div', { class: 'row' }, modes.length > 1 ? btns : null, rateToggle()), body);
  start(modes[0][0]);
}

// Eigene Seite #/listen[/<Lektion>] (aus der Wiederholung): alle bisher gelernten Lektionen
export function viewListen(id) {
  const seen = D.lessons.filter(l => D.alphabet.some(a => a.lesson === l.id && P['l:' + a.char]) || D.vocab.some(v => v.lesson === l.id && P[`v:${v.id}:ka`]));
  const L = D.lessons.find(l => l.id === id) ?? seen.at(-1) ?? D.lessons[0];
  setLesson(L);
  const el = h('div');
  $app.replaceChildren(h('a', { href: '#/review' }, t('← Wiederholen')), h('h1', {}, t('Hörtraining bis {id}', { id: L.id })), el);
  listen(L, el);
}
