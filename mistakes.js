// Fehlerheft: Fehler aus den Übungen kommen wieder.
// - Vokabelbezogen (Lückentext-Wort, Diktat, Quiz) → bestehende SRS-Karte zurücksetzen und sofort fällig machen (lapse).
// - Sonst (Satz, Verbform, Dialogzeile, Minimalpaar, Zahl) → Fehlerkarte im selben Lernstand P (srs.json), Schlüssel
//   `err:<art>:<ref>`. Damit laufen Offline-Puffer und Zusammenführung pro Karte nach `last` (app/pwa.mjs) ohne Extra-API.
// Leitner, bewusst einfach: Fehler → sofort fällig; 1× richtig (wenn fällig) → in 3 Tagen wieder; 2× richtig in Folge → erledigt.
// Erledigte Karten bleiben als {done: true, last} stehen (Grabstein), sonst holte die Zusammenführung den alten Stand vom Server zurück.
import { P } from './data.js';
import { saveP } from './srs.js';

const DAY = 864e5;
export const ERR = 'err:';
export const ERR_DAYS = 3, ERR_OK = 2;
export const isErr = k => k.startsWith(ERR);

// SRS-Karte (l:<Zeichen> bzw. v:<id>:ka|de) „vergessen“: wie „Nochmal“ in grade(), auch für noch nie gesehene Karten
export function lapse(key) {
  const c = P[key] ?? { ease: 2.5, ivl: 0, reps: 0, lapses: 0 };
  Object.assign(c, { reps: 0, lapses: c.lapses + 1, ivl: 0, due: Date.now(), last: Date.now() });
  P[key] = c; saveP();
}

// Ergebnis einer Übungsaufgabe melden. kind+ref = Schlüssel, data = was zum erneuten Abfragen nötig ist.
// Falsch → Fehlerkarte anlegen/zurücksetzen. Richtig → zählt nur, wenn die Karte fällig ist (Abstand bleibt erhalten).
export function mistake(kind, ref, data, ok) {
  const key = `${ERR}${kind}:${ref}`, now = Date.now();
  let c = P[key];
  if (!ok) {
    c = { kind, ...data, n: (c && !c.done ? c.n : 0) + 1, ok: 0, due: now, last: now, since: c && !c.done ? c.since : now };
    P[key] = c; saveP();
    return;
  }
  if (!c || c.done || c.due > now) return;
  c = { ...c, ok: c.ok + 1, last: now };
  if (c.ok >= ERR_OK) c.done = true; else c.due = now + ERR_DAYS * DAY;
  P[key] = c; saveP();
}

export const errKey = (kind, ref) => `${ERR}${kind}:${ref}`;
export const openErrs = () => Object.keys(P).filter(k => isErr(k) && !P[k].done);
export const dueErrs = () => openErrs().filter(k => P[k].due <= Date.now()).sort((a, b) => P[a].due - P[b].due);
