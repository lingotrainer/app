// Blitzlesen (#/flash-read): Leseflüssigkeit in Mkhedruli ohne Umschrift (Schwedisch: Wörter, Aussprache/IPA erst danach). Ein Wort oder eine Silbe (nur Buchstaben bis
// zur aktuellen Lektion) blitzt kurz auf, Umschrift/IPA erst nach der Antwort.
//   Hören & wählen: welche von 3 Aufnahmen war das? Ablenker = möglichst Minimalpaare (Partner aus PARTNERS).
//   Laut lesen: Wort laut lesen → aufdecken (Audio + Umschrift) → selbst bewerten, bei ✗ falsche Buchstaben antippen.
// Anzeigedauer passt sich an (richtig → kürzer, falsch → länger), getrennt je Modus in localStorage.
// Log am Ende: {ex:'flashread', mode, score, of, wrong:[Buchstaben|Wörter], confused:['კ→ქ'], items, ms, show}
// → /api/weak zählt wrong wie beim Quiz (app/logstats.mjs).
// Heute (views/today.js) nutzt pool() und run() mit { n, onDone } als kurzen Schritt nach dem Quiz.
// #/flash-read?l=<Buchstabe> (Karte „33 Buchstaben“, letters.js): nur Wörter/Silben mit diesem Buchstaben.
// Falsch gelesenes Wort → Lautieren (spell.js) statt fertiger Umschrift.
import { t } from './i18n.js';

const N = 12, MIN_MS = 250, MAX_MS = 5000, START_MS = 2500;
const MODES = { audio: t('🔊 Hören & wählen'), aloud: t('🗣 Laut lesen') };
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} };

export async function viewFlashRead($app, c) {
  const { D, h, api } = c;
  const head = [h('a', { href: '#/review' }, t('← Wiederholen')), h('h1', {}, t('⚡ Blitzlesen'))];
  $app.replaceChildren(...head, h('p', { class: 'muted' }, t('Lade …')));
  const [td, weak] = await Promise.all([api('/api/today').catch(() => ({})), api('/api/weak').catch(() => [])]);
  if (!location.hash.startsWith('#/flash-read')) return;
  const L = D.lessons.find(l => l.id === td.current) ?? D.lessons[0];
  const el = h('div');
  $app.replaceChildren(...head, el);
  const f = new URLSearchParams(location.hash.split('?')[1] ?? '').get('l');
  const focus = D.alphabet.some(l => l.char === f && D.lessons.findIndex(x => x.id === l.lesson) <= D.lessons.findIndex(x => x.id === L.id)) ? f : null;
  start(el, { ...c, L, weak: new Set(weak.map(w => w.char)), focus });
}

function start(el, c) {
  const { h, L } = c, ka = (c.D.lang?.code ?? 'ka') === 'ka';
  const mode = store('flashread.mode') in MODES ? store('flashread.mode') : 'audio';
  const pick = m => { store('flashread.mode', m); run(el, c, m); };
  el.replaceChildren(
    h('p', {}, ka ? t('Ein Wort blitzt kurz auf – ohne Umschrift. Lies es in georgischer Schrift; die Umschrift kommt erst nach der Antwort. ')
      : t('Ein Wort blitzt kurz auf. Wie spricht man es aus? Aussprache und IPA kommen erst nach der Antwort. '),
      t('Je sicherer du liest, desto kürzer wird die Anzeige.')),
    h('p', { class: 'small muted' }, t(ka ? 'Wörter und Silben bis Lektion {id}' : 'Wörter bis Lektion {id}', { id: L.id }), c.focus ? [t(' mit '), , h('span', { class: 'ka' }, c.focus)] : '', '.'),
    h('div', { class: 'options flashread-modes' }, Object.entries(MODES).map(([m, label]) =>
      h('button', { class: m === mode ? 'sel' : '', onclick: () => pick(m) }, label,
        h('div', { class: 'small muted' }, m === 'audio' ? t('Welche Aufnahme passt? 3 zur Auswahl') : t('Selbst lesen, dann hören und bewerten')),
        h('div', { class: 'small muted' }, t('Anzeige {x}', { x: fmt(Number(store('flashread.ms.' + m)) || START_MS) }))))));
}

const fmt = ms => (ms / 1000).toFixed(1).replace('.', ',') + ' s';
const keyOf = it => it.t ?? it.char;                      // Vergleichstext: Wort bzw. Buchstabe
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[s.length >> 1]) : 0; };

