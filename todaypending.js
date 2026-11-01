// Offline-Lektionswechsel: /api/today kommt offline aus dem Cache, ein offline gemachtes Quiz liegt noch im Puffer
// (offline.js → pendingLog). withPending() rechnet gepufferte Log-Einträge mit derselben Regel wie todayInfo() in
// app/logstats.mjs ein (Quiz ≥ 90 % an 2 Tagen). Ohne Importe, damit node --test es laden kann (app/todaypending.test.mjs).
// Keine Doppelzählung: Tage sind Mengen – hat der Server einen Eintrag schon (Antwort ging verloren, Puffer sendet mit
// derselben qid erneut), bleibt der Tag ein Tag. Nach dem Sync ist der Eintrag aus dem Puffer verschwunden.
export const PASS = .9, PASS_DAYS = 2;
const day = ts => new Date(ts).toLocaleDateString('sv');        // YYYY-MM-DD lokal, wie logstats.mjs

// info: Antwort von /api/today, lessons: Lektions-IDs in Reihenfolge, entries: gepufferte Log-Einträge ({ts, ex, …})
export function withPending(info, lessons, entries) {
  if (!info || info.error || !entries?.length || !lessons?.length) return info;
  const passed = Object.fromEntries(Object.entries(info.passedDays ?? {}).map(([k, v]) => [k, new Set(v)]));
  for (const e of entries) if (e.ex === 'quiz' && e.of && e.score / e.of >= PASS) (passed[e.lesson] ??= new Set()).add(day(e.ts));
  const current = lessons.find(id => (passed[id]?.size ?? 0) < (info.need?.[id] ?? PASS_DAYS)) ?? lessons.at(-1);
  const out = { ...info, current, passedDays: Object.fromEntries(Object.entries(passed).map(([k, v]) => [k, [...v].sort()])) };
  if (entries.some(e => day(e.ts) === day(Date.now()))) out.activeToday = true;
  // A0-Fortschritt (a0Stats): bei Lektionswechsel nur aus dem Puffer, sonst darübergelegt
  if (/(^|-)A0-/.test(current ?? '')) {
    const same = current === info.current;
    const quizDays = { ...(same ? info.quizDays : {}) }, writing = { ...(same ? info.writing : {}) };
    for (const e of entries) {
      if (e.lesson !== current) continue;
      if (e.ex === 'quiz' && e.of) { const d = day(e.ts), p = +(e.score / e.of).toFixed(3); if (!(quizDays[d] >= p)) quizDays[d] = p; }
      if (e.ex === 'writing' && e.item) {
        const w = writing[e.item] = { n: 0, free: 0, last: null, ...writing[e.item] };
        w.n++; w.last = day(e.ts);
        if (e.mode === 'free' && e.score > w.free) w.free = e.score;
      }
    }
    Object.assign(out, { quizDays, writing });
  } else { delete out.quizDays; delete out.writing; }
  return out;
}
