// Schwedische Zahlwörter 0–999 999 mit Zerlegung zur Erklärung – Gegenstück zu numbers.js (Georgisch), gleiche Schnittstelle.
// Ohne Abhängigkeiten, damit scripts/test-numbers.mjs das Modul direkt in Node laden kann.
//
// Belege (Stand 2026-10-31, Prüfung: scripts/test-numbers.mjs):
// - Grundformen 0–12 und 20 = Vokabeln aus data/sv/vocab (sv-A1-04); der Test vergleicht BASE mit den Dateien.
// - 13–19, die Zehner 30–90, hundra und tusen sind KEINE Vokabeln (keine Lektion führt sie ein, R10: Inhalte eingefroren),
//   sondern Bausteine des Generators. Alle stehen so im englischen Wiktionary (data/raw/sv/wikt-index.json), ebenso
//   tjugoett/tjugoen, tjugotvå, trettiofem, tvåhundra; der Test gleicht jedes Zahlwort des Index ab.
// - „Klockan är tre.“ Tatoeba t-12270548, „Klockan är halv ett.“ t-13385143 (1 Uhr = ett), „Det kostar tjugo kronor.“ sv-A1-05.
// UNGEPRÜFT (Regelwissen von Claude): Zusammensetzungen über 100 werden zusammengeschrieben (tvåhundrafemtio, tvåtusentjugosex),
//   drei gleiche Konsonanten werden zu zwei (ett + tusen → ettusen, tjugoett + tusen → tjugoettusen); „en krona“ für 1.

import { t } from './i18n.js';

// Wert → [Vokabel-ID, Wort]
export const BASE = {
  0: ['noll', 'noll'], 1: ['ett', 'ett'], 2: ['tva', 'två'], 3: ['tre', 'tre'], 4: ['fyra', 'fyra'], 5: ['fem', 'fem'],
  6: ['sex', 'sex'], 7: ['sju', 'sju'], 8: ['atta', 'åtta'], 9: ['nio', 'nio'], 10: ['tio', 'tio'], 11: ['elva', 'elva'],
  12: ['tolv', 'tolv'], 20: ['tjugo', 'tjugo'],
};
// Bausteine ohne Vokabel (Wiktionary-Belege s. oben)
export const EXTRA = {
  13: 'tretton', 14: 'fjorton', 15: 'femton', 16: 'sexton', 17: 'sjutton', 18: 'arton', 19: 'nitton',
  30: 'trettio', 40: 'fyrtio', 50: 'femtio', 60: 'sextio', 70: 'sjuttio', 80: 'åttio', 90: 'nittio', 100: 'hundra', 1000: 'tusen',
};
export const MAX = 999999;
// Gleichwertige Schreibweisen: 1 = ett/en (tjugoett/tjugoen), etthundra, ettusen
const ALT = { 1: ['ett', 'en'], 100: ['hundra', 'etthundra'], 1000: ['tusen', 'ettusen'] };

const GLOSS = { 20: t('unregelmäßig'), 18: t('8 + 10, ohne å'), 14: t('4 + 10, fj-'), 100: '100', 1000: '1000' };
for (let i = 13; i < 20; i++) GLOSS[i] ??= `${i - 10} + 10 (-ton)`;
for (let i = 30; i < 100; i += 10) GLOSS[i] = `${i / 10} × 10 (-tio)`;

const wordOf = n => BASE[n]?.[1] ?? EXTRA[n];
const term = n => ({ n, t: wordOf(n), full: wordOf(n), ids: BASE[n] ? [BASE[n][0]] : [], gloss: GLOSS[n], alt: ALT[n] ?? [wordOf(n)] });

function below100(n) {
  if (wordOf(n)) return [term(n)];
  const u = n % 10;
  return [term(n - u), term(u)];
}
function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  if (!h) return below100(n);
  const head = h === 1 ? term(100)
    : { n: h * 100, t: wordOf(h) + 'hundra', full: wordOf(h) + 'hundra', ids: [BASE[h][0]], gloss: `${h} × 100`, alt: [wordOf(h) + 'hundra'] };
  return r ? [head, ...below100(r)] : [head];
}

