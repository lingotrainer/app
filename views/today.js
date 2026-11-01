// „Heute“: geführter ~30-Minuten-Ablauf. Wiederholen → Lektion → (A1+: Anwenden) → Hören → (optional: Blitzlesen)
// → Problemlaute → Sprechen → (ab A1-04, optional: Zahlen) → Abschluss.
// In A0 kürzer: Wiederholen → Schreiben → Lernen + Quiz → Blitzlesen → Hören → Sprechen; Schwedisch-A0 (sv-A0-…, Leseregeln)
// ohne Schreiben, Hören mit kurzem Diktat, Sprechen mit Wörtern.
// Zeitbudget (R7): Schrittdauern aus der gemessenen Lernzeit (/api/today → steps), was nicht mehr in die ~30 min passt
// (bzw. alles nach 30 min aktiver Zeit), wird „optional“ und kommt zuletzt. #/today/kurz = Kurzrunde (Wiederholen + Hören).
import { h, api, log, md, shuffle, $app } from '../util.js';
import { D, P, lessonIdx, letterBy, letterItem, isKa, isA0, LANG } from '../data.js';
import { me } from '../account.js';
import { writing } from '../writing.js';
import { pool as flashPool, run as flashRun } from '../flashread.js';
import { ctx } from '../ctx.js';
import { setLesson } from '../opts.js';
import { canPlay } from '../audio.js';
import { dueKeys, cardsFor, isNew, mixQueue } from '../srs.js';
import { secToday, setStep, GOAL } from '../timer.js';
import { setKeyHandler, stepKeys } from '../keyboard.js';
import { flashcards } from './flashcards.js';
import { quiz } from './quiz.js';
import { pairsDrill, dictation, findPairs } from './listen.js';
import { speakList } from './speak.js';
import { weakDrill } from './weak.js';
import { cloze, build } from './cloze.js';
import { dialogDrill } from './dialog.js';
import { formsDrill, hasForms } from './forms.js';
import { drill as numbersDrill } from './numbers.js';
import { langMod } from '../langmods.js';
import { reading } from './read.js';
import { runMistakes } from './mistakes.js';
import { dueErrs } from '../mistakes.js';
import { t } from '../i18n.js';

const pct = r => r?.of ? `${r.score} / ${r.of} (${Math.round(100 * r.score / r.of)} %)` : '–';
const dayKey = () => new Date().toLocaleDateString('sv');
const dayNum = d => Math.round(Date.parse(d) / 864e5);
const daysSince = d => d ? dayNum(dayKey()) - dayNum(d) : Infinity;
const errRate = s => s?.n >= 5 ? 1 - s.ok / s.n : 0;       // Fehlerquote der letzten 14 Tage, erst ab 5 Versuchen

const ERR_MAX = 8;   // Fehlerkarten im Schritt Wiederholen (~5 min)
const APPLY = { cloze: t('Lückentext + Satzbau'), dialog: t('Dialog'), forms: t('Formen') };
const NUM_MODES = { write: t('Ziffer → Wort'), read: t('Wort → Ziffer'), listen: t('Hören → Ziffer') };

// Tagesplan (einmal pro Tag festgelegt, damit Neuladen nichts umwirft):
// apply = Übung nach dem Quiz (nur ab A1): nach Tag rotierend; hat eine Übung ≥ 30 % Fehler und war nicht gestern/heute dran, die.
// numbers = Zahlentrainer ab A1-04 (sv: sv-A1-04): wenn ≥ 7 Tage nicht geübt oder Fehlerquote ≥ 30 %.
async function makePlan(L, info) {
  const ex = info.ex ?? {}, kinds = [];
  if (!isA0(L.id)) {
    if (L.sentences?.length) kinds.push('cloze');
    const R = await reading().catch(() => ({ dialogs: [] }));
    if (R.dialogs.some(d => d.lesson === L.id)) kinds.push('dialog');
    if (hasForms(L)) kinds.push('forms');
  }
  const err = { cloze: Math.max(errRate(ex.cloze), errRate(ex.build)), dialog: errRate(ex.dialog), forms: errRate(ex.forms) };
  const last = { cloze: [ex.cloze?.last, ex.build?.last].filter(Boolean).sort().at(-1), dialog: ex.dialog?.last, forms: ex.forms?.last };
  const today = dayNum(dayKey());
  let apply = kinds.length ? kinds[today % kinds.length] : null;
  const weakest = [...kinds].sort((a, b) => err[b] - err[a])[0];
  if (weakest && err[weakest] >= .3 && daysSince(last[weakest]) > 1) apply = weakest;
  let numbers = null;
  // sv: Zahlen 0–20 ab sv-A1-04, bis 100 ab sv-A1-08 (Einkaufen, Preise)
  const nm = langMod('numbers'), [num20, num100] = nm ? [nm.from20, nm.from100] : [null, null];
  if (nm && lessonIdx(num20) >= 0 && lessonIdx(L.id) >= lessonIdx(num20)
      && (daysSince(ex.numbers?.last) >= 7 || errRate(ex.numbers) >= .3)) {
    const ms = Object.keys(NUM_MODES);
    numbers = { mode: ms[Math.floor(today / 7) % ms.length], range: lessonIdx(L.id) >= lessonIdx(num100) ? 100 : 20,
      why: errRate(ex.numbers) >= .3 ? t('viele Fehler zuletzt') : t('einmal pro Woche') };
  }
  // Blitzlesen: Hören & wählen und Laut lesen im täglichen Wechsel
  return { apply, numbers, err, flash: today % 2 ? 'aloud' : 'audio', ...(isA0(L.id) && isKa() ? { write: writeLetters(L, info) } : {}) };
}

