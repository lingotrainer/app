// Statistik (#/stats): wertet log.jsonl und srs.json aus (GET /api/stats, dazu aktuelle Lektion und Minuten aus logstats.mjs → dayMinutes). Diagramme als inline SVG.
import { t, LOCALE } from './i18n.js';

const DAY = 864e5;
const NS = 'http://www.w3.org/2000/svg';
function s(tag, attrs = {}, ...kids) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null && v !== false) el.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
const tip = text => s('title', {}, text);
const dayKey = ms => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDay = k => new Date(k + 'T12:00').toLocaleDateString(LOCALE === 'de' ? 'de-DE' : LOCALE, { day: 'numeric', month: 'short' });
const pct = x => `${Math.round(x * 100)} %`;
const weekStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return d.getTime(); };
const short = (str, n) => [...str].length > n ? [...str].slice(0, n - 1).join('').trimEnd() + '…' : str;
const count = (arr) => { const m = new Map(); for (const x of arr) m.set(x, (m.get(x) ?? 0) + 1); return [...m].sort((a, b) => b[1] - a[1]); };

// Serie: aufeinanderfolgende Lerntage bis heute (oder gestern, wenn heute noch nichts geübt wurde)
function streaks(days) {
  const set = new Set(days);
  let longest = 0, run = 0, prev = null;
  for (const d of [...set].sort()) {
    run = prev && (new Date(d + 'T12:00') - new Date(prev + 'T12:00')) / DAY === 1 ? run + 1 : 1;
    longest = Math.max(longest, run); prev = d;
  }
  let cur = 0, ms = Date.now();
  if (!set.has(dayKey(ms))) ms -= DAY;
  while (set.has(dayKey(ms))) { cur++; ms -= DAY; }
  return { cur, longest, today: set.has(dayKey(Date.now())) };
}

// Aktivitätskalender: letzte 18 Wochen, Mo–So, Deckkraft = Minuten (byMin, wie Wochenrückblick), Tooltip + Übungen
function calendar(byDay, byMin) {
  const weeks = 18, cell = 14, gap = 3, left = 22, top = 16;
  const start = weekStart(Date.now()) - (weeks - 1) * 7 * DAY;
  const max = Math.max(1, ...Object.values(byMin).map(d => d.min));
  const g = s('svg', { viewBox: `0 0 ${left + weeks * (cell + gap)} ${top + 7 * (cell + gap)}`, class: 'chart', style: 'max-width:420px', role: 'img', 'aria-label': t('Lerntage der letzten 18 Wochen') });
  [t('Mo'), '', t('Mi'), '', t('Fr'), '', t('So')].forEach((d, i) => d && g.append(s('text', { x: 0, y: top + i * (cell + gap) + 11, class: 'ax' }, d)));
  for (let w = 0; w < weeks; w++) {
    const ws = start + w * 7 * DAY;
    if (new Date(ws).getDate() <= 7) g.append(s('text', { x: left + w * (cell + gap), y: 10, class: 'ax' }, new Date(ws).toLocaleDateString(LOCALE === 'de' ? 'de-DE' : LOCALE, { month: 'short' })));
    for (let d = 0; d < 7; d++) {
      const ms = ws + d * DAY + 12 * 36e5;
      if (ms > Date.now() + DAY) continue;
      const k = dayKey(ms), n = byDay.get(k) ?? 0, m = byMin[k]?.min ?? 0, on = n || byMin[k];
      g.append(s('rect', { x: left + w * (cell + gap), y: top + d * (cell + gap), width: cell, height: cell, rx: 3,
        class: on ? 'cal on' : 'cal', style: on ? `fill-opacity:${.25 + .75 * m / max}` : null },
        tip(`${fmtDay(k)}: ` + (on ? t('{m} min', { m }) + (byMin[k]?.measured === false ? t(' (geschätzt)') : '') + ', ' + t('{n} Übungen', { n }) : t('nicht geübt')))));
    }
  }
  return g;
}

