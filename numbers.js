// Georgische Zahlwörter 0–999 999 (Zwanzigersystem) mit Zerlegung zur Erklärung. Ohne Abhängigkeiten,
// damit scripts/test-numbers.mjs das Modul direkt in Node laden kann.
//
// Belege (Stand 2026-10-27, Prüfung: scripts/test-numbers.mjs):
// - Grundformen = Vokabeln aus data/vocab (A0/A1-04/A1-05); der Test vergleicht BASE mit den Dateien.
// - 21–99 vollständig, 200–900 (ორასი … ცხრაასი, auch რვაასი/ცხრაასი ohne Verschmelzung) und ათასი stehen
//   so im englischen Wiktionary (data/raw/wikt-index.json).
// - „სამი ათასი“ (3000) belegt Tatoeba t-13061596; „X საათია“ für 1–12 Uhr Tatoeba t-2750835 ff.
// UNGEPRÜFT (verified: false, Regelwissen von Claude, kein Beleg in unseren Quellen):
// - Zusammensetzungen über 100 werden getrennt geschrieben und das vordere Glied verliert -ი:
//   ას ერთი (101), ორას ოცდახუთი (225), ათას ცხრაას ოთხმოცდაათი (1990), ორი ათას ხუთი (2005).
//   (Nur indirekt gestützt: altgeorgisches Zitat „ათას ოთხას …“ in Wiktionary.)
// - Der Multiplikator vor ათასი bleibt voll: ორი ათასი, ოცდახუთი ათასი.
// - Preise „X ლარი და Y თეთრი“ (Muster aus g-zahlen.md, selbst verified: false).

import { t } from './i18n.js';

// Wert → [Vokabel-ID, Mkhedruli]
export const BASE = {
  0: ['nuli', 'ნული'], 1: ['erti', 'ერთი'], 2: ['ori', 'ორი'], 3: ['sami', 'სამი'], 4: ['otkhi', 'ოთხი'],
  5: ['khuti', 'ხუთი'], 6: ['ekvsi', 'ექვსი'], 7: ['shvidi', 'შვიდი'], 8: ['rva', 'რვა'], 9: ['tskhra', 'ცხრა'],
  10: ['ati', 'ათი'], 11: ['tertmeti', 'თერთმეტი'], 12: ['tormeti', 'თორმეტი'], 13: ['tsameti', 'ცამეტი'],
  14: ['totkhmeti', 'თოთხმეტი'], 15: ['tkhutmeti', 'თხუთმეტი'], 16: ['tekvsmeti', 'თექვსმეტი'],
  17: ['chvidmeti', 'ჩვიდმეტი'], 18: ['tvrameti', 'თვრამეტი'], 19: ['tskhrameti', 'ცხრამეტი'],
  20: ['otsi', 'ოცი'], 40: ['ormotsi', 'ორმოცი'], 60: ['samotsi', 'სამოცი'], 80: ['otkhmotsi', 'ოთხმოცი'],
  100: ['asi', 'ასი'],
};
export const MAX = 999999;

const GLOSS = { 40: '2 × 20', 60: '3 × 20', 80: '4 × 20', 13: t('10 + 3, unregelmäßig'), 17: t('10 + 7, unregelmäßig') };
for (let i = 11; i < 20; i++) GLOSS[i] ??= `10 + ${i - 10}`;

// Vorderglied einer Zusammensetzung: auslautendes -ი fällt weg (ოცი → ოც-და-…, ასი → ას …); რვა/ცხრა bleiben.
const stem = w => w.endsWith('ი') ? w.slice(0, -1) : w;
const term = n => ({ n, t: BASE[n][1], full: BASE[n][1], ids: [BASE[n][0]], gloss: GLOSS[n] });
const cut = p => ({ ...p, t: stem(p.full) });
const SP = { t: ' ' }, DA = { t: 'და', join: true };

function below100(n) {
  if (BASE[n]) return [term(n)];
  const r = n % 20;
  return [cut(term(n - r)), DA, term(r)];
}
function hundreds(h) {
  if (h === 1) return term(100);
  const full = stem(BASE[h][1]) + 'ასი';
  return { n: h * 100, t: full, full, ids: [BASE[h][0], 'asi'], gloss: `${h} × 100` };
}
function below1000(n) {
  const h = Math.floor(n / 100), r = n % 100;
  if (!h) return below100(n);
  return r ? [cut(hundreds(h)), SP, ...below100(r)] : [hundreds(h)];
}

// Teile des Zahlworts in Schreibreihenfolge: Glieder {n, ka, full, ids, gloss} und Verbinder {ka} (და / Leerzeichen).
// ka = Form im Wort (ggf. gekürzt), full = Grundform, ids = Vokabel-IDs für Audio-Bausteine.
export function parts(n) {
  if (!Number.isInteger(n) || n < 0 || n > MAX) throw new RangeError(`Zahl außerhalb 0–${MAX}: ${n}`);
  const k = Math.floor(n / 1000), r = n % 1000;
  if (!k) return below1000(n);
  const th = { n: 1000, t: 'ათასი', full: 'ათასი', ids: ['ati', 'asi'], gloss: k > 1 ? `× 1000` : '10 × 100' };
  const head = k === 1 ? [th] : [...below1000(k), SP, th];
  if (!r) return head;
  head[head.length - 1] = cut(th);
  return [...head, SP, ...below1000(r)];
}

export const word = n => parts(n).map(p => p.t).join('');
// Mit Bindestrichen um და, zum Erklären: ოც-და-ჩვიდმეტი
export const hyphenated = n => parts(n).map(p => p.join ? '-და-' : p.t).join('');

// Rechenweg: 37 → „20 + 17“, 99 → „80 + 19“, 2005 → „2 × 1000 + 5“
export function formula(n) {
  const k = Math.floor(n / 1000), h = Math.floor(n % 1000 / 100) * 100, te = n % 100 - n % 20, r = n % 20;
  const out = [];
  if (k) out.push(k > 1 ? `${k} × 1000` : '1000');
  if (h) out.push(String(h));
  if (te && r) out.push(String(te), String(r)); else if (te || r) out.push(String(te + r));
  return out.join(' + ') || '0';
}

// Uhrzeit (volle Stunde): „Es ist X Uhr“. 1 Uhr mit Ordinalzahl პირველი (Tatoeba t-2750835).
export const clock = h => (h === 1 ? 'პირველი' : word(h)) + ' საათია';

// Preis: X ლარი [და Y თეთრი] – Nomen nach Zahl im Singular (g-zahlen.md, ungeprüft)
export function price(lari, tetri = 0) {
  const out = [];
  if (lari) out.push(word(lari) + ' ლარი');
  if (tetri) out.push(word(tetri) + ' თეთრი');
  return out.join(' და ') || word(0) + ' ლარი';
}
