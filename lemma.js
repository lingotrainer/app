// Wort → Lemma auflösen (Lesemodus, Dialoge, scripts/validate.mjs). Ohne DOM, läuft im Browser und in Node.
// Reihenfolge: Glossar des Textes → Vokabel (t) → Flexionsform aus `forms` → Zahlwort (Zwanzigersystem) → Endung abtrennen (geraten).
// Andere Sprachen (sv): Nomen stehen mit Artikel im Wortschatz (en bil) → Schlüssel ohne Artikel (opts.articles),
// Satzanfang groß → zweiter Versuch klein, eigene grobe Endungslisten (SV_SUFFIXES, DE_SUFFIXES), keine Zahlwörter.

const NUM = {
  'ერთი': 1, 'ორი': 2, 'სამი': 3, 'ოთხი': 4, 'ხუთი': 5, 'ექვსი': 6, 'შვიდი': 7, 'რვა': 8, 'ცხრა': 9, 'ათი': 10,
  'თერთმეტი': 11, 'თორმეტი': 12, 'ცამეტი': 13, 'თოთხმეტი': 14, 'თხუთმეტი': 15, 'თექვსმეტი': 16, 'ჩვიდმეტი': 17, 'თვრამეტი': 18, 'ცხრამეტი': 19,
};
const TENS = { 'ოც': 20, 'ორმოც': 40, 'სამოც': 60, 'ოთხმოც': 80 };
// [Endung, Ersatz, Erklärung, Formschlüssel wie in `forms`] – grobe Heuristik, Ergebnis wird als „vermutlich“ markiert
const SUFFIXES = [
  ['ია', 'ი', 'Kurzform „ist“ (-ა)'], ['აა', 'ა', 'Kurzform „ist“ (-ა)'], ['ა', '', 'Kurzform „ist“ (-ა)'],
  ['ში', 'ი', '-ში „in“'], ['ში', '', '-ში „in“'], ['ზე', 'ი', '-ზე „auf“'], ['ზე', '', '-ზე „auf“'],
  ['თან', 'ი', '-თან „bei“'], ['ები', 'ი', 'Plural -ები', 'pl'], ['ებს', 'ი', 'Plural Dativ', 'pl'], ['ებმა', 'ი', 'Plural Ergativ', 'pl'],
  ['ის', 'ი', 'Genitiv -ის', 'gen'], ['ს', 'ი', 'Dativ -ს', 'dat'], ['ს', '', 'Dativ -ს', 'dat'], ['მა', 'ი', 'Ergativ -მა', 'erg'], ['მა', '', 'Ergativ -მა', 'erg'],
  ['ით', 'ი', 'Instrumental -ით', 'ins'], ['ად', 'ი', 'Adverbial -ად', 'adv'], ['იც', 'ი', '-ც „auch“'], ['ც', '', '-ც „auch“'],
];
// Schwedisch: nur, was `forms` nicht abdeckt (Genitiv-s, Adjektiv-Neutrum/Plural, bestimmte Form unregelmäßiger Nomen)
const SV_SUFFIXES = [
  ['s', '', 'Genitiv -s'], ['t', '', 'Neutrum -t (Adjektiv/Adverb)', 'n'], ['a', '', 'Plural/bestimmt -a (Adjektiv)', 'plAdj'],
  ['en', '', 'bestimmte Form -en', 'def'], ['et', '', 'bestimmte Form -et', 'def'], ['n', '', 'bestimmte Form -n', 'def'],
  ['ar', 'a', 'Präsens -r', 'pres'], ['r', '', 'Präsens -r', 'pres'], ['er', '', 'Präsens -er', 'pres'],
];
// Deutsch: nur Endungen von Adjektiven/Possessiva (meine, deinen, alte), alles andere über `forms`; Hinweis ohne Sprache (nur die Endung)
const DE_SUFFIXES = [['e', '', '-e'], ['en', '', '-en'], ['em', '', '-em'], ['er', '', '-er'], ['es', '', '-es']];