// Blitzlesen (flashread.js) nach dem Quiz: 8 Items, erst ab 3 Wörtern/Silben mit Audio bis zur Lektion (sv: nur Wörter).
// A0: fester Schritt (Lesen ohne Umschrift ist das Ziel); ab A1 optional – der Tag ist mit Anwenden schon voll, Lesen
// üben dort Lückentext, Dialog und Lesetexte.
const FLASH_MODES = { audio: t('Hören & wählen'), aloud: t('Laut lesen') };
function flashStep(L, weak, plan) {
  const c = { ...ctx(), L, weak: new Set((weak ?? []).map(w => w.char)) };
  const P = flashPool(c);
  if (P.words.length + P.letters.length < 3) return null;
  const a0 = isA0(L.id);
  return { key: 'flashread', name: t('Blitzlesen'), min: 2, optional: !a0, run: (el, done) => {
    el.append(h('p', { class: 'small muted' }, t('Heute: {mode} (wechselt täglich). Das Wort blitzt kurz auf – {how}', { mode: FLASH_MODES[plan.flash ?? 'audio'], how: isKa() ? t('lies es ohne Umschrift') : t('wie spricht man es aus?') })));
    const box = h('div'); el.append(box);
    flashRun(box, c, plan.flash ?? 'audio', { n: 8, onDone: done });
  } };
}

// A0: bis zu 5 Buchstaben der Lektion zum Schreiben – zuerst noch nicht frei gut geschriebene (< 70 %), dann die seltener geübten
const WRITE_MAX = 5;
function writeLetters(L, info) {
  const w = info.writing ?? {}, good = c => (w[c]?.free ?? 0) >= .7 ? 1 : 0;
  return [...(L.letters ?? [])].sort((a, b) => good(a) - good(b) || (w[a]?.n ?? 0) - (w[b]?.n ?? 0)).slice(0, WRITE_MAX);
}

// Stand der Regel „Quiz an 2 Tagen ≥ 90 %“ (best = heutiges bestes Quiz, auch aus diesem Ablauf)
function ruleText(L, info, best) {
  const days = info.passedDays[L.id] ?? [], today = dayKey();
  const n = Math.min(2, days.length + (best >= .9 && !days.includes(today) ? 1 : 0));
  const p = x => `${Math.round(100 * x)} %`;
  const todayTxt = best != null ? t('heute bestes Quiz {p}', { p: p(best) }) + (best >= .9 ? ' ✓' : t(' – 90 % nötig')) : t('heute noch kein Quiz');
  return n >= 2 ? t('{lesson} geschafft: Quiz an 2 Tagen ≥ 90 % 🎉', { lesson: L.id }) : t('{lesson}: Tag {n}/2 mit Quiz ≥ 90 % geschafft', { lesson: L.id, n }) + ' · ' + todayTxt;
}

// Teilergebnisse zusammenfassen (übersprungene zählen nicht)
const merge = (...rs) => {
  const ok = rs.filter(r => r && !r.skipped);
  if (!ok.length) return { skipped: true };
  return { score: ok.reduce((a, r) => a + r.score, 0), of: ok.reduce((a, r) => a + r.of, 0), wrong: ok.flatMap(r => r.wrong ?? []) };
};

