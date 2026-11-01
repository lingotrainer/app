// Auswertung des Lernprotokolls (log.jsonl): aktuelle Lektion, Tagesserie, Problemlaute, Wochenrückblick.
// Reines ES-Modul ohne Node-APIs: der Server (app/logstats.mjs) und die statische PWA (ohne Server) rechnen damit gleich.
const day = ts => new Date(ts).toLocaleDateString('sv');        // YYYY-MM-DD in lokaler Zeit

// 2-Tage-Regel: Tage je Lektion mit Quiz ≥ 90 % ({lesson: Set(Tag)}); dayOf = Tag eines Zeitstempels (Push: Zeitzone des Benutzers)
export const PASS = .9, PASS_DAYS = 2;
// Lektionsfeld passDays (Englisch: Frequenzbänder, 1 Tag reicht) überschreibt die 2 Tage
export const needDays = l => +(l?.passDays ?? PASS_DAYS);
export function quizPassDays(log, dayOf = day) {
  const passed = {};
  for (const e of log) if (e.ex === 'quiz' && e.of && e.score / e.of >= PASS) (passed[e.lesson] ??= new Set()).add(dayOf(e.ts));
  return passed;
}

// Aktuelle Lektion = erste, deren Quiz noch nicht an 2 verschiedenen Tagen ≥ 90 % war
// srs: Karteikarten-Wiederholungen (`last`) zählen für die Tagesserie mit, auch wenn sie nur „Gut“ gedrückt haben (loggen nichts)
export function todayInfo(lessons, log = [], srs = {}) {
  const passed = quizPassDays(log);
  const current = lessons.find(l => (passed[l.id]?.size ?? 0) < needDays(l)) ?? lessons.at(-1);
  // Tagesserie: aufeinanderfolgende Tage mit Einträgen bis heute (oder bis gestern, wenn heute noch nichts geübt)
  const days = new Set([...log.map(e => day(e.ts)),
    ...Object.entries(srs).filter(([k, c]) => !k.startsWith('err:') && c.last).map(([, c]) => day(c.last))]);
  const today = day(new Date()), d = new Date();
  if (!days.has(today)) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (days.has(day(d))) { streak++; d.setDate(d.getDate() - 1); }
  return {
    current: current?.id ?? null,
    need: Object.fromEntries(lessons.filter(l => l.passDays).map(l => [l.id, needDays(l)])),     // für withPending (offline)
    passedDays: Object.fromEntries(Object.entries(passed).map(([k, v]) => [k, [...v].sort()])),
    streak, activeToday: days.has(today), todayCount: log.filter(e => day(e.ts) === today).length,
    secToday: log.reduce((a, e) => a + (e.ex === 'time' && day(e.ts) === today ? e.sec || 0 : 0), 0),   // aktive Lernzeit (timer.js)
    ex: exStats(log),
    steps: stepTimes(log),
    ...(/(^|-)A0-/.test(current?.id ?? '') ? a0Stats(current, log) : {}),
  };
}

