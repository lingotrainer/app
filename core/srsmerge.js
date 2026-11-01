// SRS-Stände zusammenführen (Server: PUT /api/progress, Browser: Offline-Puffer, statische PWA). Reines ES-Modul.
const DAY = 864e5, MIN = 60e3;

// Zeitpunkt der letzten Wiederholung einer Karte: Feld `last` (App/anki-sync), sonst aus due − Intervall geschätzt
export const lastOf = c => c?.last ?? ((c?.due ?? 0) - (c?.ivl ? c.ivl * DAY : 10 * MIN));

// Pro Karte gewinnt die mit späterem `last` (Offline-Puffer, mehrere Geräte).
// Karten, die nur im alten Stand stehen, bleiben erhalten. → { merged, kept: Anzahl Karten, bei denen der alte Stand neuer war }
export function mergeSrs(server, incoming) {
  const merged = { ...server };
  let kept = 0;
  for (const [k, c] of Object.entries(incoming)) {
    if (server[k] && lastOf(server[k]) > lastOf(c)) kept++;
    else merged[k] = c;
  }
  return { merged, kept };
}
