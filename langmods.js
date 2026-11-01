// Sprachspezifische Übungsmodule je Zielsprache (P7 C3) – statt isKa()-Abfragen fragt die App hier, was die Zielsprache
// mitbringt. Fehlt ein Modul (z. B. Zahlen für en), blendet die App die Übung aus (Kachel, Heute-Schritt, #/numbers).
// Schon über /api/data → lang (lang.json) gesteuert: Umschrift (translit), Buchstabenkurs (letters), Tastatur (keys),
// Minimalpaare (partners/sounds + pairs), Formen-Drill (formKeys), ASR (asr).
// numbers: Generator (numbers-<tgt>.js: parts/word/hyphenated/formula/clock/price), Lektion „bis 20“ und „bis 100“
// (Heute-Schritt, Bereich), Regel-Lektion (#/numbers), Bereiche. Neue Zielsprache = Generator + Eintrag hier (C4: Deutsch, Englisch 0–100).
// Ein Modul gilt nur, wenn der Kurs seine Lektion from20 hat: Englisch-Anfänger (ka-en) ja, Expertenkurs de-en ohne en-A1 nein.
import * as KA from './numbers.js';
import * as SV from './numbers-sv.js';
import * as DE from './numbers-de.js';
import * as EN from './numbers-en.js';
import { LANG, lessonIdx } from './data.js';

const MODS = {
  ka: { numbers: { gen: KA, from20: 'A1-04', from100: 'A1-05', rule: 'A1-05', ranges: [20, 100, 1000, 10000] } },
  sv: { numbers: { gen: SV, from20: 'sv-A1-04', from100: 'sv-A1-08', rule: 'sv-A1-04', ranges: [20, 100, 1000] } },
  de: { numbers: { gen: DE, from20: 'de-A1-02', from100: 'de-A1-05', rule: 'de-A1-02', ranges: [20, 100] } },
  en: { numbers: { gen: EN, from20: 'en-A1-02', from100: 'en-A1-03', rule: 'en-A1-02', ranges: [20, 100] } },
};
export const langMod = name => { const m = MODS[LANG().code]?.[name]; return m && (!m.from20 || lessonIdx(m.from20) >= 0) ? m : null; };