// Dauer der Heute-Schritte (R7) aus der gemessenen Lernzeit: timer.js schreibt in „Heute“ den Schritt mit
// (time {sec, step}, Kurzrunde step 'q:<schritt>'). Je Schritt und Tag summiert; Tage unter MIN_SEC (übersprungen)
// zählen nicht. sec = Median der letzten 7 Tage (aus den letzten `days` Tagen), n = Anzahl Tage.
// Wiederholen hängt von der Zahl fälliger Karten ab: perItem = Median Sekunden je Karte/Fehlerheft-Aufgabe, aus Tagen
// mit Zusammenfassung (today.res.review: done Karten + err.of Fehler).
const MIN_SEC = 20;
export function stepTimes(log, now = Date.now(), days = 21) {
  const since = now - days * 864e5, per = {}, items = {};
  const median = xs => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  for (const e of log) {
    const t = Date.parse(e.ts);
    if (!(t >= since && t <= now)) continue;
    if (e.ex === 'time' && e.step) { const k = `${day(e.ts)}|${e.step}`; per[k] = (per[k] ?? 0) + (e.sec || 0); }
    const rv = e.ex === 'today' && e.res?.review;
    if (rv && !rv.skipped) {
      const n = (rv.done || 0) + (rv.err?.of || 0);
      if (n) { const k = `${day(e.ts)}|${e.quick ? 'q:' : ''}review`; items[k] = (items[k] ?? 0) + n; }
    }
  }
  const by = {};
  for (const [k, sec] of Object.entries(per)) {
    if (sec < MIN_SEC) continue;
    const [d, step] = k.split('|');
    (by[step] ??= []).push({ d, sec, n: items[k] });
  }
  return Object.fromEntries(Object.entries(by).map(([step, xs]) => {
    const recent = xs.sort((a, b) => a.d < b.d ? -1 : 1).slice(-7);
    const rates = recent.filter(x => x.n).map(x => x.sec / x.n);
    return [step, { sec: Math.round(median(recent.map(x => x.sec))), n: recent.length, ...(rates.length ? { perItem: +median(rates).toFixed(1) } : {}) }];
  }));
}

// Nur A0 („Heute“ für A0): bestes Quiz pro Tag (letzte 7 Tage) für die 2-Tage-Regel und Schreibübung je Buchstabe
// (n = Versuche, free = bester Wert frei geschrieben, last = letzter Übungstag)
function a0Stats(L, log, since = Date.now() - 7 * 864e5) {
  const quizDays = {}, writing = {};
  for (const e of log) {
    if (e.lesson !== L.id) continue;
    if (e.ex === 'quiz' && e.of && Date.parse(e.ts) >= since) { const d = day(e.ts), p = e.score / e.of; if (!(quizDays[d] >= p)) quizDays[d] = +p.toFixed(3); }
    if (e.ex === 'writing' && e.item) {
      const w = writing[e.item] ??= { n: 0, free: 0, last: null };
      w.n++; w.last = day(e.ts);
      if (e.mode === 'free' && e.score > w.free) w.free = e.score;
    }
  }
  return { quizDays, writing };
}

// Anwenden-Übungen für „Heute“: Versuche/Treffer der letzten 14 Tage und letzter Übungstag je Übungsart
// (Satzbau: nur erste Versuche, „Nochmal ordnen“ zählt nicht)
const EXS = ['cloze', 'build', 'forms', 'dialog', 'numbers'];
function exStats(log, since = Date.now() - 14 * 864e5) {
  const r = Object.fromEntries(EXS.map(x => [x, { n: 0, ok: 0, last: null }]));
  for (const e of log) {
    const s = r[e.ex];
    if (!s || e.retry) continue;
    const d = day(e.ts);
    if (!s.last || d > s.last) s.last = d;
    if (Date.parse(e.ts) >= since) { s.n++; s.ok += e.ok ? 1 : 0; }
  }
  return r;
}

// Problemlaute: Fehler pro Buchstabe aus Ausspracheprüfung (weak: ["კ→ქ"]), Hörtraining (confused), Quiz und Blitzlesen (wrong),
// ältere Einträge zählen weniger (Halbwertszeit 14 Tage). Quote = Fehler / (Versuche + 2), damit Einzelfehler nicht dominieren.
// Ausspracheprüfung ist unsicherer als Hören/Quiz: Gewicht ASR_W und nur, wenn der Laut bei ≥ 2 verschiedenen Items auffiel
// (eine misslungene oder leere Aufnahme macht so keinen Problemlaut).
// Urteile von Coaches (ratings.jsonl, app/ratings.mjs, jüngstes je Aufnahme) zählen mehr: ✗ mit Laut = Gewicht RATING_W,
// ✓ für ein Item löscht dessen ASR-Fehler der 7 Tage vor dem Urteil.
const ASR_W = .5, RATING_W = 2, OK_CLEARS = 7 * 864e5, HALF = 14 * 864e5;
export function weakSounds(vocab, alphabet, log = [], top = 6, now = Date.now(), ratings = [], units = null) {
  return Object.values(soundEvidence(vocab, alphabet, log, now, ratings, { units })).filter(s => s.errors >= .5)
    .map(({ recent, ...s }) => ({ ...s, errors: +s.errors.toFixed(2), attempts: +s.attempts.toFixed(2), rate: +(s.errors / (s.attempts + 2)).toFixed(3) }))
    .sort((a, b) => b.rate - a.rate || b.errors - a.errors).slice(0, top);
}

