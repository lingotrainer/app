// Hörkarten s:<id> (R8): Satz hören → verstehen. D.listen kommt von /api/data (app/sentences.mjs → listenSentences).
// Ohne Imports, damit node --test es prüfen kann (app/listencards.test.mjs).
export const NEW_PER_DAY = 5;
// Schlüssel der Lektion: alle schon gesehenen + höchstens NEW_PER_DAY neue pro Kalendertag (gezählt über `first`, das grade() setzt).
// all: alle Sätze ohne Tagesgrenze (Statistik: Karten pro Lektion)
export function sentenceKeys(cards, P, lessonId, { all = false, now = Date.now() } = {}) {
  const keys = (cards ?? []).filter(s => s.lesson === lessonId).map(s => 's:' + s.id);
  if (all) return keys;
  const day = new Date(now); day.setHours(0, 0, 0, 0);
  let left = NEW_PER_DAY - Object.entries(P).filter(([k, c]) => k.startsWith('s:') && c.first >= +day).length;
  return keys.filter(k => P[k] || left-- > 0);
}
