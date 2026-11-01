// Lerndaten (Alphabet, Wortschatz, Lektionen) und SRS-Zustand, einmal beim Start geladen.
import { api } from './util.js';
import { pendingProgress, lastOf } from './offline.js';
import { chainOf, glossOf, trOf as trIn, textOf } from './core/model.js';

export let D;                 // {alphabet, vocab, lessons}
export let P = {};            // SRS-Zustand: key -> {ease, ivl, reps, lapses, due}
export async function loadData() {
  [D, P] = await Promise.all([api('/api/data'), api('/api/progress')]);
  await mergeNewer(await pendingProgress());   // offline gepufferter Stand ist evtl. neuer als der gecachte
}
async function mergeNewer(src) {
  if (!src || src.error) return;
  for (const [k, c] of Object.entries(src)) if (!P[k] || lastOf(c) > lastOf(P[k])) P[k] = c;
}
// Server hatte beim Senden neuere Karten (anderes Gerät) → übernehmen
addEventListener('srs-server-newer', async () => mergeNewer(await api('/api/progress').catch(() => null)));

// Lernsprache (P3): {code, name, brand, translit, asr, letters, keys}; ältere Server liefern nichts → Georgisch
export const LANG = () => D.lang ?? { code: 'ka', name: 'Georgisch', translit: true, asr: true, letters: true, keys: null };
export const isKa = () => LANG().code === 'ka';

// ---------- Kurs und Datenmodell (P7 C1/C3) ----------
// Kurs = Paar Ausgangs- → Zielsprache (courses/<src>-<tgt>.json, /api/data → course); ältere Server: de → Lernsprache.
// Ansichten lesen Glossen/Übersetzungen nur über diese Funktionen (Felder s. core/model.js), nie direkt .gloss/.tr.
export const COURSE = () => D.course ?? { id: 'de-' + LANG().code, src: 'de', tgt: LANG().code, fallback: ['en', 'de'] };
export const SRC = () => COURSE().src;
const chain = () => chainOf(COURSE().src, COURSE().fallback, COURSE().tgt);
// Bedeutungen einer Vokabel in der Ausgangssprache (Rückfall Englisch → Deutsch): Liste bzw. Text
export const gloss = v => glossOf(v, chain()).list;
export const glossText = (v, sep = ', ') => gloss(v).join(sep);
// nur eine bestimmte Sprache (z. B. englische Definition im Englischkurs)
export const glossIn = (v, lang) => glossOf(v, [lang]).list;
// Übersetzung eines Satzes/einer Dialogzeile: {text, all, lang, claude}; trText = nur der Text
export const trOf = x => trIn(x, chain());
export const trText = x => trOf(x).text;
// Erklärtexte (Titel, Glossar, Hinweise): Zeichenkette (Deutsch) oder {<sprache>: …}
export const txt = x => textOf(x, chain());
// Name einer Sprache in der Ausgangssprache (Hinweis „hier auf Englisch“)
export const langName = code => { try { return new Intl.DisplayNames([SRC()], { type: 'language' }).of(code); } catch { return code; } };