// Wörter zum Nachsprechen: aus der aktuellen Lektion, echte Aufnahmen bevorzugt, sonst aus früheren
function speakWords(L, n = 4) {
  const ok = D.vocab.filter(v => canPlay(v) && lessonIdx(v.lesson) <= lessonIdx(L.id));
  const rank = v => (v.lesson === L.id ? 0 : 2) + (v.audioInfo?.kind === 'native' ? 0 : 1);
  return shuffle(ok).sort((a, b) => rank(a) - rank(b)).slice(0, n);
}

// zuerst fällige Fehlerkarten (Fehlerheft, max. ~5 min ≈ ERR_MAX Aufgaben), dann bis zu n fällige Karteikarten
// (flashcards nimmt je Vokabel nur eine Richtung → mixQueue zählt wie die Sitzung)
const reviewItems = (n, errMax = ERR_MAX) => mixQueue(dueKeys().slice(0, n)).length + Math.min(dueErrs().length, errMax);
const reviewRun = (n, errMax = ERR_MAX) => (el, done) => {
  const due = dueKeys().slice(0, n), errs = Math.min(dueErrs().length, errMax);
  if (!due.length && !errs) return done({ done: 0, skipped: true });
  el.append(h('p', { class: 'small muted' }, [errs ? t('{n} Fehler aus dem Fehlerheft', { n: errs }) : '', due.length ? t(due.length === 1 ? '{n} fällige Karte' : '{n} fällige Karten', { n: due.length }) : ''].filter(Boolean).join(t(', dann ')) + '.'));
  const box = h('div'); el.append(box);
  const cards = err => { box.replaceChildren(); flashcards(null, box, due, { onDone: r => done({ ...r, err }) }); };
  if (!errs) return cards(null);
  runMistakes(box, { max: errMax, onDone: err => due.length ? cards(err) : done({ done: 0, err }) });
};

// neue Karten der Lektion (max. 10), dann Quiz; note = Zeile unter der Lektion (A1: Tage, A0: Regel-Fortschritt)
const lessonRun = (L, note) => (el, done) => {
  const fresh = cardsFor(L.id).filter(isNew).slice(0, 10);
  const box = h('div');
  el.append(h('p', {}, t('Aktuelle Lektion: '), h('a', { href: `#/lesson/${L.id}` }, `${L.id} · ${L.title}`),
      h('span', { class: 'small muted' }, note)),
    h('details', { class: 'small' }, h('summary', {}, t('Einführung lesen')), h('div', { class: 'md card', html: md(L.body) })), box);
  const doQuiz = cards => { box.replaceChildren(); quiz(L, box, { onDone: r => done({ ...r, cards }) }); };   // „Frage 1 / 12“ zeigt das Quiz selbst
  if (!fresh.length) return doQuiz(0);
  box.append(h('p', { class: 'small muted' }, t('Zuerst {n} neue Karten, danach das Quiz.', { n: fresh.length })));
  const fc = h('div'); box.append(fc);
  flashcards(L, fc, fresh, { onDone: r => doQuiz(r.done) });
};

