// SRS (vereinfachtes SM-2)
import { MIN, DAY, toast, shuffle } from './util.js';
import { D, P, letterBy, vocabBy, listenBy, lessonIdx, LANG } from './data.js';
import { send } from './offline.js';
import { sentenceKeys } from './listencards.js';
import { t } from './i18n.js';

// offline: Gesamtstand puffern (offline.js), Server führt pro Karte zusammen (späteres `last` gewinnt)
export const saveP = () => send('/api/progress', { method: 'PUT', body: JSON.stringify(P, null, 1) }, 'progress').catch(() => toast(t('Fortschritt nicht gespeichert!')));
export function grade(key, q) {               // q: 0 nochmal, 1 schwer, 2 gut, 3 leicht
  if (q === 3 && isKnownOnFirst(key)) return markKnown(key);
  const c = P[key] ?? { ease: 2.5, ivl: 0, reps: 0, lapses: 0, first: Date.now() };   // first: Tagesgrenze neuer Hörkarten (listencards.js)
  if (q === 0) { c.reps = 0; c.lapses++; c.ivl = 0; c.due = Date.now() + 10 * MIN; }
  else {
    c.reps++;
    c.ivl = c.reps === 1 ? (q === 3 ? 3 : 1) : c.reps === 2 ? (q === 1 ? 2 : q === 3 ? 6 : 4)
      : Math.max(c.ivl + 1, Math.round(c.ivl * (q === 1 ? 1.2 : c.ease * (q === 3 ? 1.3 : 1))));
    c.ease = Math.max(1.3, c.ease + (q === 1 ? -.15 : q === 3 ? .15 : 0));
    c.due = Date.now() + c.ivl * DAY;
  }
  c.last = Date.now();
  P[key] = c; saveP();
}
// Sprachen mit knownOnFirst (Englisch für Experten): neue Vokabelkarte gleich beim ersten Mal „Leicht“ → Wort gilt als
// bekannt, beide Richtungen bekommen ein langes Intervall (ivl Tage) und Feld known – sie kommen nicht mehr als neu,
// nur noch selten zur Kontrolle. Eine schon begonnene Gegenrichtung bleibt, wie sie ist.
export const isKnownOnFirst = key => !!LANG().knownOnFirst && key.startsWith('v:') && !P[key];
function markKnown(key) {
  const ivl = LANG().knownOnFirst.ivl ?? 90, now = Date.now();
  for (const k of [key, key.endsWith(':ka') ? key.replace(/:ka$/, ':de') : key.replace(/:de$/, ':ka')])
    if (k === key || !P[k]) P[k] = { ease: 2.8, ivl, reps: 3, lapses: 0, first: now, due: now + ivl * DAY, last: now, known: true };
  saveP();
}
export const isDue = k => P[k] && P[k].due <= Date.now();
// ohne Fehlerkarten (err:…, mistakes.js) – die fragt das Fehlerheft in ihrer eigenen Übungsform ab
export const dueKeys = () => Object.keys(P).filter(k => !k.startsWith('err:') && isDue(k));
// Hörkarten s:<id> (ab A1) zuletzt, damit neue Wörter zuerst drankommen; all: ohne Tagesgrenze (Statistik)
export function cardsFor(lessonId, { all = false } = {}) {
  const keys = [];
  D.alphabet.filter(l => l.lesson === lessonId).forEach(l => keys.push('l:' + l.char));
  D.vocab.filter(v => v.lesson === lessonId).forEach(v => keys.push(`v:${v.id}:ka`, `v:${v.id}:de`));
  keys.push(...sentenceKeys(D.listen, P, lessonId, { all }));
  return keys;
}

// Beide Richtungen einer Vokabel (v:id:ka / v:id:de) sind Geschwister: nie in derselben Sitzung (die zweite bleibt fällig),
// und de→ka ist erst neu, wenn ka→de an einem früheren Tag gelernt wurde – sonst kennt man die Antwort von eben.
const sibling = k => k.startsWith('v:') ? k.split(':')[1] : k;
const today0 = () => new Date().setHours(0, 0, 0, 0);
export const isNew = k => !P[k] && (!/^v:.*:de$/.test(k) || P[k.replace(/:de$/, ':ka')]?.last < today0());
export const keyLesson = k => k.startsWith('l:') ? letterBy(k.slice(2))?.lesson : k.startsWith('v:') ? vocabBy(k.split(':')[1])?.lesson
  : k.startsWith('s:') ? listenBy(k.slice(2))?.lesson : undefined;
// fällige Karten aller Lektionen bis lessonId (ältere Lektionen kommen gemischt mit)
export const dueUpTo = lessonId => dueKeys().filter(k => lessonIdx(keyLesson(k)) <= lessonIdx(lessonId));
// Sitzung: fällige gemischt, neue gleichmäßig dazwischen verteilt, je Vokabel nur eine Richtung
export function mixQueue(due, fresh = []) {
  const seen = new Set(), one = ks => ks.filter(k => !seen.has(sibling(k)) && seen.add(sibling(k)));
  const d = one(shuffle(due)), f = one(shuffle(fresh)), out = [];
  let j = 0;
  d.forEach((k, i) => { out.push(k); while (j < f.length && (j + 1) * d.length <= (i + 1) * f.length) out.push(f[j++]); });
  return [...out, ...f.slice(j)];
}
