// Zahlentrainer (#/numbers/<modus>/<bereich>): Ziffer → Wort tippen, Wort → Ziffer, Hören → Ziffer, Uhrzeit und Preise.
// Zahlwörter aus ../numbers.js (Georgisch, Zwanzigersystem) bzw. dem Generator der Zielsprache (langmods.js: numbers-sv.js,
// numbers-de.js, numbers-en.js – mit variants, clockVariants, priceVariants, money, hints()), Log: ex 'numbers' {item, mode, ok}.
import { h, pick, log, toast, $app, url } from '../util.js';
import { D, vocabBy, translit, isKa, LANG, txt } from '../data.js';
import { kaVoice } from '../audio.js';
import { keyboard, setKeyHandler } from '../keyboard.js';
import { setLesson } from '../opts.js';
import * as KA from '../numbers.js';
import * as SV from '../numbers-sv.js';
import { mistake } from '../mistakes.js';
import { langMod } from '../langmods.js';
import { t, LOCALE } from '../i18n.js';

const MODES = {
  write: t('Ziffer → Wort'), read: t('Wort → Ziffer'), listen: t('Hören → Ziffer'), clock: t('Uhrzeit'), price: t('Preise'),
};
const RANGES = [20, 100, 1000, 10000];
const ROUND = 10;
// Generator der Lernsprache; sv/de/en kennen gleichwertige Schreibweisen (tjugoett/tjugoen, hundert/einhundert, a hundred) → variants, t.answers
const N = () => langMod('numbers')?.gen ?? SV;
const parts = n => N().parts(n), word = n => N().word(n), hyphenated = n => N().hyphenated(n), formula = n => N().formula(n);
const clock = hr => N().clock(hr), price = (a, b) => N().price(a, b);
// Regel-Lektion und Bereiche je Sprache
const RULES = () => { const m = langMod('numbers'); return m ? { lesson: m.rule, ranges: m.ranges } : { lesson: null, ranges: RANGES }; };

// IPA wie scripts/lib.mjs → makeTranslit (ვ nach Konsonant = Lippenrundung)
function ipa(s) {
  if (!isKa()) return D.vocab.find(v => v.t === s)?.ipa ?? '';   // sv: IPA nur für Grundformen (Wiktionary)
  const map = Object.fromEntries(D.alphabet.map(l => [l.char, l]));
  const cons = c => map[c] && map[c].type !== 'vowel';
  return [...s].map((c, i, a) => c === 'ვ' && cons(a[i - 1]) ? 'ʷ' : map[c]?.ipa ?? c).join('');
}
const kaLine = (ka, size = 30) => h('div', {}, h('span', { class: 'ka', style: `font-size:${size}px` }, ka), ' ',
  isKa() ? h('span', { class: 'tr', 'data-ka': ka }, translit(ka)) : '', ' ', ipa(ka) ? h('span', { class: 'ipa', 'data-ka': ka }, ipa(ka)) : '');