// Glossar-Eintrag {de: …, en: …, lemma?, note?} → Text je Sprache (Anzeige über txt() in data.js)
const langText = g => Object.fromEntries(Object.entries(g).filter(([k]) => /^[a-z]{2,3}$/.test(k)));
export const isKa = s => /[ა-ჰ]/.test(s);
// Text in Wörter und Zwischenräume/Satzzeichen zerlegen (Wort = Buchstaben jeder Schrift, also auch å/ä/ö;
// Apostroph zwischen Buchstaben gehört zum Wort: englisch don't, I'm, o'clock)
export const tokens = text => (text.match(/\p{L}+(?:['’]\p{L}+)*|(?:(?!\p{L})[^])+/gu) ?? []).map(t => ({ t, word: /\p{L}/u.test(t) }));

// opts.articles: Artikel, die im Wortschatz vor Nomen stehen (lang.json → articles, sv: en/ett)
export function makeLexicon(vocab, lessonOrder = [], { articles = [] } = {}) {
  const byKa = new Map(), byForm = new Map(), homographs = new Map(), phrases = [];
  const rank = id => { const i = lessonOrder.indexOf(id); return i < 0 ? Infinity : i; };
  const art = new RegExp(`^(${articles.join('|') || '(?!)'}) (?=\\S+$)`);
  const latinSuffixes = articles.includes('ett') ? SV_SUFFIXES : articles.includes('der') ? DE_SUFFIXES : [];   // en: nur `forms`
  // gleich geschriebene Einträge (კვირა A1-12 / A1-19): der aus der frühesten Lektion ist der Haupteintrag
  for (const v of [...vocab].sort((a, b) => rank(a.lesson) - rank(b.lesson))) {
    const key = v.t.replace(art, '');
    if (key.includes(' ')) phrases.push(v);
    if (!byKa.has(key)) byKa.set(key, v);
    else homographs.set(key, [...(homographs.get(key) ?? []), v]);
    for (const [k, f] of Object.entries(v.forms ?? {})) if (typeof f === 'string' && f !== v.t && !byForm.has(f)) byForm.set(f, { v, form: k });
  }

  function number(w) {
    for (const end of ['', 'ის', 'ს']) {           // ორმოცდაათის „von fünfzig“
      if (end && !w.endsWith(end)) continue;
      const b = end ? w.slice(0, -end.length) : w;
      for (const cand of end ? [b + 'ი', b] : [b]) {
        if (NUM[cand]) return { value: NUM[cand], parts: [cand] };
        for (const [t, n] of Object.entries(TENS)) {
          if (cand === t + 'ი') return { value: n, parts: [cand] };
          if (cand.startsWith(t + 'და') && NUM[cand.slice(t.length + 2)]) return { value: n + NUM[cand.slice(t.length + 2)], parts: [t + 'ი', 'და', cand.slice(t.length + 2)] };
        }
      }
    }
    return null;
  }

  // → {v?, gloss?, form? (Schlüssel wie in `forms`), guess?, note?, num?} oder null
  function lookup(w, glossary = {}, depth = 0) {
    if (!isKa(w)) return lookupLatin(w, glossary);
    const g = glossary[w];
    if (g) return typeof g === 'string' ? { gloss: g } : { gloss: langText(g), v: g.lemma ? vocab.find(x => x.id === g.lemma) : undefined, note: g.note };
    if (byKa.has(w)) return { v: byKa.get(w), alts: homographs.get(w) };
    if (byForm.has(w)) { const { v, form } = byForm.get(w); return { v, form }; }
    const n = number(w);
    if (n) {
      const vs = n.parts.map(p => byKa.get(p)).filter(Boolean);
      const v = vs.length === 1 && n.parts.length === 1 ? vs[0] : null;
      const last = vs.reduce((a, b) => rank(b.lesson) > rank(a.lesson) ? b : a, vs[0]);
      return v ? { v, form: w === v.t ? undefined : 'gen' } : { num: n.value, parts: vs, v: last && { ...last, t: w, gloss: { de: [String(n.value)], en: [String(n.value)] } }, note: `${n.parts.join(' + ')} = ${n.value}` + (w.endsWith('ის') ? ' · Genitiv -ის' : '') };
    }
    for (const [suf, rep, note, form] of SUFFIXES) {
      if (!w.endsWith(suf) || w.length - suf.length < 2) continue;
      const base = w.slice(0, -suf.length) + rep;
      const r = glossary[base] ? lookup(base, glossary) : byKa.has(base) ? { v: byKa.get(base) } : byForm.has(base) ? { ...byForm.get(base) } : null;
      if (r) return { ...r, form: r.form ?? (r.v && form), alts: r.v && homographs.get(r.v.t), guess: true, note: [note, r.note].filter(Boolean).join(' · ') };
      // zwei Endungen: წლისაა → წლის + ა (nur nach „ist“-Kurzform)
      if (suf.startsWith('ა') && !depth) {
        const inner = lookup(base, glossary, 1);
        if (inner) return { ...inner, guess: true, note: [...new Set([note, ...(inner.note ?? '').split(' · ')])].filter(Boolean).join(' · ') };
      }
    }
    return null;
  }

  // lateinische Schrift (sv, de): wie oben ohne Zahlwörter, Satzanfang/Großschreibung → klein nochmal
  function lookupLatin(w, glossary) {
    for (const x of [...new Set([w, w.toLowerCase()])]) {
      const g = glossary[x];
      if (g) return typeof g === 'string' ? { gloss: g } : { gloss: langText(g), v: g.lemma ? vocab.find(y => y.id === g.lemma) : undefined, note: g.note };
      if (byKa.has(x)) return { v: byKa.get(x), alts: homographs.get(x) };
      if (byForm.has(x)) { const { v, form } = byForm.get(x); return { v, form }; }
    }
    const lw = w.toLowerCase();
    for (const [suf, rep, note, form] of latinSuffixes) {
      if (!lw.endsWith(suf) || lw.length - suf.length < 2) continue;
      const base = lw.slice(0, -suf.length) + rep;
      const r = byKa.has(base) ? { v: byKa.get(base) } : byForm.has(base) ? { ...byForm.get(base) } : null;
      if (r) return { ...r, form: r.form ?? form, alts: homographs.get(r.v.t), guess: true, note };
    }
    return null;
  }

  // Mehrwortvokabeln (დილა მშვიდობისა) zusammenfassen: tokens → [{t, word, phrase?: v}]
  function segment(text) {
    const ts = tokens(text);
    for (const p of phrases) {
      const ws = p.t.replace(art, '').split(' ');
      for (let i = 0; i + 2 * ws.length - 2 < ts.length; i++) {
        if (ws.every((x, k) => (ts[i + 2 * k].t === x || (k === 0 && ts[i].t.toLowerCase() === x)) && (k === 0 || ts[i + 2 * k - 1].t === ' ')))
          ts.splice(i, 2 * ws.length - 1, { t: ts.slice(i, i + 2 * ws.length - 1).map(x => x.t).join(''), word: true, phrase: p });
      }
    }
    return ts;
  }
  return { lookup, segment, number };
}