// Übungsmenge: Wörter (≤ 2 Wörter, kurz) und Buchstaben-Silben bis Lektion L, die man anhören kann.
// Gewichte: aktuelle Lektion ×3, neue Buchstaben der Lektion / Problemlaute ×2, Silben in A0 häufiger.
export function pool(c) {
  const { D, L, weak, letterItem, canPlay, focus } = c;
  const idx = id => D.lessons.findIndex(l => l.id === id), max = idx(L.id);
  const fresh = new Set([...(L.letters ?? []), ...weak, ...(focus ? [focus] : [])]);
  const words = D.vocab.filter(v => idx(v.lesson) <= max && canPlay(v) && v.t.length <= 14 && v.t.split(' ').length <= 2);
  const letters = D.alphabet.filter(l => idx(l.lesson) <= max).map(l => letterItem(l)).filter(canPlay);
  const a0 = /(^|-)A0-/.test(L.id);
  const w = it => (it.lesson === L.id ? 3 : 1) + ([...keyOf(it)].some(ch => fresh.has(ch)) ? 2 : 0);
  const bag = [...words.flatMap(v => Array(w(v)).fill(v)), ...letters.flatMap(l => Array(a0 ? w(l) : 1).fill(l))];
  // Schwerpunkt-Buchstabe: nur Items mit ihm, sofern es mindestens 3 gibt (sonst zählt er wie ein Problemlaut ×2)
  const withF = focus ? bag.filter(it => keyOf(it).includes(focus)) : [];
  return { words, letters, bag: new Set(withF).size >= 3 ? withF : bag };
}

// Abstand zweier Texte: Editierdistanz, Ersetzung durch Verwechslungspartner kostet nur 0,5
function dist(a, b, partners) {
  a = [...a]; b = [...b];
  let row = b.map((_, j) => j + 1); row.unshift(0);
  for (let i = 1; i <= a.length; i++) {
    const nr = [i];
    for (let j = 1; j <= b.length; j++) {
      const sub = a[i - 1] === b[j - 1] ? 0 : partners(a[i - 1], b[j - 1]) ? .5 : 1;
      nr[j] = Math.min(row[j] + 1, nr[j - 1] + 1, row[j - 1] + sub);
    }
    row = nr;
  }
  return row[b.length];
}
const isPartner = PARTNERS => (x, y) => !!(PARTNERS[x]?.includes(y) || PARTNERS[y]?.includes(x));

// 2 Ablenker gleicher Art (Wort/Silbe) mit möglichst kleinem Abstand, gleiche Schreibung ausgeschlossen
function distractors(target, P, c) {
  const near = isPartner(c.PARTNERS);
  const cand = (target.t ? P.words : P.letters).filter(x => keyOf(x) !== keyOf(target));
  return cand.map(x => [x, dist(keyOf(target), keyOf(x), near) + Math.random() * .4])
    .sort((a, b) => a[1] - b[1]).slice(0, 2).map(([x]) => x);
}

// Was wurde verwechselt? Gleich lang → abweichende Buchstaben des Ziels (+ Paar), sonst das ganze Wort
function misread(target, chosen) {
  const a = [...keyOf(target)], b = [...keyOf(chosen)];
  if (a.length !== b.length) return { wrong: [keyOf(target)], confused: [] };
  const d = a.flatMap((ch, i) => ch === b[i] ? [] : [i]);
  return { wrong: d.map(i => a[i]), confused: d.map(i => `${a[i]}→${b[i]}`) };
}

