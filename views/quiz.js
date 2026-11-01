// Quiz: Buchstabe→Laut, Laut→Buchstabe, Wort lesen (mit Ejektiv/Hauch-Fallen); ohne Transliteration (sv): Bedeutung wählen
// und Lesen = Aussprache wählen (IPA mit Fallen: Länge vertauscht, Partnerlaute), in A0 überwiegend Lesen
// Wort falsch gelesen → Lautieren (spell.js) in der Rückmeldung, spielt am Ende auch das Wort
import { h, shuffle, pick, log } from '../util.js';
import { D, lessonIdx, knownLetters, letterBy, PARTNER, translit, LANG, isA0, glossText, txt } from '../data.js';
import { play, kaVoice } from '../audio.js';
import { lapse } from '../mistakes.js';
import { autoNext } from '../opts.js';
import { stepKeys } from '../keyboard.js';
import { ctx } from '../ctx.js';
import { t } from '../i18n.js';

// Nach der Antwort: „richtig“ + automatisch weiter (⚙) → nach ms weiter; sonst Weiter-Knopf in der Aktionsleiste
// (Enter/Leertaste), damit man bei „falsch“ die Auflösung in Ruhe liest. Ziffern 1–4 wählen eine Antwort.
function advance(el, bar, ok, ms, next) {
  let gone = false;
  const go = () => { if (!gone && el.isConnected) { gone = true; next(); } };
  if (ok && autoNext()) return setTimeout(go, ms);
  bar.replaceChildren(h('button', { class: 'btn primary wide', onclick: go }, t('Weiter'), h('span', { class: 'keyhint' }, ' ⏎')));
  stepKeys(el, k => (k === 'Enter' || k === 'Space') && (go(), true));
}
const answerKeys = (el, opts) => stepKeys(el, k => /^[1-4]$/.test(k) && opts.children[+k - 1] && (opts.children[+k - 1].click(), true));

// onDone({score, of, wrong}) statt Ergebnisseite (für „Heute“)
export function quiz(L, el, opts = {}) {
  if (!LANG().translit) return meaningQuiz(L, el, opts);
  const { onDone } = opts;
  const pool = knownLetters(L.id);
  const fresh = L.letters?.length ? L.letters.map(letterBy) : pool;
  const vs = D.vocab.filter(v => lessonIdx(v.lesson) <= lessonIdx(L.id));
  const lessonVs = D.vocab.filter(v => v.lesson === L.id);
  const N = 12; let i = 0, score = 0; const wrong = [];
  const next = () => {
    if (i === N) {
      log({ lesson: L.id, ex: 'quiz', score, of: N, wrong });
      if (onDone) return onDone({ score, of: N, wrong });
      return el.replaceChildren(h('div', { class: 'card flash' }, h('h2', {}, t('{score} / {n} richtig', { score, n: N })),
        wrong.length ? h('p', {}, t('Nochmal anschauen:') + ' ', h('span', { class: 'ka', style: 'font-size:22px' }, [...new Set(wrong)].join('  '))) : h('p', {}, t('Perfekt! 🎉')),
        h('button', { class: 'btn primary', onclick: () => { el.replaceChildren(); quiz(L, el); } }, t('Nochmal'))));
    }
    i++;
    const type = pick(['l2t', 't2l', 'word', 'word', ...(fresh.length ? ['l2t', 't2l'] : [])]);
    let q, answer, options, cls = '', item;
    if (type === 'word' && (lessonVs.length || vs.length)) {
      item = pick(Math.random() < .7 && lessonVs.length ? lessonVs : vs);
      answer = item.translit;
      const fakes = new Set();
      for (let k = 0; k < 20 && fakes.size < 3; k++) {
        const ch = [...item.t]; const idx = shuffle(ch.map((_, j) => j)).find(j => PARTNER[ch[j]]);
        if (idx == null) break;
        ch[idx] = PARTNER[ch[idx]];
        if (Math.random() < .3) { const j2 = shuffle(ch.map((_, j) => j)).find(j => j !== idx && PARTNER[ch[j]]); if (j2 != null) ch[j2] = PARTNER[ch[j2]]; }
        const f = translit(ch.join('')); if (f !== answer) fakes.add(f);
      }
      while (fakes.size < 3) { const f = pick(vs).translit; if (f !== answer) fakes.add(f); }
      q = h('div', {}, h('div', { class: 'muted' }, t('Wie liest man dieses Wort?')), h('div', { class: 'huge' }, item.t));
      options = shuffle([answer, ...fakes]);
    } else if (type === 't2l') {
      const l = pick(fresh); item = l; answer = l.char; cls = 'ka';
      const others = shuffle(pool.filter(x => x !== l)).slice(0, 3).map(x => x.char);
      if (PARTNER[l.char] && pool.some(x => x.char === PARTNER[l.char]) && !others.includes(PARTNER[l.char])) others[0] = PARTNER[l.char];
      q = h('div', {}, h('div', { class: 'muted' }, t('Welcher Buchstabe ist das?')), h('div', { style: 'font-size:36px' }, h('b', {}, l.translit), ' ', h('span', { class: 'ipa' }, l.ipa)), h('div', { class: 'small muted' }, l.sound));
      options = shuffle([answer, ...others]);
    } else {
      const l = pick(fresh); item = l; answer = l.translit;
      const others = shuffle(pool.filter(x => x !== l)).slice(0, 3).map(x => x.translit);
      if (PARTNER[l.char] && pool.some(x => x.char === PARTNER[l.char])) others[0] = letterBy(PARTNER[l.char]).translit;
      q = h('div', {}, h('div', { class: 'muted' }, t('Wie klingt dieser Buchstabe?')), h('div', { class: 'huge' }, l.char));
      options = shuffle([answer, ...new Set(others)]);
    }
    const fb = h('p', { class: 'feedback' });
    const opts = h('div', { class: 'options' }, options.map(o => h('button', { class: cls, onclick: e => {
      if (opts.dataset.done) return; opts.dataset.done = 1;
      const ok = o === answer;
      if (ok) score++; else { wrong.push(item.t ?? item.char); lapse(item.char ? 'l:' + item.char : `v:${item.id}:ka`); }
      e.target.classList.add(ok ? 'ok' : 'bad');
      [...opts.children].find(b => b.textContent === answer)?.classList.add('ok');
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      fb.replaceChildren(ok ? t('✓ richtig') : t('✗ richtig wäre:') + ' ', ok ? '' : h('b', { class: cls }, answer),
        item.t ? h('span', {}, ' – ', glossText(item), ' ', h('span', { class: 'ipa' }, item.ipa)) : '');
      const c = ctx(), spell = !ok && c.canSpell(item);
      if (spell) fb.append(c.spellView(item, c));
      else if (item.audio || kaVoice) play(item);
      advance(el, bar, ok, 900, next);
    } }, o)));
    const bar = h('div', { class: 'actionbar' });
    el.replaceChildren(h('div', { class: 'muted small' }, t('Frage {i} / {n}', { i, n: N })), h('div', { class: 'card flash' }, q, opts, fb, bar));
    answerKeys(el, opts);
  };
  next();
}