// Hörbeispiel: ganze Zahl über eine georgische Browser-Stimme, sonst die Aufnahmen der Bausteine nacheinander
// (z. B. 37 → ოცი + ჩვიდმეტი). Das ist NICHT die echte Aussprache von ოცდაჩვიდმეტი, nur eine Hilfe.
let chain = null;
const chainPlay = files => {
  let rate = 1; try { rate = Number(localStorage.getItem('rate')) || 1; } catch {}
  const next = i => {
    if (i >= files.length) return;
    chain = new Audio(url('/audio/' + files[i])); chain.playbackRate = rate;
    chain.onended = () => setTimeout(() => next(i + 1), 120);
    chain.play().catch(() => {});
  };
  next(0);
};
// sv/de/en: TTS-Datei je Zahl bis 100 (sv auch Hunderter und 1000) (D.numAudio, scripts/numbers-audio.mjs); sonst Browser-Stimme
// (ganzer Satz bei Uhrzeit/Preis), ohne Stimme als Kette der Bausteine (2347 → två · tusen · trehundra · fyrtiosju).
function saySv(text, ns) {
  const A = D.numAudio ?? {};
  if (ns.length === 1 && text === N().word(ns[0]) && A[ns[0]]) { chainPlay([A[ns[0]]]); return 'file'; }
  if (kaVoice) {
    const u = new SpeechSynthesisUtterance(text); u.voice = kaVoice; u.lang = kaVoice.lang; u.rate = .8; speechSynthesis.speak(u);
    return 'voice';
  }
  const files = ns.flatMap(n => N().chunks(n)).map(n => A[n]);
  if (!files.length || files.some(f => !f)) { toast(t('Keine Aufnahme für diese Zahl.')); return null; }
  chainPlay(files);
  return 'chain';
}
function say(text, ns) {
  speechSynthesis?.cancel(); chain?.pause();
  if (!isKa()) return saySv(text, ns);
  if (kaVoice) {
    const u = new SpeechSynthesisUtterance(text); u.voice = kaVoice; u.lang = kaVoice.lang; u.rate = .8; speechSynthesis.speak(u);
    return 'voice';
  }
  const files = ns.flatMap(n => parts(n).filter(p => p.n != null).flatMap(p => p.ids)).map(id => vocabBy(id)?.audio);
  if (!files.length || files.some(f => !f)) { toast(t('Keine Aufnahme für diese Zahl.')); return null; }
  chainPlay(files);
  return 'chain';
}
const audioHint = () => !isKa() ? '' : kaVoice ? '' : h('p', { class: 'small muted' },
  t('🔊 spielt die Bausteine einzeln (z. B. ოცი + ჩვიდმეტი für 37) – Aufnahmen der Grundzahlen, nicht die zusammengesetzte Aussprache.'));

// Aufgabe erzeugen: {item (Log), prompt (Anzeige), answer (ka bzw. Ziffer), ns (enthaltene Zahlen)}
// fixed = item einer früheren Aufgabe (Fehlerheft: '37', '5:00', '12,50')
const rnd = max => Math.floor(Math.random() * (max + 1));
function task(mode, range, fixed) {
  if (mode === 'clock') {
    const hr = fixed ? parseInt(fixed) : 1 + rnd(11);
    if (!isKa()) return { item: `${hr}:00`, prompt: t('Es ist {hr} Uhr.', { hr }), big: `${hr}:00`, answer: clock(hr), answers: N().clockVariants(hr), ns: [hr] };
    return { item: `${hr}:00`, prompt: t('Es ist {hr} Uhr.', { hr }), big: `${hr}:00`, answer: clock(hr), ns: hr === 1 ? [] : [hr],
      note: hr === 1 ? t('1 Uhr sagt man mit der Ordinalzahl: პირველი საათია („die erste Stunde ist es“).') : null };
  }
  if (mode === 'price' && !isKa()) {   // ganze Kronen, Euro bzw. Pfund (sv: Öre gibt es nicht mehr als Münze)
    const kr = fixed ? parseInt(fixed) : 1 + rnd(Math.min(range, 1000) - 1);
    return { item: String(kr), prompt: t('Sag den Preis:'), big: N().money(kr), answer: price(kr), answers: N().priceVariants(kr), ns: [kr] };
  }
  if (mode === 'price') {
    const [fl, ft] = fixed ? fixed.split(',').map(Number) : [];
    const lari = fixed ? fl : rnd(Math.min(range, 1000));
    const tetri = fixed ? ft : range <= 20 ? pick([0, 0, 10, 20, 50]) : pick([0, 0, rnd(9) * 10, rnd(99)]);
    const tt = lari || tetri ? tetri : 50;
    return { item: `${lari},${String(tt).padStart(2, '0')}`, prompt: t('Sag den Preis:'), big: `${lari},${String(tt).padStart(2, '0')} ₾`,
      answer: price(lari, tt), ns: [lari, tt].filter(Boolean) };
  }
  const n = fixed ? Number(fixed) : rnd(range);
  return { item: String(n), n, answer: mode === 'write' ? word(n) : String(n), ns: [n], ...(mode === 'write' && !isKa() ? { answers: N().variants(n) } : {}) };
}

