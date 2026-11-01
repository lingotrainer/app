// Englische Zahlwörter 0–100 (Kurs ka-en, britisch) mit Zerlegung zur Erklärung – gleiche Schnittstelle wie numbers-sv.js.
// Ohne Abhängigkeiten außer i18n, damit scripts/test-numbers.mjs das Modul direkt in Node laden kann.
//
// Belege (Stand 2026-10-31, Prüfung: scripts/test-numbers.mjs):
// - Grundformen 0–13, 15 und 20 = Vokabeln aus data/en/vocab/anfaenger.jsonl (en-A0/en-A1-02); der Test vergleicht BASE mit der Datei.
// - 14, 16–19, die Zehner 30–90 und hundred sind Bausteine ohne eigene Vokabel. Alle Zahlwörter 0–99 (auch twenty-one … mit
//   Bindestrich) und hundred sind Einträge des en-Wiktionary (kaikki en-en, Abgleich 2026-10-31); der Test prüft eine Auswahl
//   und alle, die im nach Häufigkeit gefilterten Index data/raw/en/wikt-index.json stehen.
// - Uhrzeit „It's seven o'clock.“ / „It's twelve o'clock.“: Tatoeba (t-875819, t-2714679).
// UNGEPRÜFT (Regelwissen von Claude): „one hundred“/„a hundred“ als Ganzes, Preisform „five pounds“/„one pound“.

import { t } from './i18n.js';

// Wert → [Vokabel-ID, Wort]
export const BASE = {
  0: ['zero', 'zero'], 1: ['one', 'one'], 2: ['two', 'two'], 3: ['three-basic', 'three'], 4: ['four', 'four'], 5: ['five', 'five'],
  6: ['six', 'six'], 7: ['seven', 'seven'], 8: ['eight', 'eight'], 9: ['nine', 'nine'], 10: ['ten', 'ten'], 11: ['eleven-basic', 'eleven'],
  12: ['twelve-basic', 'twelve'], 13: ['thirteen-basic', 'thirteen'], 15: ['fifteen-basic', 'fifteen'], 20: ['twenty', 'twenty'],
};
// Bausteine ohne Vokabel (Wiktionary-Belege s. oben)
export const EXTRA = {
  14: 'fourteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen', 19: 'nineteen',
  30: 'thirty', 40: 'forty', 50: 'fifty', 60: 'sixty', 70: 'seventy', 80: 'eighty', 90: 'ninety', 100: 'one hundred',
};
export const MAX = 100;
const ALT = { 100: ['one hundred', 'a hundred'] };

const GLOSS = { 11: t('unregelmäßig'), 12: t('unregelmäßig'), 13: '3 + 10 (thir-)', 15: '5 + 10 (fif-)', 18: '8 + 10 (eigh-)', 20: '2 × 10 (twen-)',
  30: '3 × 10 (thir-)', 40: '4 × 10 (for-)', 50: '5 × 10 (fif-)', 80: '8 × 10 (eigh-)', 100: '100' };
for (let i = 13; i < 20; i++) GLOSS[i] ??= `${i - 10} + 10 (-teen)`;
for (let i = 30; i < 100; i += 10) GLOSS[i] ??= `${i / 10} × 10 (-ty)`;

const wordOf = n => BASE[n]?.[1] ?? EXTRA[n];
const term = n => ({ n, t: wordOf(n), full: wordOf(n), ids: BASE[n] ? [BASE[n][0]] : [], gloss: GLOSS[n], alt: ALT[n] ?? [wordOf(n)] });

// Teile des Zahlworts: Glieder {n, t, full, ids, gloss, alt}; 21–99 = Zehner + Einer
export function parts(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX) throw new RangeError(`Zahl außerhalb 0–${MAX}: ${n}`);
  if (wordOf(n)) return [term(n)];
  const u = n % 10;
  return [term(n - u), term(u)];
}
// Alle gleichwertigen Schreibweisen (erste = Standard): twenty-one, a hundred
export const variants = n => parts(n).reduce((acc, p) => acc.flatMap(a => p.alt.map(b => a ? a + '-' + b : b)), ['']);
export const word = n => variants(n)[0];
export const hyphenated = word;
// Rechenweg: 35 → „30 + 5“
export function formula(n) {
  const u = n % 10;
  return wordOf(n) || !u ? String(n) : `${n - u} + ${u}`;
}
// Hörbausteine: jede Zahl bis 100 hat eine eigene Datei (scripts/numbers-audio.mjs)
export const chunks = n => [n];
export const AUDIO_NS = [...Array(101).keys()];

// Uhrzeit (volle Stunde): „It's seven o'clock.“ (Tatoeba); ohne Apostroph-Taste auch „it is seven oclock“
export const clockVariants = h => [`It's ${word(h)} o'clock`, `It is ${word(h)} o'clock`].flatMap(s => [s, s.replace(/'/g, '')]);
export const clock = h => clockVariants(h)[0];
// Preis in Pfund: one pound, five pounds
export const priceVariants = n => n === 1 ? ['one pound', 'a pound'] : variants(n).map(w => w + ' pounds');
export const price = n => priceVariants(n)[0];
export const money = n => `£${n}`;

// Hinweise für den Zahlentrainer (views/numbers.js): Einleitung, Regel-Grammatik, Fußnote, Tipphilfe je Modus (wie sv/de)
export const hints = () => ({
  intro: t('Englisch zählt in Zehnern, Zehner vor Einer mit Bindestrich: 35 = thirty-five.') + ' ' + t('13–19 enden auf -teen, die Zehner auf -ty. Regeln:'),
  grammar: 'g-en-zahlen',
  note: t('Hinweis: alle Zahlwörter von 0 bis 100 sind nach Wiktionary belegt.'),
  write: t('Zehner und Einer mit Bindestrich: twenty-five.'), clock: t("Uhrzeit: It's … o'clock."), price: t('Preis: … pounds (1: one pound).'),
});