// Lesen ohne eigene Schrift (sv): welche Aussprache passt zur Schreibung? Fallen = eine (selten zwei) Lauteinheit(en)
// der richtigen IPA ersetzt – Länge vertauscht (tack [tak] / [tɑːk]), o↔å↔u-Laute, y/ü, sj-/tj-Laut, weiches/hartes g und k,
// r+Konsonant als Einzellaut. Einheiten wie in listen.js (Zeichen + Kombinationszeichen + ː), Betonungszeichen bleiben stehen.
const SWAP = {
  'ɑː': ['a'], 'a': ['ɑː'], 'eː': ['ɛ', 'iː'], 'ɛ': ['eː', 'a'], 'ɛː': ['eː', 'ɛ'], 'æː': ['ɛː', 'ɑː'], 'æ': ['ɛ', 'a'],
  'iː': ['ɪ', 'yː'], 'ɪ': ['iː', 'ʏ'], 'uː': ['oː', 'ʉː'], 'ʊ': ['uː', 'ɔ'], 'ɔ': ['oː', 'uː'], 'oː': ['uː', 'ɔ'],
  'ʉː': ['uː', 'yː', 'ɵ'], 'ɵ': ['ʉː', 'ʊ'], 'yː': ['ʉː', 'iː'], 'ʏ': ['yː', 'ɪ'], 'øː': ['œ', 'ʉː'], 'œ': ['øː', 'ɔ'], 'œː': ['øː', 'oː'],
  'ɧ': ['ɕ', 'sk'], 'ɕ': ['ɧ', 'k'], 'j': ['ɡ'], 'ɡ': ['j'], 'k': ['ɕ'], 'ɳ': ['rn'], 'ʈ': ['rt'], 'ʂ': ['rs'], 'ɖ': ['rd'], 'ɭ': ['rl'],
};
const units = ipa => ipa.match(/\P{M}\p{M}*ː?/gu) ?? [];
// Andere Sprachen (en): Fallen = Lautpartner aus lang.json (beidseitig: ɪ↔iː, θ↔s, z↔s …) statt der schwedischen SWAP
const swapFor = lang => {
  if (lang.code === 'sv') return SWAP;
  const s = {};
  for (const [a, bs] of Object.entries(lang.partners ?? {})) for (const b of bs) { (s[a] ??= []).push(b); (s[b] ??= []).push(a); }
  return s;
};
// Englisch: Betonung auf eine andere Silbe verschoben (hotel [həʊˈtɛl] → [ˈhəʊtɛl]); ˈ vor den Konsonanten vor dem Vokal
const VOW = /^[aeiouæɑɒɔəɛɜɪʊʌ]/;
function stressFakes(u) {
  const at = u.indexOf('ˈ');
  if (at < 0) return [];
  const v = u.filter((_, i) => i !== at), nuclei = v.flatMap((x, i) => VOW.test(x) && (x !== 'ə' || VOW.test(v[i + 1] ?? '')) && !VOW.test(v[i - 1] ?? '') ? [i] : []);   // nie auf Schwa (əʊ schon)
  return nuclei.map(i => i > 0 && !VOW.test(v[i - 1]) && v[i - 1] !== 'ˌ' ? i - 1 : i)
    .map(i => [...v.slice(0, i), 'ˈ', ...v.slice(i)].join('')).filter(f => f !== u.join('')).map(f => [f, 'Betonung']);
}
export function ipaFakes(ipa, n = 3, lang = LANG()) {
  // Diakritika (œ̞, ʉ̟) für die Suche in SWAP weglassen
  // j↔ɡ nur am Wortanfang (göra, gärna, god), sonst entstehen unmögliche Lautfolgen wie [bɡœːɳ]
  const S = swapFor(lang), u = units(ipa), first = u.findIndex(x => !/^[ˈˌ²¹ˇ`]$/.test(x));
  // en: Teile von Diphthongen (eɪ, əʊ, aɪ) nicht einzeln tauschen – [dæɪ] ist kein englischer Laut
  // de: Diphthonge mit unsilbischem Zweitglied (aɪ̯, aʊ̯, ɔɪ̯) ebenso – nicht aber [ɐ̯] (vokalisiertes r: Tür [tyːɐ̯] ↔ Tier)
  const diph = x => /^[ɪʊʏ]̯/.test(x ?? '');
  // … und Affrikaten mit Bindebogen (t͡s, t͡ʃ: zehn, tschüs) bleiben ganz
  const tie = x => /͡$/.test(x ?? '');
  const inDiph = i => lang.code === 'en' && VOW.test(u[i]) && (VOW.test(u[i - 1] ?? '') || VOW.test(u[i + 1] ?? '')) || diph(u[i]) || diph(u[i + 1]) || tie(u[i]) || tie(u[i - 1]);
  const spots = u.flatMap((x, i) => (S === SWAP && /^[jɡ]$/.test(x) && i !== first || inDiph(i) ? [] : S[x.replace(/\p{M}/gu, '')] ?? []).map(y => [i, x, y]));
  const out = new Map();
  if (lang.code === 'en') for (const [f, c] of shuffle(stressFakes(u)).slice(0, 1)) out.set(f, c);   // höchstens eine Betonungsfalle
  for (const [i, x, y] of shuffle(spots)) {
    if (out.size >= n) break;
    const v = [...u]; v[i] = y; const f = v.join('');
    if (f !== ipa && !out.has(f)) out.set(f, `${x}→${y}`);
  }
  // zu wenige Stellen (kurze Wörter): zwei Ersetzungen kombinieren
  for (let k = 0; k < 20 && out.size < n && spots.length > 1; k++) {
    const [a, b] = shuffle(spots); if (a[0] === b[0]) continue;
    const v = [...u]; v[a[0]] = a[2]; v[b[0]] = b[2]; const f = v.join('');
    if (f !== ipa && !out.has(f)) out.set(f, `${a[1]}→${a[2]}`);
  }
  return [...out].map(([ipa, confused]) => ({ ipa, confused }));
}

// Sprachen ohne eigene Schrift: Wort → Bedeutung bzw. Bedeutung → Wort (4 Optionen, Audio beim Auflösen), dazu Lesen
// (Wort → Aussprache, Anteil READ_A0 in A0, sonst READ). Gleiches Log wie oben, Lesefehler zusätzlich als confused ['ɑː→a'].
const READ_A0 = .65, READ = .3;
function meaningQuiz(L, el, { onDone } = {}) {
  const vs = D.vocab.filter(v => lessonIdx(v.lesson) <= lessonIdx(L.id));
  const lessonVs = D.vocab.filter(v => v.lesson === L.id);
  const N = Math.min(12, vs.length * 2); let i = 0, score = 0; const wrong = [], confused = [];
  const de = v => glossText(v);
  const readShare = isA0(L.id) ? READ_A0 : READ;
  if (vs.length < 4) return el.replaceChildren(h('p', { class: 'muted' }, t('Zu wenige Wörter für ein Quiz.')));
  const next = () => {
    if (i === N) {
      log({ lesson: L.id, ex: 'quiz', score, of: N, wrong, ...(confused.length ? { confused } : {}) });
      if (onDone) return onDone({ score, of: N, wrong });
      return el.replaceChildren(h('div', { class: 'card flash' }, h('h2', {}, t('{score} / {n} richtig', { score, n: N })),
        wrong.length ? h('p', {}, t('Nochmal anschauen:') + ' ', h('b', {}, [...new Set(wrong)].join(' · '))) : h('p', {}, t('Perfekt! 🎉')),
        h('button', { class: 'btn primary', onclick: () => { el.replaceChildren(); quiz(L, el); } }, t('Nochmal'))));
    }
    i++;
    const item = pick(Math.random() < .7 && lessonVs.length ? lessonVs : vs);
    if (item.ipa && Math.random() < readShare) { const fakes = ipaFakes(item.ipa); if (fakes.length >= 3) return readQ(item, fakes); }
    const toDe = Math.random() < .5;
    const label = toDe ? de : v => v.t;
    const others = shuffle(vs.filter(v => v !== item && label(v) !== label(item))).slice(0, 3);
    const q = toDe ? h('div', {}, h('div', { class: 'muted' }, t('Was bedeutet das?')), h('div', { class: 'huge' }, item.t))
      : h('div', {}, h('div', { class: 'muted' }, t('Wie heißt das auf {lang}?', { lang: txt(LANG().name) })), h('div', { style: 'font-size:30px' }, de(item)));
    if (toDe && (item.audio || kaVoice)) play(item);
    const fb = h('p', { class: 'feedback' });
    const opts = h('div', { class: 'options' }, shuffle([item, ...others]).map(o => h('button', { onclick: e => {
      if (opts.dataset.done) return; opts.dataset.done = 1;
      const ok = o === item;
      if (ok) score++; else { wrong.push(item.t); lapse(`v:${item.id}:ka`); }
      e.target.classList.add(ok ? 'ok' : 'bad');
      [...opts.children].find(b => b.textContent === label(item))?.classList.add('ok');
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      fb.replaceChildren(ok ? t('✓ richtig') : t('✗ richtig wäre:') + ' ', h('b', {}, item.t), ' – ', de(item), ' ', h('span', { class: 'ipa' }, item.ipa));
      if (!toDe && (item.audio || kaVoice)) play(item);
      advance(el, bar, ok, 1200, next);
    } }, label(o))));
    const bar = h('div', { class: 'actionbar' });
    el.replaceChildren(h('div', { class: 'muted small' }, t('Frage {i} / {n}', { i, n: N })), h('div', { class: 'card flash' }, q, opts, fb, bar));
    answerKeys(el, opts);
  };
  // Lesen: Schreibung zeigen (ohne Audio), Aussprache wählen; Audio erst beim Auflösen
  const readQ = (item, fakes) => {
    const fb = h('p', { class: 'feedback' }), bar = h('div', { class: 'actionbar' });
    const options = shuffle([{ ipa: item.ipa }, ...fakes]);
    const opts = h('div', { class: 'options' }, options.map(o => h('button', { class: 'ipa', onclick: e => {
      if (opts.dataset.done) return; opts.dataset.done = 1;
      const ok = o.ipa === item.ipa;
      if (ok) score++; else { wrong.push(item.t); confused.push(o.confused); lapse(`v:${item.id}:ka`); }
      e.target.classList.add(ok ? 'ok' : 'bad');
      [...opts.children].find(b => b.textContent === item.ipa)?.classList.add('ok');
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      fb.replaceChildren(ok ? t('✓ richtig') : t('✗ richtig wäre:') + ' ', ok ? '' : h('b', { class: 'ipa' }, item.ipa), ' – ', de(item), item.notes ? h('div', { class: 'small muted' }, item.notes) : '');
      if (item.audio || kaVoice) play(item);
      advance(el, bar, ok, 1500, next);
    } }, o.ipa)));
    el.replaceChildren(h('div', { class: 'muted small' }, t('Frage {i} / {n}', { i, n: N })), h('div', { class: 'card flash' },
      h('div', {}, h('div', { class: 'muted' }, t('Wie spricht man das aus?')), h('div', { class: 'huge' }, item.t)), opts, fb, bar));
    answerKeys(el, opts);
  };
  next();
}
