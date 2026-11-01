// Deutsche Zahlwörter 0–100 mit Zerlegung zur Erklärung – gleiche Schnittstelle wie numbers-sv.js (Kurs ka-de, P7 C4).
// Ohne Abhängigkeiten außer i18n, damit scripts/test-numbers.mjs das Modul direkt in Node laden kann.
//
// Belege (Stand 2026-10-31, Prüfung: scripts/test-numbers.mjs):
// - Grundformen 0–12 und 20 = Vokabeln aus data/de/vocab (de-A0-03…06, de-A1-02); der Test vergleicht BASE mit den Dateien.
// - 13–19, die Zehner 30–90 und hundert sind KEINE Vokabeln, sondern Bausteine des Generators; sie und alle Zusammensetzungen
//   21–99 („Einer und Zehner“, einundzwanzig), die das en-Wiktionary führt, gleicht der Test mit data/raw/de/wikt-index.json ab.
// - Uhrzeit „Es ist ein Uhr.“ Tatoeba t-924875, „Es ist drei Uhr.“ t-8349577; Preis „Das kostet zwei Euro.“ t-1126552.
// UNGEPRÜFT (Regelwissen von Claude): „ein Euro“ für 1 (in Tatoeba nicht belegt).

import { t } from './i18n.js';

// Wert → [Vokabel-ID, Wort]
export const BASE = {
  0: ['null', 'null'], 1: ['eins', 'eins'], 2: ['zwei', 'zwei'], 3: ['drei', 'drei'], 4: ['vier', 'vier'], 5: ['fuenf', 'fünf'],
  6: ['sechs', 'sechs'], 7: ['sieben', 'sieben'], 8: ['acht', 'acht'], 9: ['neun', 'neun'], 10: ['zehn', 'zehn'], 11: ['elf', 'elf'],
  12: ['zwoelf', 'zwölf'], 20: ['zwanzig', 'zwanzig'],
};
// Bausteine ohne Vokabel (Wiktionary-Belege s. oben)
export const EXTRA = {
  13: 'dreizehn', 14: 'vierzehn', 15: 'fünfzehn', 16: 'sechzehn', 17: 'siebzehn', 18: 'achtzehn', 19: 'neunzehn',
  30: 'dreißig', 40: 'vierzig', 50: 'fünfzig', 60: 'sechzig', 70: 'siebzig', 80: 'achtzig', 90: 'neunzig', 100: 'hundert',
};
export const MAX = 100;
export const CURRENCY = '€';
export const money = e => `${e} €`;
// Gleichwertige Schreibweisen: 100 = hundert/einhundert
const ALT = { 100: ['hundert', 'einhundert'] };

const GLOSS = { 16: '6 + 10 (sech-)', 17: '7 + 10 (sieb-)', 30: '3 × 10 (-ßig)', 100: '100' };
for (let i = 13; i < 20; i++) GLOSS[i] ??= `${i - 10} + 10 (-zehn)`;
for (let i = 40; i < 100; i += 10) GLOSS[i] = `${i / 10} × 10 (-zig)`;

const wordOf = n => BASE[n]?.[1] ?? EXTRA[n];
const term = n => ({ n, t: wordOf(n), full: wordOf(n), ids: BASE[n] ? [BASE[n][0]] : [], gloss: GLOSS[n], alt: ALT[n] ?? [wordOf(n)] });

// Teile in Schreibreihenfolge: Einer zuerst, dann „und“, dann Zehner (47 = sieben-und-vierzig); eins wird zu ein (einundzwanzig).
// Glieder {n, t, full, ids, gloss, alt} wie numbers-sv.js; „und“ hat n = null (in der Erklärtabelle ausgeblendet).
export function parts(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX) throw new RangeError(`Zahl außerhalb 0–${MAX}: ${n}`);
  if (wordOf(n)) return [term(n)];
  const u = n % 10, ten = n - u;
  const one = u === 1 ? { ...term(1), t: 'ein', alt: ['ein'] } : term(u);
  return [one, { n: null, t: 'und', full: 'und', ids: [], alt: ['und'] }, term(ten)];
}

// Alle gleichwertigen Schreibweisen (erste = Standard)
export function variants(n) {
  return parts(n).reduce((acc, p) => acc.flatMap(a => p.alt.map(b => a + b)), ['']);
}
export const word = n => variants(n)[0];
// Mit Bindestrichen zwischen den Gliedern, zum Erklären: ein-und-zwanzig
export const hyphenated = n => parts(n).map(p => p.t).join('-');
const norm = s => s.toLowerCase().replace(/[\s-]+/g, '');
export const accepts = (n, s) => variants(n).map(norm).includes(norm(s));

// Rechenweg in Sprechreihenfolge: 47 → „7 + 40“
export function formula(n) {
  if (wordOf(n)) return String(n);
  const u = n % 10;
  return `${u} + ${n - u}`;
}

// Hörbausteine: jede Zahl 0–100 hat eine eigene Audiodatei
export const chunks = n => [n];
export const AUDIO_NS = [...Array(101).keys()];

// Uhrzeit (volle Stunde): „Es ist drei Uhr.“, 1 Uhr = „ein Uhr“ (t-924875)
export const clockVariants = h => [`Es ist ${h === 1 ? 'ein' : word(h)} Uhr`];
export const clock = h => clockVariants(h)[0];

// Preis in ganzen Euro: „zwei Euro“ (t-1126552), 1 = „ein Euro“ (ungeprüft)
export const priceVariants = e => e === 1 ? ['ein Euro'] : variants(e).map(w => w + ' Euro');
export const price = e => priceVariants(e)[0];

// Hinweise für den Zahlentrainer (views/numbers.js): Einleitung, Regel-Grammatik, Fußnote, Tipphilfe je Modus
export const hints = () => ({
  intro: t('Deutsch: Einer vor Zehner, alles in einem Wort – 21 = ein-und-zwanzig, 47 = sieben-und-vierzig.') + ' ' + t('13–19 enden auf -zehn, die Zehner auf -zig (30: dreißig). Regeln:'),
  grammar: 'g-de-zahlen',
  note: t('Hinweis: 0–100 sind nach Wiktionary belegt (Grundzahlen, -zehn, -zig und die Zusammensetzungen mit und).'),
  write: t('Ein Wort ohne Leerzeichen: einundzwanzig.'), clock: t('Uhrzeit: Es ist … Uhr (1: ein Uhr).'), price: t('Preis: … Euro (1: ein Euro).'),
});
