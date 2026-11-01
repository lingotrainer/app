// Datenmodell der Lerninhalte (P7 C1) – die eine Stelle, an der Server, Build und App Glossen/Übersetzungen lesen:
//   Vokabel  {id, t, gloss: {<sprache>: [Bedeutung, …]}, glossClaude?: {<sprache>: […]}, …}     t = Text in der Zielsprache
//   Satz     {id, t, tr: {<sprache>: [Übersetzung, …]}, trClaude?: {<sprache>: '…'}, trChecked?: {<sprache>: 'wer datum'}}
//   Zeile    {t, tr: {<sprache>: '…'}, wrong?: [{t, tr}]}            (Dialoge, Lesetexte; tr-Werte Zeichenkette oder Liste)
//   Text     Zeichenkette (= Deutsch, Altbestand) oder {<sprache>: '…'} (Titel, Glossar, Hinweise)
// chain = Sprachen in Reihenfolge (Ausgangssprache des Kurses, dann Rückfall), nie die Zielsprache selbst (chainOf).
export const chainOf = (src = 'de', fallback = ['en', 'de'], tgt = null) => [...new Set([src, ...fallback])].filter(l => l !== tgt);
const list = v => Array.isArray(v) ? v.filter(Boolean) : v ? [String(v)] : [];

// Glossen einer Vokabel: {list, lang, claude} der ersten Sprache mit Einträgen (geprüft vor ungeprüft je Sprache)
export function glossOf(v, chain = ['de']) {
  for (const l of chain) {
    const g = list(v?.gloss?.[l]);
    if (g.length) return { list: g, lang: l, claude: false };
    const c = list(v?.glossClaude?.[l]);
    if (c.length) return { list: c, lang: l, claude: true };
  }
  return { list: [], lang: null, claude: false };
}
// Übersetzung eines Satzes/einer Zeile: {text, all, lang, claude}; claude = Übersetzung von Claude, noch nicht geprüft
export function trOf(x, chain = ['de']) {
  for (const l of chain) {
    const a = list(x?.tr?.[l]);
    if (a.length) return { text: a[0], all: a, lang: l, claude: false };
    const c = list(x?.trClaude?.[l]);
    if (c.length) return { text: c[0], all: c, lang: l, claude: !x.trChecked?.[l] };
  }
  return { text: '', all: [], lang: null, claude: false };
}
// Erklärtext (Zeichenkette = Deutsch oder {<sprache>: …})
export function textOf(x, chain = ['de']) {
  if (x == null || typeof x !== 'object') return x ?? '';
  for (const l of [...chain, 'de']) if (x[l]) return x[l];
  return Object.values(x)[0] ?? '';
}