// Sprachen ohne Buchstabenkurs (sv): „Buchstaben“ = Laute = IPA-Einheiten wie in listen.js (Vokal mit Länge, Konsonantenlänge
// zählt nicht), die lang.json kennt (sounds, partners); ein Wort wird über seine IPA zerlegt (Vokabel-ID oder Schreibung).
const VOWEL = /^[aeiouyæøɑɛɪɔʊʉɵœʏɐə]/;
export const ipaUnits = ipa => (ipa.replace(/\([^)]*\)|[ˈˌ²¹./[\]]/g, '').match(/\P{M}\p{M}*ː?/gu) ?? [])
  .map(u => VOWEL.test(u) ? u : u.replace('ː', ''));
export function soundUnits(vocab, cfg) {
  const set = new Set([...Object.keys(cfg.sounds ?? {}), ...Object.entries(cfg.partners ?? {}).flat(2)]);
  const ipa = new Map(vocab.flatMap(v => v.ipa ? [[v.id, v.ipa], [v.t, v.ipa]] : []));
  return { set, of: w => ipaUnits(ipa.get(w) ?? '') };
}

// Belege je Buchstabe (weakSounds, letterMastery): {char: {errors, attempts, confusions, sources, recent}}, gewichtet mit
// Halbwertszeit 14 Tage; recent = einzelne Fehler {ts, src, alt?, item?} für „was zuletzt schiefging“. asrTry = Gewicht eines
// ASR-Versuchs (weakSounds 1 wie bisher; letterMastery ASR_W, damit die unsichere Prüfung auch Erfolge nur halb zählt).
// units (soundUnits, sv): Laute statt Buchstaben; Quiz zählt dann nur Lesefehler (confused), nicht falsche Bedeutungen.
function soundEvidence(vocab, alphabet, log, now, ratings, { asrTry = 1, units = null } = {}) {
  const kaOf = Object.fromEntries([...vocab.map(v => [v.id, v.t]),
    ...alphabet.map(l => ['letter-' + l.translit.replace("'", '_'), l.char])]);
  const isLetter = units?.set ?? new Set(alphabet.map(l => l.char));
  const split = w => units ? units.of(w) : [...(w ?? '')];
  const S = {}, A = {};                            // A: ASR-Fehler je Laut, erst am Ende übernommen
  const get = c => S[c] ??= { char: c, errors: 0, attempts: 0, confusions: {}, sources: {}, recent: [] };
  const add = (s, w, src, alt, ts, item) => {
    s.errors += w; s.sources[src] = (s.sources[src] ?? 0) + 1;
    if (alt) s.confusions[alt] = (s.confusions[alt] ?? 0) + 1;
    s.recent.push({ ts, src, ...(alt ? { alt } : {}), ...(item ? { item } : {}) });
  };
  for (const e of log) {
    const w = .5 ** ((now - Date.parse(e.ts)) / HALF);
    const err = (pair, src, f = 1, item = e.item) => {
      const [c, alt] = pair.split('→');
      if (!isLetter.has(c)) return;
      if (src !== 'asr') return add(get(c), w * f, src, alt, e.ts, item);
      (A[c] ??= []).push({ w: w * f, alt, item: e.item, t: Date.parse(e.ts), ts: e.ts });
    };
    const tried = (word, f = 1) => split(word).forEach(c => isLetter.has(c) && (get(c).attempts += w * f));
    if (e.ex === 'asr') { tried(kaOf[e.item], asrTry); (e.weak ?? []).forEach(p => err(p, 'asr', ASR_W)); }
    else if (e.ex === 'listen' && e.mode === 'pair') { if (units) { if (isLetter.has(e.sound)) get(e.sound).attempts += w; } else tried(e.sound); if (e.confused) err(e.confused, 'listen'); }
    else if (e.ex === 'listen') { tried(kaOf[e.item]); [e.confused ?? []].flat().forEach(p => err(p, 'listen')); }
    else if (units && e.ex === 'quiz') (e.confused ?? []).forEach(p => err(p, 'quiz', .5));
    else if (e.ex === 'quiz' || e.ex === 'flashread') (e.wrong ?? []).forEach(x => {
      // falscher Buchstabe zählt voll, falsch gelesenes Wort verteilt den Fehler auf seine Buchstaben
      const cs = (units && x.length > 1 ? units.of(x) : [...x]).filter(c => isLetter.has(c));
      cs.forEach(c => err(c, e.ex, cs.length === 1 ? .5 : .5 / cs.length, cs.length > 1 ? x : undefined));
    });
    // Blitzlesen: gezeigte Wörter/Silben = Versuche, confused (კ→ქ) nur als Verwechslung vermerkt (Fehler stehen schon in wrong)
    if (e.ex === 'flashread') {
      (e.items ?? []).forEach(x => tried(x));
      (e.confused ?? []).forEach(p => { const [c, alt] = p.split('→'); if (S[c] && alt) S[c].confusions[alt] = (S[c].confusions[alt] ?? 0) + 1; });
    }
  }
  const latest = latestRatings(ratings);
  const cleared = (item, t) => latest.some(r => r.verdict === 'ok' && r.item === item && t <= Date.parse(r.ts) && Date.parse(r.ts) - t <= OK_CLEARS);
  for (const [c, hits] of Object.entries(A)) {
    const rest = hits.filter(x => !cleared(x.item, x.t));
    if (new Set(rest.map(x => x.item)).size >= 2) rest.forEach(x => add(get(c), x.w, 'asr', x.alt, x.ts, x.item));
  }
  for (const r of latest) if (r.verdict === 'wrong' && isLetter.has(r.sound))
    add(get(r.sound), RATING_W * .5 ** ((now - Date.parse(r.ts)) / HALF), 'coach', r.heardAs, r.ts, r.item);
  return S;
}
const latestRatings = ratings => [...new Map(ratings.filter(r => r.file && r.verdict).map(r => [r.file, r])).values()];   // jüngstes je Aufnahme