export const lessonIdx = id => D.lessons.findIndex(l => l.id === id);
// A0-Lektion (Schrift und Laute): Georgisch A0-01…, Schwedisch sv-A0-01… (wie app/sentences.mjs, logstats.mjs)
export const isA0 = id => /(^|-)A0-/.test(id ?? '');
// Lernstufe der aktuellen Lektion (/api/today → current): 'A0' | 'A1-frueh' (< A1-04, noch keine Zahlen) | 'A1' | 'A2';
// sv-Lektionen genauso ohne Präfix. Startseite, Wiederholen und Kopfzeile blenden danach aus, was noch nicht dran ist.
// Englisch (Experten: en-AU-…, en-B2-…, en-C1-…) hat keinen Anfängerteil → alles frei wie A2.
export function stageOf(current) {
  if (/^[a-z]+-(?!A\d-)[A-Z]/.test(current ?? '')) return 'A2';
  const m = /^(?:[a-z]+-)?(A\d)-(\d+)/.exec(current ?? '');
  if (!m) return 'A0';
  return m[1] === 'A1' && +m[2] < 4 ? 'A1-frueh' : m[1] === 'A0' || m[1] === 'A1' ? m[1] : 'A2';
}
// Lektion `id` erreicht (aktuelle Lektion gleich oder später)? Unbekannte Lektion → nein
export const reached = (current, id) => lessonIdx(id) >= 0 && lessonIdx(current) >= lessonIdx(id);
export const knownLetters = id => D.alphabet.filter(l => lessonIdx(l.lesson) <= lessonIdx(id));
export const letterBy = c => D.alphabet.find(l => l.char === c);
export const vocabBy = id => D.vocab.find(v => v.id === id);
// Hörkarte s:<id> (R8): {id, t, tr, trClaude?, lesson, audio, audioInfo, translit, ipa}
export const listenBy = id => D.listen?.find(s => s.id === id);
// Minimalpaar-Wörter außerhalb des Wortschatzes (pairs.json, nur Sprachen ohne Buchstabenkurs)
export const pairWordBy = id => D.pairs?.words.find(w => w.id === id);
export const PARTNER = { 'თ': 'ტ', 'ტ': 'თ', 'ფ': 'პ', 'პ': 'ფ', 'ქ': 'კ', 'კ': 'ქ', 'ც': 'წ', 'წ': 'ც', 'ჩ': 'ჭ', 'ჭ': 'ჩ',
  'ძ': 'ც', 'ჯ': 'ჩ', 'ყ': 'კ', 'ხ': 'ღ', 'ღ': 'ხ', 'ზ': 'ს', 'ს': 'ზ', 'შ': 'ჟ', 'ჟ': 'შ', 'ი': 'ე', 'ე': 'ი', 'ო': 'უ', 'უ': 'ო' };
// Verwechslungspartner wie PARTNERS in scripts/py/asr_server.py (Hörtraining, Minimalpaare)
export const PARTNERS = {
  'თ': 'ტდ', 'ტ': 'თდ', 'დ': 'ტთ', 'ფ': 'პბ', 'პ': 'ფბ', 'ბ': 'პფ',
  'ქ': 'კყგ', 'კ': 'ქყგ', 'გ': 'კქ', 'ყ': 'კქხ', 'ც': 'წძს', 'წ': 'ცძ', 'ძ': 'ცწზ',
  'ჩ': 'ჭჯშ', 'ჭ': 'ჩჯ', 'ჯ': 'ჩჭ', 'ხ': 'ღყ', 'ღ': 'ხრ', 'რ': 'ღლ',
  'ს': 'ზშ', 'ზ': 'სძ', 'შ': 'სჟ', 'ჟ': 'შზ', 'ა': 'ოე', 'ე': 'ია', 'ი': 'ე', 'ო': 'უა', 'უ': 'ო',
  'ვ': 'ბ', 'ლ': 'რ', 'მ': 'ნ', 'ნ': 'მ', 'ჰ': 'ხ',
};
export const arePartners = (a, b) => !!(PARTNERS[a]?.includes(b) || PARTNERS[b]?.includes(a));
// Lautieren (spell.js) lohnt bei Wörtern (≥ 2 Buchstaben, höchstens 2 Wörter), nicht bei Buchstaben und Sätzen; nur ka
export const canSpell = item => isKa() && !!item?.t && !item.char && item.t.trim().split(/\s+/).length <= 2 && [...item.t].filter(letterBy).length >= 2;
export const translit =s => [...s].map(c => letterBy(c)?.translit ?? c).join('');
// Buchstabe als übbares Element (Hörbeispiel/Aufnahme = Silbe Konsonant + ა)
export const letterItem = (l, lesson = l.lesson) => ({ ...l, id: 'letter-' + l.translit.replace("'", '_'), lesson });