// A0: Schrift und Laute statt Anwenden/Problemlaute; Ziel ≤ 30 min, ohne fällige Karten ~25 min
function stepsA0(L, info, weak, plan) {
  const chars = plan.write?.length ? plan.write : L.letters ?? [], ka = isKa();
  return [
    { key: 'review', name: t('Wiederholen'), min: 5, items: reviewItems(25), run: reviewRun(25) },
    ka && { key: 'write', name: t('Schreiben'), min: 8, run: (el, done) => {
      // die heutigen Buchstaben zeigt die Auswahl darunter – hier nur eine Zeile, damit das Schreibfeld am Handy ganz sichtbar ist
      el.append(h('p', { class: 'small', style: 'margin:4px 0' }, t('Je Buchstabe erst '), h('b', {}, t('nachfahren')), t(', dann '), h('b', {}, t('frei schreiben')),
        h('span', { class: 'muted' }, t(' (alle im Tab '), h('a', { href: `#/lesson/${L.id}/writing` }, t('Schreiben')), ')')));
      const box = h('div'); el.append(box);
      writing(L, box, ctx(), { chars, onDone: res => {
        const v = Object.values(res);
        done({ letters: v.length, avg: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null });
      } });
    } },
    { key: 'lesson', name: t('Lernen + Quiz'), min: 9, run: lessonRun(L, '') },   // Regel-Fortschritt steht in A0 schon unter der Schrittleiste
    flashStep(L, weak, plan),
    { key: 'listen', name: t('Hören'), min: 4, run: (el, done) => {
      el.append(h('p', { class: 'small muted' }, t('Silben und Wörter, die sich nur in einem Laut unterscheiden. Mit 🐢 oben langsamer.')));
      const box = h('div'); el.append(box);
      // ohne Minimalpaare (sollte in A0 nicht vorkommen) ersatzweise ein kurzes Diktat; sv immer mit Diktat
      // (Schreibung aus dem Laut: Doppelkonsonant, å/ä/ö – das Gegenstück zur Leseregel)
      const dict = (pairs, n) => dictation(L, box, { n, onDone: dict => done({ pairs, dict }) });
      if (!ka && !findPairs(L).length) return dict(null, 4);
      pairsDrill(L, box, { n: ka ? 8 : 6, onDone: pairs => !pairs.of ? dict(pairs, 3) : ka ? done({ pairs }) : dict(pairs, 3) });
    } },
    !ka && { key: 'speak', name: t('Sprechen'), min: 4, run: (el, done) => {
      el.append(h('p', {}, t('Anhören 🔊 → nachsprechen 🎙️, jedes Wort ein- bis zweimal. Achte auf Vokallänge und die Laute dieser Lektion; das Spektrogramm zeigt die Länge.')));
      const words = speakWords(L, 4);
      speakList(words, el);
      el.append(h('button', { class: 'btn primary', onclick: () => done({ words: words.length }) }, t('Fertig gesprochen')));
    } },
    ka && { key: 'speak', name: t('Sprechen'), min: 4, run: (el, done) => {
      el.append(h('p', {}, t('Buchstaben als Silbe (z. B. მა): anhören 🔊 → nachsprechen 🎙️. Die Ausspracheprüfung zeigt, welcher Laut gut war.')));
      const items = (L.letters ?? []).map(letterBy).filter(Boolean).map(l => ({ ...letterItem(l, L.id), isLetter: true })).filter(canPlay);
      speakList(items, el);
      el.append(h('button', { class: 'btn primary', onclick: () => done({ words: items.length, letters: true }) }, t('Fertig gesprochen')));
    } },
  ].filter(Boolean);
}

function steps(L, info, weak, plan) {
  if (isA0(L.id)) return stepsA0(L, info, weak, plan);
  // Mit „Anwenden“ werden Wiederholen, Hören, Problemlaute und Sprechen etwas kürzer, damit es bei ~30 min bleibt
  const short = !!plan.apply;
  return [
    { key: 'review', name: t('Wiederholen'), min: short ? 6 : 8, items: reviewItems(short ? 30 : 40), run: reviewRun(short ? 30 : 40) },
    { key: 'lesson', name: t('Lektion'), min: 10, run: lessonRun(L, t(' – Quiz ≥ 90 % an {n} von 2 Tagen', { n: info.passedDays[L.id]?.length ?? 0 })) },
    plan.apply && { key: 'apply', name: t('Anwenden'), min: 4, run: (el, done) => {
      el.append(h('p', { class: 'small muted' }, t('Heute: {what}', { what: APPLY[plan.apply] }),
        plan.err[plan.apply] >= .3 ? t(' – zuletzt {p} % Fehler, darum nochmal.', { p: Math.round(100 * plan.err[plan.apply]) }) : t(' (wechselt täglich).')));
      const box = h('div'); el.append(box);
      if (plan.apply === 'cloze') cloze(L, box, { n: 3, mode: 'choice', onDone: c => {
        box.replaceChildren(h('p', { class: 'small muted' }, t('Jetzt 2 Sätze bauen:')));
        const b = h('div'); box.append(b);
        build(L, b, { n: 2, onDone: s => done({ kind: 'cloze', ...merge(c, s), cloze: c, build: s }) });
      } });
      else if (plan.apply === 'dialog') dialogDrill(L, box, { onDone: r => done({ kind: 'dialog', ...r }) });
      else formsDrill(L, box, { n: 5, onDone: r => done({ kind: 'forms', ...r }) });
    } },
    { key: 'listen', name: t('Hören'), min: short ? 4 : 6, run: (el, done) => {
      const box = h('div'); el.append(box);
      const dict = pairs => dictation(L, box, { n: short ? 3 : 4, onDone: dict => done({ pairs, dict }) });
      // ohne Minimalpaare bis zu dieser Lektion (andere Sprachen) gleich das Diktat, ohne Hinweis dazwischen
      if (!isKa() && !findPairs(L).length) return dict(null);
      pairsDrill(L, box, { n: short ? 6 : 8, onDone: dict });
    } },
    flashStep(L, weak, plan),
    // Problemlaute: Georgisch je Buchstabe, Schwedisch je Laut (IPA, aus Hören/Lese-Quiz/Blitzlesen)
    { key: 'weak', name: t('Problemlaute'), min: short ? 4 : 5, run: (el, done) => weakDrill(L, el, weak, { onDone: done }) },
    { key: 'speak', name: t('Sprechen'), min: short ? 5 : 6, run: (el, done) => {
      el.append(h('p', {}, t('Anhören 🔊 → nachsprechen 🎙️, jedes Wort ein- bis zweimal. ') + (isKa() ? t('Achte auf Hauch und Knack.') : t('Achte auf Vokallänge und Melodie.'))));
      const words = speakWords(L, short ? 3 : 4);
      speakList(words, el);
      el.append(h('button', { class: 'btn primary', onclick: () => done({ words: words.length }) }, t('Fertig gesprochen')));
    } },
    plan.numbers && { key: 'numbers', name: t('Zahlen'), min: 3, optional: true, run: (el, done) => {
      const { mode, range } = plan.numbers;
      el.append(h('p', { class: 'small muted' }, t('Optional ({why}): 5 Zahlen, {mode}, bis {range}. Mehr im ', { why: plan.numbers.why, mode: NUM_MODES[mode], range }),
        h('a', { href: `#/numbers/${mode}/${range}` }, t('Zahlentrainer')), '.'));
      const box = h('div'); el.append(box);
      numbersDrill(box, mode, range, { n: 5, onDone: r => done({ ...r, mode, range }) });
    } },
  ].filter(Boolean);
}