// Zerlegung als Tabelle: Glied, Wert, Erklärung
function explain(ns) {
  return ns.map(n => h('div', { class: 'num-explain' },
    h('div', {}, h('b', {}, n), ' = ', h('span', { class: 'ka', style: 'font-size:22px' }, hyphenated(n)), '  ', h('span', { class: 'muted' }, formula(n))),
    h('table', { class: 'small' }, parts(n).filter(p => p.n != null).map(p => h('tr', {},
      h('td', { class: 'ka' }, p.t === p.full ? p.full : `${p.t}(${p.full.slice(p.t.length)})`),
      h('td', {}, p.n), h('td', { class: 'muted' }, p.gloss ?? '')))),
    !isKa() && N().variants(n).length > 1 ? h('div', { class: 'small muted' }, t('Auch richtig:') + ' ', N().variants(n).slice(1).join(', ')) : ''));
}
// sv/de: Groß/klein und Satzzeichen egal, bei Zahlwörtern auch Leerzeichen (tvåtusen trehundra)
const normSv = (s, mode) => { const x = s.toLowerCase().replace(/[.!,]/g, '').replace(/\s+/g, ' ').trim(); return mode === 'write' ? x.replace(/[\s-]/g, '') : x; };
const right = (tk, given, mode) => tk.answers ? tk.answers.some(a => normSv(a, mode) === normSv(given, mode)) : given === tk.answer;

export function viewNumbers(modeArg, rangeArg) {
  setLesson(null);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('numbers') ?? '{}'); } catch {}
  const mode = MODES[modeArg] ? modeArg : saved.mode ?? 'write';
  const R = RULES(), range = R.ranges.includes(+rangeArg) ? +rangeArg : R.ranges.includes(saved.range) ? saved.range : 100;
  if (!langMod('numbers')) return $app.replaceChildren(h('a', { href: '#/review' }, t('← Wiederholen')), h('h1', {}, t('Zahlentrainer')),
    h('p', { class: 'card muted' }, t('Für diese Sprache gibt es noch keinen Zahlentrainer.')));
  try { localStorage.setItem('numbers', JSON.stringify({ mode, range })); } catch {}
  const go = (m, r) => location.hash = `#/numbers/${m}/${r}`;

  const el = h('div');
  $app.replaceChildren(
    h('a', { href: '#/review' }, t('← Wiederholen')),
    h('h1', {}, t('Zahlentrainer')),
    isKa() ? h('p', { class: 'muted small' }, t('Georgisch zählt in Zwanzigern: 37 = ოც-და-ჩვიდმეტი „zwanzig und siebzehn“. Regeln:') + ' ',
      h('a', { href: '#/lesson/A1-05' }, 'A1-05'), ' (g-zahlen).')
      : h('p', { class: 'muted small' }, N().hints().intro + ' ', h('a', { href: '#/lesson/' + R.lesson }, R.lesson), ` (${N().hints().grammar}).`),
    h('div', { class: 'tabs' }, Object.entries(MODES).map(([m, label]) =>
      h('button', { class: m === mode ? 'on' : '', onclick: () => go(m, range) }, label))),
    mode === 'clock' ? '' : h('div', { class: 'row small' }, t('Bereich:'), R.ranges.map(r =>
      h('button', { class: 'btn' + (r === range ? ' primary' : ''), onclick: () => go(mode, r) }, t('bis {n}', { n: r.toLocaleString(LOCALE === 'de' ? 'de-DE' : LOCALE) })))),
    el,
    isKa() ? h('p', { class: 'small muted' }, t('Hinweis: Formen über 100 (ას ერთი, ორი ათას ხუთი …) folgen der Regel „vorderes Glied ohne -ი, getrennt geschrieben“ –') + ' ',
      t('nach Wiktionary belegt sind 0–99, die Hunderter und ათასი; die Zusammensetzungen darüber sind noch ungeprüft.'))
      : h('p', { class: 'small muted' }, N().hints().note));
  drill(el, mode, range);
}