// Teile des Zahlworts in Schreibreihenfolge: Glieder {n, ka, full, ids, gloss, alt}; ka = full (Schwedisch kürzt nichts).
// ids = Vokabel-IDs (nur Grundformen 0–12, 20), alt = gleichwertige Schreibweisen des Glieds.
export function parts(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX) throw new RangeError(`Zahl außerhalb 0–${MAX}: ${n}`);
  const k = Math.floor(n / 1000), r = n % 1000;
  if (!k) return below1000(n);
  const head = k === 1 ? [term(1000)] : [...below1000(k), { ...term(1000), gloss: '× 1000', alt: ['tusen'] }];
  return r ? [...head, ...below1000(r)] : head;
}

// Zusammenschreiben: drei gleiche Konsonanten → zwei (ett + tusen → ettusen)
const glue = (a, b) => a && b && a.at(-1) === b[0] && a.at(-2) === b[0] ? a + b.slice(1) : a + b;
// Alle gleichwertigen Schreibweisen (erste = Standard)
export function variants(n) {
  return parts(n).reduce((acc, p) => acc.flatMap(a => p.alt.map(b => glue(a, b))), ['']);
}
export const word = n => variants(n)[0];
// Mit Bindestrichen zwischen den Gliedern, zum Erklären: tjugo-fem, tvåhundra-fyrtio-sju
export const hyphenated = n => parts(n).map(p => p.t).join('-');
// Getipptes Zahlwort richtig? Groß/klein, Leerzeichen und Bindestriche egal (tvåtusen trehundra)
const norm = s => s.toLowerCase().replace(/[\s-]+/g, '');
export const accepts = (n, s) => variants(n).map(norm).includes(norm(s));

// Rechenweg: 35 → „30 + 5“, 347 → „300 + 40 + 7“, 2005 → „2 × 1000 + 5“
export function formula(n) {
  const k = Math.floor(n / 1000), h = Math.floor(n % 1000 / 100) * 100, r = n % 100, u = r % 10;
  const out = [];
  if (k) out.push(k > 1 ? `${k} × 1000` : '1000');
  if (h) out.push(String(h));
  if (r && (wordOf(r) || !u)) out.push(String(r)); else if (r) out.push(String(r - u), String(u));
  return out.join(' + ') || '0';
}

// Hörbausteine: Zahlen mit eigener Audiodatei (0–100, volle Hunderter, 1000), z. B. 2347 → [2, 1000, 300, 47]
export function chunks(n) {
  const k = Math.floor(n / 1000), h = Math.floor(n % 1000 / 100) * 100, r = n % 100;
  if (n <= 100) return [n];
  return [...(k ? [...(k > 1 ? chunks(k) : []), 1000] : []), ...(h ? [h] : []), ...(r ? [r] : [])];
}
// Zahlen, für die scripts/numbers-audio.mjs eine Datei erzeugt
export const AUDIO_NS = [...Array(101).keys(), 200, 300, 400, 500, 600, 700, 800, 900, 1000];

// Uhrzeit (volle Stunde): „Klockan är tre.“ (1 Uhr: klockan är ett)
export const clockVariants = h => variants(h).filter(w => h !== 1 || w === 'ett').map(w => 'klockan är ' + w);
export const clock = h => clockVariants(h)[0];

// Preis in Kronen: en krona, tjugo kronor (Öre gibt es seit 2010 nicht mehr als Münze)
export const priceVariants = kr => kr === 1 ? ['en krona'] : variants(kr).map(w => w + ' kronor');
export const price = kr => priceVariants(kr)[0];

export const CURRENCY = 'kr';
// Hinweise für den Zahlentrainer (views/numbers.js): Einleitung, Regel-Grammatik, Fußnote, Tipphilfe je Modus
export const hints = () => ({
  intro: t('Schwedisch: Zehner vor Einer, alles in einem Wort – 35 = trettio-fem, 347 = trehundra-fyrtio-sju.') + ' ' + t('13–19 enden auf -ton, die Zehner auf -tio. Regeln:'),
  grammar: 'g-sv-zahlen',
  note: t('Hinweis: 0–100, die Hunderter und tusen sind nach Wiktionary belegt (auch tjugoen/tjugoett, etthundra);') + ' ' +
    t('längere Zusammensetzungen (hundraett, tvåtusentjugosex) folgen der Regel „alles zusammenschreiben“ und sind noch ungeprüft.'),
  write: t('Ein Wort ohne Leerzeichen: tjugofem.'), clock: t('Uhrzeit: klockan är …'), price: t('Preis: … kronor (1: en krona).'),
});
export const money = kr => `${kr} kr`;