// Buchstaben-Fortschritt (Karte „33 Buchstaben“, GET /api/letters): je Buchstabe Sicherheit score 0…1 und Zustand
// locked (Lektion noch nicht erreicht) | new (keine Karte, < 2 gewichtete Versuche) | shaky | solid (score ≥ SOLID).
//   mem  = Gedächtnis laut SRS-Karte l:<Zeichen>: ln(1+ivl)/ln(1+21), 3 Wochen Intervall = 1 (wie „gefestigt“ in der
//          Statistik); überfällige Karten verblassen mit Halbwertszeit = ihr Intervall.
//   prac = Übungsbelege aus soundEvidence (Hören, Quiz, Blitzlesen, ASR halb, Coach-✗ doppelt), dazu Quiz-Versuche (das Log
//          nennt nur Fehler: of/2 Fragen gelten als gleichmäßig auf die neuen Buchstaben der Quiz-Lektion verteilt), Schreiben
//          (frei ≥ 70 % ok, < 45 % Fehler, dazwischen halb; nachfahren 0,3-fach) und Coach-✓/≈ als Versuche.
//          Treffsicherheit nach Laplace acc = (att−err+1)/(att+2); Raten (50 %) gibt 0 → (2·acc−1), mal Belegmenge att/(att+4),
//          damit drei Treffer noch nicht „sicher“ heißen.
//   score = 1 − (1−mem)(1−prac): zwei unabhängige Belege, jeder allein kann „sicher“ erreichen (wer nur Karteikarten oder nur
//          Quiz/Blitzlesen übt, kommt auch hin), dann × (1 − 2·err/(att+2)): Fehler drücken auch eine gute SRS-Karte und wiegen
//          doppelt, weil ein Treffer bei 3–4 Antworten oft geraten ist. Alles mit Halbwertszeit 14 Tage wie weakSounds.
//   peek = Umschrift aufgedeckt (opts.js, {ex:'peek', item: Wort}): leichte Unsicherheit, PEEK_W Fehler je Buchstabe des Worts
//          (mehrfach vorkommende einmal) – einzelne Peeks lassen „sicher“ stehen, ständiges Nachsehen nicht.
const SOLID = .7, SOLID_IVL = 21, DAY = 864e5, PEEK_W = .15;
export function letterMastery({ alphabet, vocab, lessons, log = [], srs = {}, ratings = [], now = Date.now() }) {
  const S = soundEvidence(vocab, alphabet, log, now, ratings, { asrTry: ASR_W });
  const get = c => S[c] ??= { char: c, errors: 0, attempts: 0, confusions: {}, sources: {}, recent: [] };
  const decay = ts => .5 ** ((now - Date.parse(ts)) / HALF);
  const isLetter = new Set(alphabet.map(l => l.char)), byLesson = {};
  for (const l of alphabet) (byLesson[l.lesson] ??= []).push(l.char);
  for (const e of log) {
    if (e.ex === 'quiz' && e.of && byLesson[e.lesson]) {
      const cs = byLesson[e.lesson];
      cs.forEach(c => get(c).attempts += decay(e.ts) * e.of / 2 / cs.length);
    }
    if (e.ex === 'writing' && isLetter.has(e.item)) {
      const w = decay(e.ts) * (e.mode === 'free' ? 1 : .3), miss = e.score >= .7 ? 0 : e.score >= .45 ? .5 : 1, s = get(e.item);
      s.attempts += w; s.errors += w * miss;
      if (miss) s.recent.push({ ts: e.ts, src: 'writing', mode: e.mode, score: e.score });
    }
    if (e.ex === 'peek' && typeof e.item === 'string')
      new Set(e.item).forEach(c => isLetter.has(c) && (get(c).errors += PEEK_W * decay(e.ts)));
  }
  const kaOf = Object.fromEntries([...vocab.map(v => [v.id, v.t]), ...alphabet.map(l => ['letter-' + l.translit.replace("'", '_'), l.char])]);
  for (const r of latestRatings(ratings)) {
    const w = decay(r.ts);
    if (r.verdict === 'wrong') { if (isLetter.has(r.sound)) get(r.sound).attempts += RATING_W * w; continue; }   // Fehler: soundEvidence
    [...(kaOf[r.item] ?? '')].forEach(c => isLetter.has(c) && (get(c).attempts += w));
    if (r.verdict === 'close' && isLetter.has(r.sound)) { const s = get(r.sound); s.errors += .5 * w; s.recent.push({ ts: r.ts, src: 'coach', item: r.item, close: true }); }
  }
  const idx = id => lessons.findIndex(l => l.id === id);
  const current = todayInfo(lessons, log).current, cur = idx(current);
  return { current, letters: alphabet.map(l => {
    const s = S[l.char] ?? { errors: 0, attempts: 0, confusions: {}, recent: [] }, card = srs['l:' + l.char];
    let mem = 0;
    if (card?.ivl > 0) {
      mem = Math.min(1, Math.log(1 + card.ivl) / Math.log(1 + SOLID_IVL));
      if (card.due < now) mem *= .5 ** ((now - card.due) / (card.ivl * DAY));
    }
    const att = s.attempts, err = Math.min(s.errors, att + 1);
    const acc = (att - err + 1) / (att + 2), prac = Math.max(0, 2 * acc - 1) * att / (att + 4);
    const score = Math.max(0, (1 - (1 - mem) * (1 - prac)) * (1 - 2 * err / (att + 2)));
    const state = idx(l.lesson) > cur ? 'locked' : !card && att < 2 && err < .25 ? 'new' : score >= SOLID ? 'solid' : 'shaky';
    return { char: l.char, lesson: l.lesson, state, score: +score.toFixed(3), mem: +mem.toFixed(3), att: +att.toFixed(2), err: +err.toFixed(2),
      ...(card ? { ivl: card.ivl, last: card.last ?? null } : {}), confusions: s.confusions,
      recent: s.recent.sort((a, b) => a.ts < b.ts ? 1 : -1).slice(0, 3) };
  }) };
}