// Kurzrunde (#/today/kurz, 5–10 min, z. B. unterwegs): nur Wiederholen (weniger Karten) und Hören
function stepsQuick(L) {
  return [
    { key: 'review', name: t('Wiederholen'), min: 5, items: reviewItems(15, 4), run: reviewRun(15, 4) },
    { key: 'listen', name: t('Hören'), min: 3, run: (el, done) => {
      const box = h('div'); el.append(box);
      const dict = (pairs, n) => dictation(L, box, { n, onDone: dict => done({ pairs, dict }) });
      if (!isKa() && !findPairs(L).length) return dict(null, 3);
      pairsDrill(L, box, { n: 6, onDone: pairs => !pairs.of ? dict(pairs, 3) : isA0(L.id) && isKa() ? done({ pairs }) : dict(pairs, 2) });
    } },
  ];
}

// Zeitbudget: geschätzte Minuten je Schritt. Gemessen (≥ 2 Tage, stepTimes in logstats.mjs) schlägt den festen Wert;
// Wiederholen = fällige Aufgaben × Sekunden je Aufgabe (gemessen, sonst PER_ITEM), nichts fällig → 0.
const PER_ITEM = 12;
function estimate(s, m) {
  if (s.items != null) return s.items ? Math.max(1, Math.round(s.items * (m?.perItem ?? PER_ITEM) / 60)) : 0;
  return m?.n >= 2 ? Math.max(1, Math.round(m.sec / 60)) : s.min;
}
// Was nicht mehr ins Tagesziel passt, wird optional: Wiederholen und Lektion nie vorab, die übrigen in der Reihenfolge
// PRIO, sobald die Summe die Restzeit um mehr als TOL Minuten überschreitet. Nach GOAL aktiver Zeit ist alles optional.
const PRIO = ['review', 'lesson', 'write', 'listen', 'flashread', 'apply', 'speak', 'weak', 'numbers'], CORE = ['review', 'lesson'], TOL = 3;
function optionalSteps(S, done, est, leftMin) {
  const opt = new Set(S.filter(s => s.optional && !done.includes(s.key)).map(s => s.key));
  let sum = 0;
  for (const k of PRIO) {
    if (!S.some(s => s.key === k) || done.includes(k) || opt.has(k)) continue;
    sum += est[k];
    if (leftMin <= 0 || (!CORE.includes(k) && sum > leftMin + TOL)) opt.add(k);
  }
  return opt;
}