// Runde aus n Aufgaben; mit onDone({score, of, wrong}) statt Ergebniskarte (Heute-Ablauf). Auch ohne eigene Seite nutzbar.
// items: feste Aufgaben (Fehlerheft), dann n = Anzahl
export function drill(el, mode, range, { n = ROUND, onDone, items, counter = null } = {}) {
  if (items) n = items.length;
  const typed = mode === 'write' || mode === 'clock' || mode === 'price';
  let i = 0, score = 0, tk, checked, text;
  const wrong = [];
  const prompt = h('div'), fb = h('div', { class: 'feedback' });
  const out = typed ? h('div', { class: 'typed' }) : h('input', { class: 'typed num-input', inputmode: 'numeric', autocomplete: 'off', placeholder: t('Ziffern …') });
  const count = h('div', { class: 'muted small' });

  const load = () => {
    if (i === n) return done();
    tk = task(mode, range, items?.[i]); checked = false; text = '';
    if (counter) counter(i + 1, n); else count.textContent = t('{i} / {n} · {score} richtig', { i: i + 1, n, score });
    out.className = out.className.replace(/ (ok|bad)/g, '');
    fb.replaceChildren();
    if (typed) out.textContent = ''; else { out.value = ''; out.disabled = false; setTimeout(() => out.focus()); }
    if (mode === 'read') prompt.replaceChildren(h('div', { class: 'muted small' }, t('Welche Zahl ist das?')), kaLine(word(tk.n), 34));
    else if (mode === 'listen') {
      prompt.replaceChildren(h('div', { class: 'muted small' }, t('Hör zu und tipp die Zahl:')),
        h('button', { class: 'btn primary', onclick: () => say(word(tk.n), tk.ns) }, t('🔊 Nochmal hören')), audioHint());
      say(word(tk.n), tk.ns);
    } else prompt.replaceChildren(h('div', { class: 'muted small' }, tk.prompt ?? t('Schreib auf {lang}:', { lang: txt(LANG().name) || 'Georgisch' })),
      h('div', { style: 'font-size:40px;font-weight:600' }, tk.big ?? tk.n));
  };

  const check = () => {
    if (checked) { i++; return load(); }
    const given = typed ? text.trim().replace(/\s+/g, ' ') : out.value.trim().replace(/[.\s]/g, '');
    if (!given) return;
    checked = true;
    const ok = right(tk, given, mode);
    if (ok) score++; else wrong.push(tk.item);
    out.className += ok ? ' ok' : ' bad';
    if (!typed) out.disabled = true;
    const ka = mode === 'write' || mode === 'read' || mode === 'listen' ? word(tk.n) : tk.answer;
    fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
    fb.replaceChildren(
      h('div', {}, ok ? t('✓ richtig') : t('✗ richtig:') + ' ', ok ? null : (typed ? '' : h('b', {}, tk.answer, ' = '))),
      kaLine(ka, 26),
      h('button', { class: 'btn icon', title: t('Anhören'), onclick: () => say(ka, tk.ns) }, '🔊'),
      ...explain(tk.ns),
      tk.note ? h('p', { class: 'small' }, tk.note) : '',
      h('div', { class: 'muted small' }, t('(⏎ weiter)')));
    log({ ex: 'numbers', item: tk.item, mode, ok, range, ...(ok ? {} : { typed: given }) });
    mistake('num', `${mode}:${tk.item}`, { mode, range, item: tk.item }, ok);
  };

  const done = () => {
    setKeyHandler(null);
    if (onDone) return onDone({ score, of: n, wrong });
    el.replaceChildren(h('div', { class: 'card flash' }, h('h2', {}, t('{score} / {n} richtig', { score, n })),
      wrong.length ? h('p', {}, t('Nochmal anschauen:') + ' ', wrong.join(' · ')) : h('p', {}, t('Perfekt! 🎉')),
      h('button', { class: 'btn primary', onclick: () => drill(el, mode, range) }, t('Nochmal'))));
  };

  const card = h('div', { class: 'card' }, counter ? '' : count, prompt, out, fb);
  if (typed) {
    const onKey = k => {
      if (k === 'Enter') return check();
      if (checked) return;
      text = k === 'Backspace' ? text.slice(0, -1) : text + k;
      out.textContent = text;
    };
    const kb = keyboard(onKey, new Set(D.alphabet.map(l => l.char)));
    setKeyHandler(kb.physical);
    card.append(kb, isKa() ? h('p', { class: 'small muted' }, t('Leerzeichen zwischen Hundertern/Tausendern und dem Rest (ას ერთი);') + ' ',
      mode === 'price' ? t('Preis: … ლარი და … თეთრი.') : mode === 'clock' ? t('Uhrzeit: … საათია.') : '')
      : h('p', { class: 'small muted' }, N().hints()[mode === 'price' || mode === 'clock' ? mode : 'write']));
  } else {
    out.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); check(); } });
    setKeyHandler(e => { if (checked && e.key === 'Enter') { e.preventDefault(); check(); } });
    card.append(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'btn primary', onclick: check }, t('Prüfen ⏎'))));
  }
  el.replaceChildren(card);
  load();
}