// Letzte Chat-Lektion (I7/R12): /lektion hängt {ex:'chat', lesson, with?, notes} an log.jsonl an (push-summary).
// → { last: ts|null, lesson, with, days (ganze Tage seit last, null ohne), due (≥ CHAT_DAYS Tage oder noch nie) }
export const CHAT_DAYS = 6;
export function lastChat(log, now = Date.now()) {
  const e = log.filter(x => x.ex === 'chat' && Date.parse(x.ts) <= now).sort((a, b) => a.ts < b.ts ? 1 : -1)[0];
  const days = e ? Math.floor((now - Date.parse(e.ts)) / 864e5) : null;
  return { last: e?.ts ?? null, lesson: e?.lesson ?? null, with: e?.with ?? [], days, due: days === null || days >= CHAT_DAYS };
}

// Wochenrückblick (#/week, scripts/week.mjs): Woche Mo–So in lokaler Zeit, offset 0 = laufende, 1 = letzte Woche.
// Lerntage/Minuten zählen Protokolleinträge und Karteikarten-Wiederholungen (`last` in srs.json; Karteikarten loggen
// nur „Nochmal“). Minuten: gemessene aktive Lernzeit (ex:'time', timer.js), für Tage ohne Messung grob geschätzt
// (Abstände ≤ 10 min zwischen Aktivitäten + 1 min je Sitzungsbeginn); die Minutenrechnung steht in dayMinutes().
export function weekStats({ lessons, vocab, alphabet, log = [], srs = {}, offset = 0, now = Date.now() }) {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7 - 7 * offset);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  const t0 = start.getTime(), t1 = end.getTime();
  const inWeek = t => t >= t0 && t < t1;
  const cards = Object.entries(srs).filter(([k]) => !k.startsWith('err:')).map(([, c]) => c);
  const acts = [...log.filter(e => e.ex !== 'time').map(e => Date.parse(e.ts)), ...cards.map(c => c.last).filter(Boolean)].sort((a, b) => a - b);
  const dm = dayMinutes({ log, srs, now }).days;   // Minuten je Tag (gemessen bzw. geschätzt), eine Rechnung für alle Ansichten
  const n = {};                                    // Tag → Anzahl Aktivitäten
  for (const t of acts) n[day(t)] = (n[day(t)] ?? 0) + 1;
  const inRange = (a, b) => Object.keys(dm).filter(k => { const t = Date.parse(k + 'T12:00:00'); return t >= a && t < b; });
  const prevDays = inRange(t0 - 7 * 864e5, t0);
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start); d.setDate(d.getDate() + i);
    const k = day(d);
    return { day: k, n: n[k] ?? 0, min: dm[k]?.min ?? 0 };
  });
  const minutes = days.reduce((a, d) => a + d.min, 0);
  // Serie am Wochenende (bzw. heute; wie todayInfo: zählt bis gestern, wenn heute noch nichts geübt)
  const all = new Set([...acts.map(day), ...Object.keys(dm)]);
  const d = new Date(Math.min(now, t1 - 1));
  if (!all.has(day(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (all.has(day(d))) { streak++; d.setDate(d.getDate() - 1); }
  let longest = 0, run = 0;
  for (const x of days) { run = x.n || x.min ? run + 1 : 0; longest = Math.max(longest, run); }

  const reviewed = cards.filter(c => c.last && inWeek(c.last));
  const quiz = log.filter(e => e.ex === 'quiz' && e.of && inWeek(Date.parse(e.ts)))
    .map(e => ({ ts: e.ts, day: day(e.ts), lesson: e.lesson, score: e.score, of: e.of }));
  const weekLog = log.filter(e => inWeek(Date.parse(e.ts)));
  const ex = {};
  for (const e of weekLog) ex[e.ex] = (ex[e.ex] ?? 0) + 1;
  const info = todayInfo(lessons, log.filter(e => Date.parse(e.ts) < t1));
  return {
    offset, from: day(t0), to: day(t1 - 1), done: now >= t1,
    days, activeDays: days.filter(x => x.n || x.min).length, minutes, streak, longest,
    prev: { activeDays: prevDays.length, minutes: prevDays.reduce((a, k) => a + dm[k].min, 0) },
    cards: {
      reviewed: reviewed.length,
      new: reviewed.filter(c => c.reps === 1 && !c.lapses).length,       // erste Wiederholung überhaupt (ca.: nochmal geübt → nicht mehr gezählt)
      total: cards.length, solid: cards.filter(c => c.ivl >= 21).length,
      dueNow: cards.filter(c => c.due <= now).length,
      dueWeek: cards.filter(c => c.due > now && c.due <= now + 7 * 864e5).length,
    },
    quiz, ex,
    weak: weakSounds(vocab, alphabet, weekLog, 3, Math.min(now, t1)).map(({ char, errors, rate, confusions }) => ({ char, errors, rate, confusions })),
    next: { lesson: info.current, passedDays: info.passedDays[info.current] ?? [] },
    // Chat-Lektionen: Anzahl in der Woche, letzte bis Wochenende bzw. jetzt; due nur für die laufende Woche (Hinweis in week.js)
    chat: (c => ({ ...c, n: weekLog.filter(e => e.ex === 'chat').length, due: offset === 0 && c.due }))(lastChat(log, Math.min(now, t1 - 1))),
  };
}

// Minuten pro Tag für die Statistik (#/stats): gleiche Rechnung wie weekStats (gemessene Lernzeit ex:'time', für Tage
// ohne Messung geschätzt aus Abständen ≤ 10 min + 1 min je Sitzungsbeginn, gerundet pro Tag), damit Statistik,
// Wochenrückblick und Kopfzeile dieselbe Zahl zeigen. → { days: {Tag: {min, measured}}, today, week, total, measured }
export function dayMinutes({ log = [], srs = {}, now = Date.now() }) {
  const acts = [...log.filter(e => e.ex !== 'time').map(e => Date.parse(e.ts)),
    ...Object.entries(srs).filter(([k]) => !k.startsWith('err:')).map(([, c]) => c.last).filter(Boolean)].sort((a, b) => a - b);
  const est = {}, sec = {};
  acts.forEach((t, i) => {
    const gap = i ? t - acts[i - 1] : Infinity, k = day(t);
    est[k] = (est[k] ?? 0) + (gap <= 10 * 6e4 && day(acts[i - 1]) === k ? gap / 6e4 : 1);
  });
  for (const e of log) if (e.ex === 'time') sec[day(e.ts)] = (sec[day(e.ts)] ?? 0) + (e.sec || 0);
  const days = {};
  for (const k of new Set([...Object.keys(est), ...Object.keys(sec)]))
    days[k] = k in sec ? { min: Math.round(sec[k] / 60), measured: true } : { min: Math.round(est[k]), measured: false };
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const w0 = day(start), today = day(now);
  const sum = keys => keys.reduce((a, k) => a + days[k].min, 0);
  const all = Object.keys(days);
  return { days, today: days[today]?.min ?? 0, week: sum(all.filter(k => k >= w0 && k <= today)), total: sum(all),
    measured: all.filter(k => days[k].measured).length, estimated: all.filter(k => !days[k].measured).length };
}