// Linien-/Punktdiagramm 0–100 % mit optionaler Ziellinie; points: [{t, v, label}]
function lineChart(points, { target, height = 180, aria }) {
  const W = 800, H = height, L = 40, R = 12, T = 10, B = 24;
  const g = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart wide', role: 'img', 'aria-label': aria });
  const t0 = Math.min(...points.map(p => p.t)), t1 = Math.max(...points.map(p => p.t));
  const span = Math.max(DAY, t1 - t0);
  const x = ms => L + (W - L - R) * (points.length === 1 ? .5 : (ms - t0) / span);
  const y = v => T + (H - T - B) * (1 - v);
  for (const v of [0, .5, 1]) g.append(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'grid' }), s('text', { x: L - 6, y: y(v) + 4, class: 'ax', 'text-anchor': 'end' }, pct(v)));
  if (target != null) g.append(s('line', { x1: L, x2: W - R, y1: y(target), y2: y(target), class: 'target' }),
    s('text', { x: W - R, y: y(target) - 4, class: 'ax', 'text-anchor': 'end' }, t('Ziel {p}', { p: pct(target) })));
  g.append(s('text', { x: L, y: H - 6, class: 'ax' }, fmtDay(dayKey(t0))), s('text', { x: W - R, y: H - 6, class: 'ax', 'text-anchor': 'end' }, fmtDay(dayKey(t1))));
  if (points.length > 1) g.append(s('polyline', { points: points.map(p => `${x(p.t)},${y(p.v)}`).join(' '), class: 'line' }));
  for (const p of points) g.append(s('g', { class: 'pt' }, s('circle', { cx: x(p.t), cy: y(p.v), r: 12, class: 'hit' }), s('circle', { cx: x(p.t), cy: y(p.v), r: 4.5, class: 'dot' }), tip(p.label)));
  return g;
}