export async function viewToday(mode) {
  const quick = mode === 'kurz';
  setLesson(null);
  $app.replaceChildren(h('p', { class: 'muted' }, t('Lade …')));
  const [info, weak] = await Promise.all([api('/api/today'), quick ? null : api('/api/weak')]);
  if (!location.hash.startsWith('#/today')) return;          // inzwischen weiternavigiert
  // Fortschritt des Tages (Schritt-Schlüssel + Ergebnisse + Tagesplan) überlebt Neuladen und Seitenwechsel;
  // die Kurzrunde hat ihren eigenen Stand
  // Schlüssel je Benutzer und Sprache (Benutzerwechsel im selben Browser); die alten Schlüssel ohne Besitzer
  // lassen sich keinem Benutzer zuordnen und werden verworfen (es ist nur der Stand des laufenden Tages)
  const who = `${me?.id ?? ''}.${LANG().code}`, KEY = (quick ? 'todayQuick.' : 'today.') + who;
  const load = k => { try { const s = JSON.parse(localStorage.getItem(k) ?? 'null'); return s?.date === dayKey() ? s : null; } catch { return null; } };
  try { localStorage.removeItem('today'); localStorage.removeItem('todayQuick'); } catch {}
  let st = load(KEY) ?? { date: dayKey(), done: [], res: {} };
  // Lektion bleibt für den Tag fest: wird das Quiz heute geschafft, kommt die nächste erst morgen (sonst landen
  // die heutigen Ergebnisse bei der neuen Lektion). Die Kurzrunde nimmt die Lektion des großen Ablaufs.
  const L = D.lessons.find(l => l.id === (quick ? load('today.' + who)?.plan?.lesson : st.plan?.lesson)) ?? D.lessons.find(l => l.id === info.current) ?? D.lessons[0];
  setLesson(L);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  if (!quick && st.plan?.lesson !== L.id) { st.plan = { lesson: L.id, ...await makePlan(L, info) }; save(); }
  if (!location.hash.startsWith('#/today')) return;
  const S = quick ? stepsQuick(L) : steps(L, info, weak, st.plan);
  const tag = s => (quick ? 'q:' : '') + s.key;
  const est = Object.fromEntries(S.map(s => [s.key, estimate(s, info.steps?.[tag(s)])]));
  const measured = s => info.steps?.[tag(s)]?.n >= 2;

  const a0 = isA0(L.id);
  // heutiges bestes Quiz: aus dem Protokoll oder aus diesem Ablauf (Regel-Fortschritt in A0)
  const best = () => Math.max(info.quizDays?.[dayKey()] ?? -1, st.res.lesson?.of ? st.res.lesson.score / st.res.lesson.of : -1);
  const fire = n => t(n === 1 ? '🔥 {n} Tag in Folge' : '🔥 {n} Tage in Folge', { n });
  const head = h('span', { class: 'small muted', style: 'font-weight:normal' });
  const bar = h('div'), body = h('div');
  $app.replaceChildren(h('div', { class: 'row small' }, h('a', { href: '#/' }, t('← Übersicht')),
      h('a', { href: quick ? '#/today' : '#/today/kurz', style: 'margin-left:auto', title: quick ? '' : t('Nur Wiederholen und Hören, z. B. unterwegs') },
        quick ? t('Ganzer Ablauf (~30 min) →') : t('⚡ Kurzrunde (5–10 min)'))),
    h('h1', {}, quick ? t('Kurzrunde') : t('Heute'), head),
    bar, body);

  const optional = () => quick ? new Set() : optionalSteps(S, st.done, est, (GOAL - secToday()) / 60);
  const finish = () => { st.finished = true; save(); next(); };

  // jump = Index eines angetippten Schritt-Chips: auch erledigte/übersprungene Schritte lassen sich nochmal öffnen
  // (st.done bleibt, danach geht es beim ersten offenen Schritt weiter). gen verwirft Meldungen verlassener Schritte.
  // Ohne jump: erster offener Pflichtschritt; sind nur noch optionale offen, erst fragen (einmal pro Tag, st.extra).
  let gen = 0;
  const next = (jump = null) => {
    setKeyHandler(null);
    const my = ++gen;
    const opt = optional(), open = S.filter(s => !st.done.includes(s.key));
    const need = open.filter(s => !opt.has(s.key));
    let idx = jump ?? (st.finished ? -1 : S.indexOf(need[0] ?? open[0]));
    const left = need.reduce((a, s) => a + est[s.key], 0), extra = open.filter(s => opt.has(s.key)).reduce((a, s) => a + est[s.key], 0);
    head.textContent = '  · ' + (idx < 0 ? t('✓ fertig') : (need.length ? t('noch ca. {n} min', { n: left }) : t('Wichtigstes ✓')) + (extra ? t(' (+ {n} optional)', { n: extra }) : '')) + ' · ' + fire(info.streak);
    bar.replaceChildren(h('div', { class: 'steps' }, S.map((s, k) => h('button', { class: 'step' + (st.done.includes(s.key) ? ' done' : '') + (k === idx ? ' on' : '') + (opt.has(s.key) ? ' opt' : ''),
        disabled: k === idx, title: st.done.includes(s.key) ? t('Nochmal öffnen') : (opt.has(s.key) ? t('Optional – ') : '') + t('Diesen Schritt jetzt machen'), onclick: () => { next(k); window.scrollTo(0, 0); } },
        `${st.done.includes(s.key) ? '✓ ' : ''}${s.name}${st.done.includes(s.key) ? '' : ` · ${est[s.key]}′`}`))),
      h('div', { class: 'bar' }, h('i', { style: `width:${100 * st.done.length / S.length}%` })),
      ...(a0 && !quick ? [h('p', { class: 'small muted', style: 'margin:4px 0' }, ruleText(L, info, best() < 0 ? null : best()))] : []));
    if (idx < 0) { setStep(null); return summary(); }
    const s = S[idx];
    if (jump == null && !need.length && !st.extra) return gate(open);
    setStep(tag(s));
    let finished = false;
    const again = st.done.includes(s.key);
    const done = r => {
      if (finished || my !== gen) return; finished = true;
      if (!again) st.done.push(s.key);
      if (!(again && r?.skipped)) st.res[s.key] = r;     // nochmal geöffnet und übersprungen: altes Ergebnis bleibt
      save(); next(); window.scrollTo(0, 0);
    };
    const el = h('div');
    const isOpt = opt.has(s.key);
    body.replaceChildren(h('div', { class: 'row' }, h('h2', { style: 'margin:8px 0' }, `${idx + 1}. ${s.name}`),
      h('span', { class: 'small muted', title: measured(s) ? t('nach deiner gemessenen Lernzeit ({n} Tage)', { n: info.steps[tag(s)].n }) : t('Richtwert') }, t('~{n} min', { n: est[s.key] }) + (isOpt ? t(' · optional') : '')),
      h('span', { class: 'row', style: 'margin-left:auto;gap:6px' },
        isOpt && !again ? h('button', { class: 'btn', onclick: finish, title: t('Restliche Schritte auslassen, Zusammenfassung zeigen') }, t('Für heute fertig')) : null,
        h('button', { class: 'btn', onclick: () => done({ skipped: true }) }, again ? t('Weiter') : t('Überspringen')))), el);
    s.run(el, done);
  };

  // Pflichtteil erledigt bzw. 30 min erreicht: Rest anbieten statt einfach weiterzumachen
  const gate = open => {
    setStep(null);
    const sum = open.reduce((a, s) => a + est[s.key], 0), reached = secToday() >= GOAL;
    const go = () => { st.extra = true; save(); next(); window.scrollTo(0, 0); };
    body.replaceChildren(h('div', { class: 'card' },
      h('h2', {}, reached ? t('{n} min geschafft ✓', { n: Math.round(secToday() / 60) }) : t('Das Wichtigste ist geschafft ✓')),
      h('p', {}, reached ? t('Dein Tagesziel ist erreicht. ') : open.every(s => s.optional) ? '' : t('Für die restlichen Schritte reicht die Zeit bis {n} min nicht ganz. ', { n: GOAL / 60 }),
        t('Optional: '), open.map(s => `${s.name} (~${est[s.key]} min)`).join(', '), sum > 1 ? t(' – zusammen ca. {n} min.', { n: sum }) : '.'),
      h('div', { class: 'actionbar' },
        h('button', { class: 'btn primary', onclick: go }, t('Weiter mit {step}', { step: open[0].name })),
        h('button', { class: 'btn', onclick: finish }, t('Für heute fertig')))));
    stepKeys(body, k => k === 'Enter' && (go(), true));
  };

  const summary = () => {
    const r = st.res, streak = info.activeToday ? info.streak : info.streak + 1;
    head.textContent = '  · ' + t('✓ fertig') + ' · ' + fire(streak);
    if (!st.logged) { log({ lesson: L.id, ex: 'today', ...(quick ? { quick: true } : {}), res: r }); st.logged = true; save(); }
    const passedNow = (info.passedDays[L.id]?.length ?? 0) + (r.lesson?.of && r.lesson.score / r.lesson.of >= .9 && !info.passedDays[L.id]?.includes(dayKey()) ? 1 : 0);
    const line = (name, val) => h('tr', {}, h('td', {}, name), h('td', {}, val));
    const errs = w => w?.length ? h('div', { class: 'small' }, t('Nochmal ansehen: '), h('span', { class: 'ka' }, [...new Set(w)].join(' · '))) : null;
    const scored = x => !x ? null : x.skipped ? t('übersprungen') : h('span', {}, pct(x), errs(x.wrong));
    const has = k => S.some(s => s.key === k);
    const left = S.filter(s => !st.done.includes(s.key));
    body.replaceChildren(h('div', { class: 'card' }, h('h2', {}, quick ? t('Kurzrunde geschafft 🎉') : t('Geschafft für heute 🎉')),
      h('table', {},
        line(t('Wiederholt'), r.review?.skipped ? t('nichts fällig') : t('{n} Karten', { n: r.review?.done ?? 0 })),
        r.review?.err?.of ? line(t('Fehlerheft'), scored(r.review.err)) : null,
        has('write') ? line(t('Schreiben'), r.write?.skipped || !r.write?.letters ? t('übersprungen')
          : t('{n} Buchstaben frei geschrieben, ⌀ {p} %', { n: r.write.letters, p: Math.round(100 * r.write.avg) })) : null,
        has('lesson') ? line(t('Quiz {lesson}', { lesson: L.id }), r.lesson?.skipped ? t('übersprungen') : pct(r.lesson) + (r.lesson?.cards ? ' · ' + t('{n} neue Karten', { n: r.lesson.cards }) : '')) : null,
        r.flashread ? line(t('Blitzlesen') + (r.flashread.mode ? ' · ' + FLASH_MODES[r.flashread.mode] : ''), scored(r.flashread)) : null,
        r.apply ? line(t('Anwenden') + (r.apply.kind ? ' · ' + APPLY[r.apply.kind] : ''), scored(r.apply)) : null,
        r.listen?.pairs || isKa() ? line(t('Minimalpaare'), pct(r.listen?.pairs)) : null, !a0 || r.listen?.dict ? line(t('Diktat'), pct(r.listen?.dict)) : null,
        !has('weak') || !r.weak ? null : line(t('Problemlaute'), r.weak.chars ? h('span', {}, h('span', { class: 'ka' }, r.weak.chars.join(' ')), t(' – Paare {p}', { p: pct(r.weak.pairs) })) : '–'),
        has('speak') && r.speak ? line(t('Sprechen'), r.speak.skipped ? t('übersprungen') : t(r.speak.letters ? '{n} Buchstaben' : '{n} Wörter', { n: r.speak.words ?? 0 })) : null,
        r.numbers ? line(t('Zahlen') + (r.numbers.mode ? ` · ${NUM_MODES[r.numbers.mode]}` : ''), scored(r.numbers)) : null,
        left.length ? line(t('Ausgelassen'), left.map(s => s.name).join(', ') + t(' (optional)')) : null,
        line(t('Lernzeit heute'), t('{m} min', { m: Math.round(secToday() / 60) })),
        line(t('Tagesserie'), fire(streak))),
      quick ? h('p', {}, t('Die '), h('a', { href: '#/today' }, t('ganze Runde')), t(' mit Lektion und Quiz bringt dich weiter – wenn du Zeit hast.'))
      : h('p', {}, passedNow >= 2 ? t('Lektion {lesson} ist geschafft – morgen geht es mit der nächsten weiter.', { lesson: L.id })
        : t('Quiz ≥ 90 % an {n} von 2 Tagen in {lesson}.', { n: passedNow, lesson: L.id }) + ' ' + (a0 && r.lesson?.of && r.lesson.score / r.lesson.of < .9
          ? t('Heute noch unter 90 % – das Quiz im Lektions-Tab darfst du gern wiederholen, es zählt auch.') + ' ' : '') + t('Morgen wieder!')),
      h('div', { class: 'row' }, h('a', { href: '#/' }, t('← Übersicht')),
        h('button', { class: 'btn', style: 'margin-left:auto', onclick: () => { st = { date: dayKey(), done: [], res: {}, plan: st.plan }; save(); next(); } }, t('Nochmal von vorn')))));
  };
  next();
}