// n Items; onDone(result) statt Abschlusskarte (Heute), counter(i, n) statt eigenem Zähler (wie pairsDrill)
export function run(el, c, mode, { n = N, onDone = null, counter = null } = {}) {
  const { h, log, play, playBtn, shuffle, setKeyHandler, L, translit } = c;
  const P = pool(c);
  // Hören & wählen braucht 2 Ablenker gleicher Art → nur Wörter bzw. Silben, von denen es mindestens 3 gibt; sonst Laut lesen
  if (mode === 'audio') {
    const bag = P.bag.filter(it => (it.t ? P.words : P.letters).length >= 3);
    if (bag.length) P.bag = bag; else mode = 'aloud';
  }
  if (P.bag.length < 3) {
    el.replaceChildren(h('p', { class: 'muted' }, t('Bis zu dieser Lektion gibt es noch zu wenig Wörter mit Audio.')));
    return onDone?.({ score: 0, of: 0, wrong: [], mode });
  }
  let ms = Number(store('flashread.ms.' + mode)) || START_MS;
  const ms0 = ms;
  let i = 0, score = 0, last = null, timer = null;
  const wrong = [], confused = [], items = [], rts = [];
  const setMs = f => { ms = Math.round(Math.min(MAX_MS, Math.max(MIN_MS, ms * f))); store('flashread.ms.' + mode, ms); };
  // Anzeigedauer je Wort: Grundwert gilt für 4 Buchstaben, kürzere/längere entsprechend
  const showFor = it => Math.round(ms * (.5 + [...c.speakText(it)].length / 8));
  const reveal = it => h('div', { class: 'flashread-reveal' },
    h('span', { class: 'ka', style: 'font-size:30px' }, c.speakText(it)), ' ',
    h('span', { class: 'tr', 'data-ka': c.speakText(it) }, it.translit ? (it.t ? it.translit : translit(c.speakText(it))) : ''), ' ',
    h('span', { class: 'ipa small', 'data-ka': c.speakText(it) }, it.t ? it.ipa ?? '' : it.ipa + (it.type === 'vowel' ? '' : 'ɑ')),
    c.gloss(it).length ? h('div', { class: 'small muted' }, c.glossText(it)) : null);
  const spelled = it => h('div', {}, c.spellView(it, c), c.gloss(it).length ? h('div', { class: 'small muted' }, c.glossText(it)) : null);

  const next = () => {
    clearTimeout(timer);
    if (i === n) return done();
    i++;
    let target; do target = c.pick(P.bag); while (keyOf(target) === last && P.bag.length > 3); last = keyOf(target);
    items.push(keyOf(target));
    const word = h('div', { class: 'ka flashread-word' }, c.speakText(target));
    const stage = h('div', { class: 'flashread-stage' }, word);
    const t0 = performance.now();
    const hide = () => word.classList.add('gone');
    timer = setTimeout(hide, showFor(target));
    const card = h('div', { class: 'card flash' }, stage);
    counter?.(i, n);
    const status = h('div', { class: 'row small muted', style: 'justify-content:space-between' },
      h('span', {}, counter ? '' : `${i} / ${n}`), h('span', {}, t('Anzeige {x}', { x: fmt(showFor(target)) })));
    el.replaceChildren(status, card);
    (mode === 'audio' ? askAudio : askAloud)(target, card, word, t0, hide);
  };

  const result = (ok, rt, err) => {
    clearTimeout(timer);
    rts.push(rt);
    if (ok) { score++; if (rt < 2.5 * ms + 3000) setMs(.85); }   // zu langes Zögern macht nicht schneller
    else { setMs(1.3); wrong.push(...err.wrong); confused.push(...err.confused); }
  };

  // Hören & wählen: Antippen spielt die Aufnahme und wählt sie aus, „Antworten“ bestätigt (Tasten 1–3, Enter)
  function askAudio(target, card, word, t0, hide) {
    const opts = shuffle([target, ...distractors(target, P, c)]);
    let sel = null, answered = false;
    const fb = h('div', { class: 'feedback' });
    const choose = k => { if (answered) return; sel = k; play(opts[k]); [...box.children].forEach((b, j) => b.classList.toggle('sel', j === k)); ok.disabled = false; };
    const box = h('div', { class: 'options flashread-opts' }, opts.map((o, k) => h('button', { onclick: () => choose(k) }, t('🔊 {k}', { k: k + 1 }))));
    const ok = h('button', { class: 'btn primary', disabled: true, onclick: () => answer() }, t('Antworten'));
    const answer = () => {
      if (answered || sel == null) return; answered = true;
      const chosen = opts[sel], good = chosen === target, rt = performance.now() - t0;
      result(good, rt, good ? null : misread(target, chosen));
      hide(); word.classList.remove('gone'); word.classList.add('shown');
      [...box.children].forEach((b, j) => {
        b.classList.add(opts[j] === target ? 'ok' : j === sel ? 'bad' : 'dim');
        b.replaceChildren(h('span', { class: 'ka' }, c.speakText(opts[j])), h('div', { class: 'small tr' }, opts[j].t ? opts[j].translit : translit(c.speakText(opts[j]))));
        b.onclick = () => play(opts[j]);
      });
      ok.remove();
      fb.className = 'feedback ' + (good ? 'ok' : 'bad');
      fb.replaceChildren(h('p', {}, good ? t('✓ richtig – {x}', { x: fmt(rt) }) : t('✗ Das war die andere Aufnahme.')), good || !c.canSpell(target) ? reveal(target) : spelled(target),
        h('button', { class: 'btn primary', onclick: next }, t('Weiter')));
      setKeyHandler(e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); } });
    };
    card.append(h('div', { class: 'muted small' }, t('Welche Aufnahme ist das? (antippen = anhören)')), box, ok, fb);
    setKeyHandler(e => {
      if (/^[1-3]$/.test(e.key)) choose(+e.key - 1);
      else if (e.key === 'Enter') { e.preventDefault(); answer(); }
    });
  }

  // Laut lesen: aufdecken (Leertaste) → Audio + Umschrift → ✓ (1) / ✗ (2), bei ✗ falsche Buchstaben antippen
  function askAloud(target, card, word, t0, hide) {
    const fb = h('div', { class: 'feedback' });
    let rt = 0;
    const open = () => {
      if (rt) return; rt = performance.now() - t0;
      clearTimeout(timer); word.classList.remove('gone'); word.classList.add('shown');
      play(target);
      btn.remove(); hint.remove();
      fb.replaceChildren(h('div', { class: 'row', style: 'justify-content:center' }, reveal(target), playBtn(target)),
        h('div', { class: 'row', style: 'justify-content:center;gap:8px;margin-top:10px' },
          h('button', { class: 'btn primary', onclick: () => rate(true) }, t('✓ richtig')),
          h('button', { class: 'btn', onclick: () => rate(false) }, t('✗ falsch'))));
      setKeyHandler(e => { if (e.key === '1') rate(true); else if (e.key === '2') rate(false); });
    };
    const rate = good => {
      if (good) { result(true, rt); return next(); }
      // Welche Buchstaben? Antippen markiert; ohne Auswahl zählt das ganze Wort. Ohne Buchstabenkurs (sv) gleich weiter.
      const marked = new Set(), chars = [...keyOf(target)].filter(ch => c.letterBy(ch));
      if (!chars.length) { result(false, rt, { wrong: [keyOf(target)], confused: [] }); return next(); }
      fb.replaceChildren(c.canSpell(target) ? spelled(target) : reveal(target), h('p', { class: 'small' }, t('Welche Buchstaben hast du falsch gelesen? (optional)')),
        h('div', { class: 'row flashread-chips', style: 'justify-content:center;gap:6px' }, chars.map(ch => h('button', { class: 'btn ka', onclick: e => {
          marked.has(ch) ? marked.delete(ch) : marked.add(ch); e.currentTarget.classList.toggle('bad');
        } }, ch))),
        h('button', { class: 'btn primary', style: 'margin-top:10px', onclick: () => {
          result(false, rt, { wrong: marked.size ? [...marked] : [keyOf(target)], confused: [] }); next();
        } }, t('Weiter')));
      setKeyHandler(e => { if (e.key === 'Enter') fb.querySelector('.btn.primary').click(); });
    };
    const btn = h('button', { class: 'btn primary', style: 'margin-top:12px', onclick: open }, t('Laut gelesen – aufdecken'));
    const hint = h('div', { class: 'muted small' }, t('Lies das Wort laut, dann aufdecken.'));
    card.append(hint, btn, fb);
    setKeyHandler(e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); open(); } });
  }

  function done() {
    setKeyHandler(null);
    log({ lesson: L.id, ex: 'flashread', mode, score, of: n, wrong, confused, items, ms: median(rts), show: ms });
    if (onDone) return onDone({ score, of: n, wrong, mode });
    const letters = [...new Set(wrong.filter(x => [...x].length === 1))];
    el.replaceChildren(h('div', { class: 'card flash' },
      h('h2', {}, t('{score} / {n} richtig', { score, n })),
      h('p', {}, t('Antwortzeit (Median): {a} · Anzeige jetzt {b}', { a: fmt(median(rts)), b: fmt(ms) }),
        ms < ms0 ? t(' ⚡ schneller als vorher') : ms > ms0 ? t(' – etwas langsamer, das ist ok') : ''),
      letters.length ? h('p', {}, t('Unsicher bei: '), h('span', { class: 'ka', style: 'font-size:22px' }, letters.join('  '))) : null,
      wrong.some(x => [...x].length > 1) ? h('p', { class: 'small muted' }, t('Falsch gelesene Wörter: '), h('span', { class: 'ka' }, [...new Set(wrong.filter(x => [...x].length > 1))].join(', '))) : null,
      h('div', { class: 'row', style: 'justify-content:center;gap:8px' },
        h('button', { class: 'btn primary', onclick: () => run(el, c, mode, { n }) }, t('Nochmal')),
        h('button', { class: 'btn', onclick: () => start(el, c) }, t('Modus wechseln')))));
  }
  next();
}