// Kleine Verlaufslinie (Wochenwerte 0–1)
function spark(vals) {
  const W = 90, H = 22, n = vals.length;
  const g = s('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'chart spark' },
    s('line', { x1: 0, x2: W, y1: H - 3, y2: H - 3, class: 'grid' }), s('line', { x1: 0, x2: W, y1: 3, y2: 3, class: 'grid', 'stroke-dasharray': '2 3' }));
  const pts = vals.map((v, i) => v == null ? null : [n === 1 ? W / 2 : 3 + (W - 6) * i / (n - 1), 3 + (H - 6) * (1 - v)]);
  const segs = []; let cur = [];
  for (const p of pts) { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  for (const sg of segs) g.append(sg.length > 1 ? s('polyline', { points: sg.join(' '), class: 'line' }) : s('circle', { cx: sg[0][0], cy: sg[0][1], r: 2.5, class: 'dot' }));
  return g;
}

// Gestapelte Balken pro Lektion: gefestigt / in Arbeit / fällig / neu
const SEGS = [['solid', t('gefestigt (≥ 3 Wochen)')], ['learn', t('in Arbeit')], ['due', t('fällig')], ['new', t('neu')]];
function cardBars(rows) {
  const W = 800, rowH = 26, L = 64, R = 70;
  const g = s('svg', { viewBox: `0 0 ${W} ${rows.length * rowH + 4}`, class: 'chart wide', role: 'img', 'aria-label': t('Karten pro Lektion') });
  rows.forEach((r, i) => {
    const y = 4 + i * rowH;
    g.append(s('text', { x: 0, y: y + 14, class: 'ax' }, r.id));
    let x = L;
    for (const [k, name] of SEGS) {
      const w = r.total ? (W - L - R) * r[k] / r.total : 0;
      if (w > 0) g.append(s('rect', { x, y, width: Math.max(0, w - 2), height: 18, rx: 3, class: 'seg ' + k }, tip(`${r.id}: ${r[k]} ${name}`)));
      x += w;
    }
    g.append(s('text', { x: W, y: y + 14, class: 'ax', 'text-anchor': 'end' }, `${r.seen}/${r.total}`));
  });
  return g;
}

// Stufe einer Lektion: A0-03 → A0, sv-A1-02 → sv-A1
const stageOf = id => id.replace(/-\d+$/, '');

// Satz-ID → {t, tx} (tx = Übersetzung in der Ausgangssprache): Lektionssätze (t-…, c-…), Dialog-/Textzeilen als <id>-<n> (Satzdiktat) und <id>:<n> (Dialog)
function sentenceTexts(R, S, D, trText) {
  const m = new Map();
  for (const s of [...(D.listen ?? []), ...(Array.isArray(S) ? S : []), ...(R?.sentences ?? [])]) m.set(s.id, { t: s.t, tx: trText(s) });
  for (const p of [...(R?.dialogs ?? []), ...(R?.texts ?? [])]) p.lines.forEach((l, i) => {
    const tx = { t: l.t, tx: trText(l) };
    m.set(`${p.id}-${i + 1}`, tx); m.set(`${p.id}:${i + 1}`, tx);
  });
  return m;
}

// learner: Lernstand eines anderen Benutzers lesen (Coach, #/stats/<id>), head: Überschrift + Auswahl (coach.js)
export function viewStats($app, { D, P, h, api, cardsFor, lettersCard, gloss, trText, learner, head = [h('h1', {}, t('Statistik'))] }) {
  $app.replaceChildren(h('a', { href: '#/' }, t('← Übersicht')), ...head, h('p', { class: 'muted' }, t('lade …')));
  // Satztexte für Fehler aus Satzdiktat/Satzbau/Dialog: /api/reading (Dialog-/Textzeilen, nur ka) + /api/sentences (Lektionssätze), beide offline gecacht (prefetch.js)
  const texts = Promise.all(['/api/reading', '/api/sentences'].map(u => api(u).catch(() => null)));
  Promise.all([api('/api/stats' + (learner ? '?user=' + encodeURIComponent(learner) : '')), texts]).then(([data, [R, S]]) => {
    if (data.error) throw new Error(data.error);
    render($app, data, { D, P, h, cardsFor, lettersCard, gloss, head, learner, sents: sentenceTexts(R, S, D, trText) });
  })
    .catch(e => $app.lastChild.replaceWith(h('p', { class: 'feedback bad' }, t('Statistik konnte nicht geladen werden: {msg}', { msg: e.message }))));
}

function render($app, { log: all, srs, current, minutes }, { D, h, cardsFor, lettersCard, gloss, head, learner, sents = new Map() }) {
  const log = all.filter(e => e.ex !== 'time');   // Lernzeit-Einträge (timer.js) sind keine Übungen
  const now = Date.now();
  const letterId = l => 'letter-' + l.translit.replace("'", '_');
  const letterOf = Object.fromEntries(D.alphabet.map(l => [letterId(l), l]));
  const vocabOf = Object.fromEntries(D.vocab.map(v => [v.id, v]));
  const tsOf = e => new Date(e.ts).getTime();
  const box = (title, ...kids) => h('section', { class: 'card' }, h('h2', { style: 'margin-top:0' }, title), ...kids);
  const empty = text => h('p', { class: 'muted small' }, text);
  const legend = items => h('div', { class: 'legend small' }, items.map(([cls, name]) => h('span', {}, h('i', { class: 'sw ' + cls }), name)));

  // ---- Kopfzahlen ----
  const byDay = new Map();
  for (const e of log) byDay.set(dayKey(e.ts), (byDay.get(dayKey(e.ts)) ?? 0) + 1);
  const learnDays = new Set([...byDay.keys(), ...Object.keys(minutes.days)]);   // wie weekStats: auch nur Lernzeit/Karteikarten
  const st = streaks([...learnDays]);
  const errs = Object.entries(srs).filter(([k, c]) => k.startsWith('err:') && !c.done);   // Fehlerkarten (mistakes.js)
  const errDue = errs.filter(([, c]) => c.due <= now).length;
  const keys = Object.keys(srs).filter(k => !k.startsWith('err:'));
  const dueNow = keys.filter(k => srs[k].due <= now).length;
  const tile = (n, label, sub) => h('div', { class: 'tile' }, h('div', { class: 'num' }, n), h('div', {}, label), sub ? h('div', { class: 'small muted' }, sub) : null);

  // ---- Karten pro Lektion ----
  const rows = D.lessons.map(L => {
    const ks = cardsFor(L.id, { all: true }), r = { id: L.id, total: ks.length, solid: 0, learn: 0, due: 0, new: 0 };
    for (const k of ks) { const c = srs[k]; r[!c ? 'new' : c.due <= now ? 'due' : c.ivl >= 21 ? 'solid' : 'learn']++; }
    r.seen = r.total - r.new;
    return r;
  }).filter(r => r.total);
  const stage = stageOf(current ?? rows[0]?.id ?? '');
  const otherStages = [...new Set(rows.map(r => stageOf(r.id)))].filter(x => x !== stage).map(x => {
    const rs = rows.filter(r => stageOf(r.id) === x);
    return { stage: x, rows: rs, seen: rs.reduce((a, r) => a + r.seen, 0), total: rs.reduce((a, r) => a + r.total, 0) };
  });

  // ---- Quiz ----
  const quiz = log.filter(e => e.ex === 'quiz' && e.of).map(e => ({ t: tsOf(e), v: e.score / e.of, lesson: e.lesson, day: dayKey(e.ts), e }));
  const quizByLesson = D.lessons.map(L => {
    const qs = quiz.filter(q => q.lesson === L.id);
    const goodDays = new Set(qs.filter(q => q.v >= .9).map(q => q.day));
    return { id: L.id, n: qs.length, best: Math.max(0, ...qs.map(q => q.v)), last: qs.at(-1)?.v, goodDays: goodDays.size };
  }).filter(r => r.n);

  // ---- Aussprache pro Laut ----
  const asr = log.filter(e => e.ex === 'asr' && typeof e.score === 'number');
  const weeks = 8, w0 = weekStart(now) - (weeks - 1) * 7 * DAY;
  const perLetter = new Map(); // char -> {n, bad, confused: [], week: [{n,bad}]}
  for (const e of asr) {
    const l = letterOf[e.item], v = vocabOf[e.item];
    const chars = l ? [l.char] : v ? [...v.t] : [];
    const weak = (e.weak ?? []).map(w => w.split('→'));
    const wi = Math.floor((weekStart(tsOf(e)) - w0) / (7 * DAY));
    for (const c of new Set(chars)) {
      const r = perLetter.get(c) ?? { n: 0, bad: 0, confused: [], week: Array.from({ length: weeks }, () => ({ n: 0, bad: 0 })) };
      const miss = weak.filter(([a]) => a === c);
      r.n++; if (miss.length) r.bad++;
      r.confused.push(...miss.map(([, b]) => b));
      if (wi >= 0 && wi < weeks) { r.week[wi].n++; if (miss.length) r.week[wi].bad++; }
      perLetter.set(c, r);
    }
  }
  const writingLog = log.filter(e => e.ex === 'writing' && e.mode === 'free' && typeof e.score === 'number');
  const writeBy = new Map();
  for (const e of writingLog) { const a = writeBy.get(e.item) ?? []; a.push(e.score); writeBy.set(e.item, a); }
  const letterRows = D.alphabet.filter(l => perLetter.has(l.char) || writeBy.has(l.char));
  const asrByDay = [...count(asr.map(e => dayKey(e.ts))).map(([d]) => d)].sort().map(d => {
    const es = asr.filter(e => dayKey(e.ts) === d);
    return { t: new Date(d + 'T12:00').getTime(), v: es.reduce((a, e) => a + e.score, 0) / es.length, label: t('{day}: Ø {p} ({n} Aufnahmen)', { day: fmtDay(d), p: pct(es.reduce((a, e) => a + e.score, 0) / es.length), n: es.length }) };
  });

  // ---- Häufigste Fehler ----
  const errQuiz = count(log.filter(e => e.ex === 'quiz').flatMap(e => e.wrong ?? []));
  const errTyping = count(log.filter(e => e.ex === 'typing' && e.ok === false).map(e => e.item));
  const errFlash = count(log.filter(e => e.ex === 'flash' && e.ok === false).map(e => e.item));
  const errAsr = count(asr.flatMap(e => e.weak ?? []));
  const keyLabel = k => {
    const [kind, id, dir] = String(k).split(':');
    if (kind === 'l') return h('span', { class: 'ka' }, id);
    if (kind === 's') { const s = D.listen?.find(x => x.id === id); return s ? h('span', {}, '🎧 ', h('span', { class: 'ka' }, s.t)) : String(k); }
    const v = vocabOf[kind === 'v' ? id : k];
    return v ? h('span', {}, h('span', { class: 'ka' }, v.t), ' ', h('span', { class: 'muted' }, (gloss(v)[0] ?? '') + (dir ? (dir === 'ka' ? t(' (ka→de)') : t(' (de→ka)')) : ''))) : String(k);
  };
  const errList = (title, list, fmt = x => h('span', { class: 'ka' }, x)) => h('div', {}, h('h3', {}, title),
    list.length ? h('ol', { class: 'errs' }, list.slice(0, 8).map(([x, n]) => h('li', {}, fmt(x), h('span', { class: 'muted small' }, ` ${n}×`)))) : empty(t('keine')));

  // ---- Trefferquote je Übungsart (Einträge mit ok: true/false; Satzbau ohne „Nochmal ordnen“) ----
  const EXS = [['flash', t('Karteikarten')], ['typing', t('Tippen')], ['listen', t('Hören')], ['cloze', t('Lückentext')], ['build', t('Satzbau')],
    ['forms', t('Formen')], ['dialog', t('Dialog')], ['numbers', t('Zahlen')]];
  const errKey = e => e.ex === 'cloze' ? e.word : e.ex === 'forms' ? `${e.item}|${e.form}` : e.item;
  const errLabel = (ex, k) => {
    if (ex === 'forms') { const [id, f] = k.split('|'); return h('span', {}, h('span', { class: 'ka' }, vocabOf[id]?.t ?? id), h('span', { class: 'muted' }, ' ' + f)); }
    if (ex === 'cloze' || ex === 'flash' || ex === 'typing') return keyLabel(k);
    if (ex === 'listen' && (vocabOf[k] || letterOf[k])) return h('span', { class: 'ka' }, vocabOf[k]?.t ?? letterOf[k].char);
    const s = sents.get(k);   // Satzdiktat, Satzbau, Dialog: Satz gekürzt + Deutsch, ID nur als Tooltip
    return s ? h('span', { title: k }, h('span', { class: 'ka' }, short(s.t, 32)), s.tx ? h('span', { class: 'muted' }, ' „' + short(s.tx, 32) + '“') : '')
      : h('span', { class: 'small' }, k);
  };
  const exRows = EXS.map(([ex, name]) => {
    const es = log.filter(e => e.ex === ex && typeof e.ok === 'boolean' && !e.retry);
    const rate = xs => xs.length ? xs.filter(e => e.ok).length / xs.length : null;
    const week = Array.from({ length: weeks }, (_, i) => rate(es.filter(e => Math.floor((weekStart(tsOf(e)) - w0) / (7 * DAY)) === i)));
    return { ex, name, n: es.length, all: rate(es), recent: rate(es.filter(e => tsOf(e) >= now - 14 * DAY)), week,
      errs: count(es.filter(e => !e.ok).map(errKey).filter(Boolean)).slice(0, 3) };
  }).filter(r => r.n);

  const minNote = !minutes.measured ? t('≈ {n} min, grob geschätzt aus den Abständen zwischen Übungen (der Zähler ⏱ läuft erst seit Kurzem).', { n: minutes.total })
    : t('{n} min aktive Lernzeit (⏱)', { n: minutes.total }) + (minutes.estimated ? t(minutes.estimated > 1 ? ', davon {d} Tage vor dem Zähler grob geschätzt' : ', davon {d} Tag vor dem Zähler grob geschätzt', { d: minutes.estimated }) : '') + '.';
  const errLists = [[t('Quiz'), errQuiz], [t('Tippen'), errTyping, keyLabel], [t('Karteikarten „Nochmal“'), errFlash, keyLabel], [t('Aussprache (Laut → gehört als)'), errAsr]]
    .filter(([, l]) => l.length);
  $app.replaceChildren(
    h('a', { href: '#/' }, t('← Übersicht')), ...head,
    !log.length && !keys.length ? h('p', { class: 'card' }, t('Noch keine Daten – sobald du Quiz, Karteikarten, Tippen oder Sprechen übst, erscheint hier dein Verlauf.')) : '',
    h('div', { class: 'tiles' },
      tile(learnDays.size, t('Lerntage'), learnDays.size ? t('seit {day}', { day: fmtDay([...learnDays].sort()[0]) }) : null),
      tile(minutes.week, t('Minuten diese Woche'), [t('heute {n} min', { n: minutes.today }), learner ? '' : h('br'), learner ? '' : h('a', { href: '#/week' }, t('Wochenrückblick →'))]),
      tile(st.cur, t('Tage in Folge'), st.cur && !st.today ? t('heute noch üben!') : t('Rekord: {n}', { n: st.longest })),
      tile(keys.length, t('Karten gesehen'), t('von {n}', { n: D.lessons.reduce((a, L) => a + cardsFor(L.id, { all: true }).length, 0) })),
      tile(dueNow, t('jetzt fällig'), dueNow ? h('a', { href: '#/review' }, t('wiederholen →')) : t('alles erledigt')),
      tile(errs.length, t('Fehlerkarten offen'), errs.length ? h('a', { href: '#/mistakes' }, t('{n} fällig – Fehlerheft →', { n: errDue })) : t('keine'))),
    lettersCard?.({ learner }) ?? '',   // „33 Buchstaben“ (letters.js, nur Georgisch)
    box(t('Lerntage'), calendar(byDay, minutes.days), h('p', { class: 'small muted' }, t('{n} Übungen protokolliert, {note} Je dunkler, desto länger geübt.', { n: log.length, note: minNote }))),
    box(t('Karteikarten pro Lektion') + (stage ? ' – ' + stage : ''), rows.length ? [legend(SEGS), cardBars(rows.filter(r => stageOf(r.id) === stage)),
      ...otherStages.map(o => h('details', {}, h('summary', { class: 'small' }, t('{stage}: {n} Lektionen, {seen}/{total} Karten gesehen', { stage: o.stage, n: o.rows.length, seen: o.seen, total: o.total })), cardBars(o.rows)))]
      : empty(t('keine Lektionen'))),
    box(t('Quiz'),
      quiz.length ? [lineChart(quiz.map(q => ({ t: q.t, v: q.v, label: `${q.lesson}, ${fmtDay(q.day)}: ${q.e.score}/${q.e.of}` })), { target: .9, aria: t('Quizergebnisse über die Zeit') }),
        h('table', { class: 'small' }, h('tr', {}, h('th', {}, t('Lektion')), h('th', {}, t('Versuche')), h('th', {}, t('zuletzt')), h('th', {}, t('bestes')), h('th', {}, t('Tage ≥ 90 %'))),
          quizByLesson.map(r => h('tr', {}, h('td', {}, r.id), h('td', {}, r.n), h('td', {}, pct(r.last)), h('td', {}, pct(r.best)),
            h('td', {}, r.goodDays >= 2 ? h('b', { class: 'feedback ok' }, t('{n} ✓ weiter', { n: r.goodDays })) : `${r.goodDays} / 2`)))),
        h('p', { class: 'small muted' }, t('Regel: nächste Lektion, wenn das Quiz an zwei verschiedenen Tagen ≥ 90 % ergibt.'))]
        : empty(t('Noch kein Quiz gemacht.'))),
    exRows.length ? box(t('Übungsarten'),
      h('div', { class: 'scroll-x' }, h('table', { class: 'small' },
        h('tr', {}, h('th', {}, t('Übung')), h('th', {}, t('Aufgaben')), h('th', {}, t('richtig')), h('th', {}, t('letzte 14 Tage')), h('th', {}, t('letzte {n} Wochen', { n: weeks })), h('th', {}, t('häufigste Fehler'))),
        exRows.map(r => h('tr', {}, h('td', {}, r.name), h('td', {}, r.n), h('td', {}, pct(r.all)),
          h('td', { class: r.recent != null && r.recent < .7 ? 'feedback bad' : '' }, r.recent == null ? '–' : pct(r.recent)),
          h('td', {}, spark(r.week)),
          h('td', {}, r.errs.map(([k, n], i) => h('span', {}, i ? ', ' : '', errLabel(r.ex, k), h('span', { class: 'muted' }, ` ${n}×`)))))))),
      h('p', { class: 'small muted' }, t('Anteil der auf Anhieb richtigen Aufgaben. Unter 70 % in den letzten 14 Tagen ist rot markiert – „Heute“ nimmt solche Übungen öfter dran.'))) : '',
    asrByDay.length || letterRows.length ? box(t('Aussprache und Schreiben pro Laut'),
      asrByDay.length ? [h('div', { class: 'small muted' }, t('Ausspracheprüfung, Tagesdurchschnitt:')), lineChart(asrByDay, { height: 140, aria: t('Aussprachewertung pro Tag') })] : '',
      letterRows.length ? h('div', { class: 'scroll-x' }, h('table', { class: 'small' },
        h('tr', {}, h('th', {}, t('Laut')), h('th', {}, t('Aufnahmen')), h('th', {}, t('klar erkannt')), h('th', {}, t('letzte {n} Wochen', { n: weeks })), h('th', {}, t('verwechselt mit')), h('th', {}, t('Schreiben Ø (frei)'))),
        letterRows.map(l => {
          const r = perLetter.get(l.char), wr = writeBy.get(l.char);
          return h('tr', {}, h('td', { class: 'ka', style: 'font-size:22px' }, l.char, ' ', h('span', { class: 'ipa small' }, l.ipa)),
            h('td', {}, r?.n ?? '–'), h('td', { class: r && r.bad / r.n > .3 ? 'feedback bad' : '' }, r ? pct(1 - r.bad / r.n) : '–'),
            h('td', {}, r ? spark(r.week.map(w => w.n ? 1 - w.bad / w.n : null)) : ''),
            h('td', { class: 'ka' }, r ? count(r.confused).slice(0, 3).map(([c, n]) => `${c} ${n}×`).join(', ') : ''),
            h('td', {}, wr ? `${pct(wr.reduce((a, b) => a + b, 0) / wr.length)} (${wr.length}×)` : '–'));
        }))) : '',
      h('p', { class: 'small muted' }, t('„Klar erkannt“ = Anteil der Aufnahmen, in denen die Prüfung den Laut nicht als anderen Laut gehört hat. Die Prüfung irrt sich auch bei Muttersprachlern in ~5 % der Fälle.'))) : '',
    errLists.length ? box(t('Häufigste Fehler'), h('div', { class: 'errgrid' }, errLists.map(a => errList(...a)))) : '',
  );
}
