// Formen-Drill aus den Formtabellen (forms in data/vocab): Einzelform tippen oder ganzes Paradigma ausfüllen.
// Abgefragt wird nur, was in forms steht – fehlende Formen werden nicht erraten.
import { h, shuffle, log, md, api, $app } from '../util.js';
import { D, LANG, lessonIdx, knownLetters, vocabBy, translit, isKa, glossText, SRC, langName, txt } from '../data.js';
import { playBtn } from '../audio.js';
import { keyboard, setKeyHandler } from '../keyboard.js';
import { setLesson } from '../opts.js';
import { mistake } from '../mistakes.js';
import { t } from '../i18n.js';

// Reihenfolge = Tabellenspalten; pron = Pronomen als Spaltenkopf (Dativ-Verben: logisches Subjekt im Dativ)
// Formschlüssel: 1sg…3pl (Präsens), aor1sg…aor3pl (Aorist), fut1sg…fut3pl (Futur), opt1sg…opt3pl (Optativ), impf1sg…impf3pl (Imperfekt), masdar; Nomen: nom, erg, dat, gen, ins, adv, voc, pl;
// Adjektive: cmp (Komparativ), sup (Superlativ) – nur synthetische Formen (უკეთესი, უდიდესი), sonst უფრო/ყველაზე + Adjektiv
const PERSONS = ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl'];
const TENSE = { '': t('Präsens'), impf: t('Imperfekt'), aor: t('Aorist'), fut: t('Futur'), opt: t('Optativ') };
const PRON = { '1sg': 'მე', '2sg': 'შენ', '3sg': 'ის', '1pl': 'ჩვენ', '2pl': 'თქვენ', '3pl': 'ისინი' };
const PRON_DAT = { ...PRON, '3sg': 'მას', '3pl': 'მათ' };
const PRON_ERG = { ...PRON, '3sg': 'მან', '3pl': 'მათ' };
const PERS_LABEL = { '1sg': t('1. Person Singular'), '2sg': t('2. Person Singular'), '3sg': t('3. Person Singular'), '1pl': t('1. Person Plural'),
  '2pl': t('2. Person Plural'), '3pl': t('3. Person Plural') };
const CASES = ['erg', 'gen', 'ins', 'adv', 'voc'];
const LABEL = { ...PERS_LABEL, ...Object.fromEntries(['impf', 'aor', 'fut', 'opt'].flatMap(tn => PERSONS.map(p => [tn + p, `${TENSE[tn]} · ${PERS_LABEL[p]}`]))),
  masdar: t('Masdar (Verbalnomen)'), nom: t('Nominativ'), erg: t('Ergativ'), dat: t('Dativ'), gen: t('Genitiv'), ins: t('Instrumental'),
  adv: t('Adverbial'), voc: t('Vokativ'), pl: t('Plural'), cmp: t('Komparativ'), sup: t('Superlativ') };
const ORDER = [...PERSONS, ...PERSONS.map(p => 'impf' + p), ...PERSONS.map(p => 'aor' + p), ...PERSONS.map(p => 'fut' + p), ...PERSONS.map(p => 'opt' + p), 'masdar', 'nom', 'erg', 'dat', 'gen', 'ins', 'adv', 'voc', 'pl', 'cmp', 'sup'];
const tenseOf = f => { const m = f.match(/^(aor|fut|opt|impf)?\d(sg|pl)$/); return m ? m[1] ?? '' : null; };   // '' Präsens, 'impf', 'aor', 'fut', 'opt', null = keine Personalform
// Formgruppen: Präsens/Masdar/Dativ/Plural gibt es ab A1; aor, fut, cases, opt, degree, impf erst ab der Lektion, die sie einführt (Frontmatter formKeys)
// Andere Sprachen (sv): Formschlüssel und Bezeichnungen aus lang.json, jeder Schlüssel ist seine eigene Gruppe (formKeys: [pres, def] …),
// ohne immer freigeschaltete Grundgruppe; die Grundform (ka = Infinitiv/„en bil“) steht vorgegeben in der Tabelle.
const group = f => !isKa() ? f : tenseOf(f) ? tenseOf(f) : CASES.includes(f) ? 'cases' : f === 'cmp' || f === 'sup' ? 'degree' : 'base';
const groupsUpTo = L => new Set([...(isKa() ? ['base'] : []), ...D.lessons.filter(l => lessonIdx(l.id) <= lessonIdx(L.id)).flatMap(l => l.formKeys ?? [])]);
const label = f => isKa() ? LABEL[f] : f === 'base' ? t('Grundform') : txt(LANG().formLabels?.[f]) || f;

// Dativ-Verben (მინდა, მაქვს …): 1. Pl. mit გვ-, 1. Sg. nicht mit ვ- → Pronomen მას/მათ statt ის/ისინი
const isDativeVerb = v => v.pos === 'verb' && (v.forms['1pl'] ?? v.forms.aor1pl)?.includes('გვ') && !(v.forms['1sg'] ?? v.forms.aor1sg)?.startsWith('ვ');
// Aorist (und Optativ, gleiche Reihe): Subjekt transitiver (und der meisten -ებ-/-ობ-)Verben im Ergativ (მან/მათ); 3. Pl. auf -ნენ (მოვიდნენ, იყვნენ) = Nominativ
const aorPron = v => !v.forms.aor3pl ? { ...PRON, '3sg': 'ის/მან', '3pl': 'ისინი/მათ' } : v.forms.aor3pl.endsWith('ნენ') ? PRON : PRON_ERG;
const pron = (v, f) => {
  const tn = tenseOf(f);
  if (tn === null) return null;
  const p = f.replace(/^(aor|fut|opt|impf)/, '');
  return (isDativeVerb(v) ? PRON_DAT : tn === 'aor' || tn === 'opt' ? aorPron(v) : PRON)[p];
};
// Spalten eines Paradigmas (nur erlaubte Formgruppen); Grundform (= Stichwort) ist vorgegeben. Nomen: Nominativ = Stichwort.
const columns = (v, groups = null) => {
  if (!isKa()) return [{ f: 'base', ans: v.t, given: true },
    ...(LANG().formKeys ?? []).filter(f => v.forms?.[f] && (!groups || groups.has(f))).map(f => ({ f, ans: v.forms[f], given: false }))];
  const fs = { ...(v.pos === 'noun' ? { nom: v.t } : {}), ...v.forms };
  return ORDER.filter(f => fs[f] && (!groups || groups.has(group(f)))).map(f => ({ f, ans: fs[f], given: fs[f] === v.t }));
};
const withForms = v => v?.forms && Object.keys(v.forms).length > 0;
// Formen einer Vokabel, die bis Lektion L eingeführt sind (Lückentext-Ablenker: in A1 keine Aorist-/Futurformen)
export const formsAt = (v, L) => columns(v, groupsUpTo(L)).flatMap(c => c.ans.split(/[/,;]/).map(s => s.trim()));
// Lektion: eigene Wörter mit forms und `drill` (frühere Wörter, deren neue Formen – formKeys – die Lektion übt)
export const hasForms = L => formVocab([L]).length > 0;
// Abfragbare Wörter: {v, L, groups}; upTo = Lektion, bis zu der Formgruppen bekannt sind. Gleiche Wörter zusammengefasst.
function formVocab(lessons, upTo = lessons.at(-1)) {
  const all = groupsUpTo(upTo), byId = new Map();
  const add = (v, L, groups) => {
    const cur = byId.get(v.id);
    if (cur) groups.forEach(g => cur.groups.add(g)); else byId.set(v.id, { v, L, groups: new Set(groups) });
  };
  for (const L of lessons) {
    for (const v of (L.vocab ?? []).map(vocabBy).filter(withForms)) add(v, L, all);
    const own = (L.formKeys ?? []).filter(g => all.has(g));
    for (const v of (L.drill ?? []).map(vocabBy).filter(withForms)) add(v, L, own.length ? own : all);
  }
  return [...byId.values()].filter(x => columns(x.v, x.groups).some(c => !c.given));
}

// Buchstabenweiser Vergleich (LCS): getippte Buchstaben grün/rot, fehlende in der Lösung rot
function diff(typed, ans) {
  const a = [...typed], b = [...ans];
  const m = a.map(() => Array(b.length + 1).fill(0)); m.push(Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--)
    m[i][j] = a[i] === b[j] ? m[i + 1][j + 1] + 1 : Math.max(m[i + 1][j], m[i][j + 1]);
  const okA = new Set(), okB = new Set();
  for (let i = 0, j = 0; i < a.length && j < b.length;)
    if (a[i] === b[j]) { okA.add(i++); okB.add(j++); } else if (m[i + 1][j] >= m[i][j + 1]) i++; else j++;
  const mark = (cs, ok) => cs.map((c, k) => h('span', { class: ok.has(k) ? 'fc-ok' : 'fc-bad' }, c === ' ' ? '·' : c));
  return { typed: mark(a, okA), ans: mark(b, okB) };
}

// Regel-Hinweise: Grammatikkapitel der beteiligten Lektionen (einmal geladen, /api/grammar)
let grammar;
async function rules(lessons) {
  grammar ??= await api('/api/grammar').catch(() => []);
  const ids = [...new Set(lessons.flatMap(L => L.grammar ?? []))];
  const gs = ids.map(id => grammar.find(g => g.id === id)).filter(Boolean);
  if (!gs.length) return null;
  return h('div', { class: 'fc-rules' }, h('span', { class: 'small muted' }, t('Regeln:') + ' '),
    gs.map(g => h('details', {}, h('summary', {}, g.title, g.textLang && g.textLang !== SRC() ? h('span', { class: 'small muted' }, ` (${langName(g.textLang)})`) : null),
      h('div', { class: 'md', html: md(g.body) }))));
}

const head = v => h('div', {}, h('span', { class: 'ka', style: 'font-size:30px' }, v.t), ' ', h('span', { class: 'tr', 'data-ka': v.t }, v.translit), ' ',
  h('span', { class: 'ipa', 'data-ka': v.t }, v.ipa), ' – ', glossText(v), ' ', playBtn(v));

// Modus 1: Einzelform – „ვცხოვრობ → 3. Person Plural?“
// onDone({score, of, wrong}) statt Ergebniskarte (Heute-Ablauf)
// only: Set von '<vokabel>:<form>' (Fehlerheft)
function single(items, known, el, again, { n = 15, onDone, only, counter = null } = {}) {
  const qs = shuffle(items.flatMap(({ v, L, groups }) => columns(v, groups).filter(c => !c.given && (!only || only.has(`${v.id}:${c.f}`))).map(c => ({ v, L, ...c })))).slice(0, n);
  let i = 0, text = '', checked = false;
  const wrong = [];
  const prompt = h('div'), typed = h('div', { class: 'typed' }), fb = h('p', { class: 'feedback' }), count = h('div', { class: 'small muted' });
  const load = () => {
    const q = qs[i];
    text = ''; checked = false; typed.textContent = ''; typed.className = 'typed'; fb.textContent = '';
    if (counter) counter(i + 1, qs.length); else count.textContent = `${i + 1} / ${qs.length}`;
    const p = q.v.pos === 'verb' && pron(q.v, q.f) ? ` (${pron(q.v, q.f)} …)` : '';
    prompt.replaceChildren(head(q.v), h('div', { style: 'font-size:22px;margin:8px 0' }, '→ ', h('b', {}, label(q.f)), h('span', { class: 'ka' }, p), '?'));
  };
  const onKey = k => {
    const q = qs[i];
    if (k === 'Enter') {
      if (checked) { if (++i < qs.length) return load(); return done(); }
      checked = true;
      const ok = text.trim() === q.ans;
      typed.className = 'typed ' + (ok ? 'ok' : 'bad');
      const d = diff(text.trim(), q.ans);
      typed.replaceChildren(...d.typed);
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      fb.replaceChildren(ok ? t('✓ richtig') : h('span', {}, t('✗ richtig:') + ' ', h('span', { class: 'ka', style: 'font-size:24px' }, d.ans), ' ', isKa() ? h('span', { class: 'tr', 'data-ka': q.ans }, translit(q.ans)) : null),
        h('span', { class: 'muted small' }, '  ' + t('(⏎ weiter)')));
      if (!ok) wrong.push(q);
      log({ lesson: q.L.id, ex: 'forms', item: q.v.id, form: q.f, ok, typed: text });
      mistake('forms', `${q.v.id}:${q.f}`, { lesson: q.L.id, v: q.v.id, f: q.f }, ok);
      return;
    }
    if (checked) return;
    text = k === 'Backspace' ? text.slice(0, -1) : text + k;
    typed.textContent = text;
  };
  const done = () => {
    setKeyHandler(null);
    if (onDone) return onDone({ score: qs.length - wrong.length, of: qs.length, wrong: wrong.map(q => `${q.v.t} ${label(q.f)}: ${q.ans}`) });
    el.replaceChildren(h('div', { class: 'card flash' }, h('h2', {}, t('{score} / {n} richtig', { score: qs.length - wrong.length, n: qs.length })),
      wrong.length ? h('table', { class: 'words' }, wrong.map(q => h('tr', {}, h('td', { class: 'ka' }, q.v.t), h('td', {}, label(q.f)), h('td', { class: 'ka' }, q.ans))))
        : h('p', {}, t('Alles richtig! 🎉')),
      h('button', { class: 'btn primary', onclick: again }, t('Nochmal'))));
  };
  if (!qs.length) return onDone ? onDone({ skipped: true }) : el.replaceChildren(h('p', { class: 'muted' }, t('Keine abfragbaren Formen.')));
  const kb = keyboard(onKey, known);
  setKeyHandler(kb.physical);
  el.replaceChildren(h('div', { class: 'card' }, count, prompt, typed, fb, kb));
  load();
}

// Modus 2: Tabelle ausfüllen – ganzes Paradigma, Felder nacheinander
function table(items, known, el, again) {
  const pool = shuffle(items.filter(({ v, groups }) => columns(v, groups).filter(c => !c.given).length >= (isKa() ? 2 : 1)));   // sv: Grundform steht vorgegeben daneben
  if (!pool.length) return el.replaceChildren(h('p', { class: 'muted' }, t('Keine Wörter mit vollständigerer Formtabelle.')));
  let n = 0;
  const next = () => {
    const { v, L, groups } = pool[n++ % pool.length];
    const cols = columns(v, groups);
    const cells = cols.map(c => h('td', { class: 'fc-cell' + (c.given ? ' given' : '') }, c.given ? c.ans : ''));
    const todo = cols.map((c, k) => k).filter(k => !cols[k].given);
    let pos = 0, text = '', ok = 0;
    const fb = h('p', { class: 'feedback' });
    const focus = () => cells.forEach((td, k) => {
      td.classList.toggle('cur', k === todo[pos]);
      if (k === todo[pos] && td.isConnected) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    const onKey = k => {
      if (pos >= todo.length) { if (k === 'Enter') next(); return; }
      const td = cells[todo[pos]], c = cols[todo[pos]];
      if (k === 'Enter') {
        const good = text.trim() === c.ans, d = diff(text.trim(), c.ans);
        td.classList.add(good ? 'ok' : 'bad');
        td.replaceChildren(h('div', {}, d.typed), ...(good ? [] : [h('div', { class: 'fc-sol' }, d.ans)]));
        log({ lesson: L.id, ex: 'forms', item: v.id, form: c.f, ok: good, typed: text, mode: 'table' });
        mistake('forms', `${v.id}:${c.f}`, { lesson: L.id, v: v.id, f: c.f }, good);
        ok += good; text = ''; pos++;
        if (pos < todo.length) return focus();
        focus();
        fb.className = 'feedback ' + (ok === todo.length ? 'ok' : 'bad');
        fb.replaceChildren(t('{score} / {n} richtig', { score: ok, n: todo.length }), h('span', { class: 'muted small' }, '  ' + t('(⏎ nächstes Wort)')));
        return;
      }
      text = k === 'Backspace' ? text.slice(0, -1) : text + k;
      td.textContent = text;
    };
    const kb = keyboard(onKey, known);
    setKeyHandler(kb.physical);
    const dat = isDativeVerb(v);
    // eine Tabellenzeile je Zeitform (Präsens/Aorist/Futur/Optativ), Masdar und Nomenformen zusammen
    const rows = [];
    cols.forEach((c, k) => { const key = tenseOf(c.f) ?? 'x'; if (rows.at(-1)?.key !== key) rows.push(Object.assign([], { key })); rows.at(-1).push(k); });
    const multi = rows.length > 1 || !!tenseOf(cols[0].f);   // auch eine einzelne Aorist-/Futur-/Optativzeile beschriften
    el.replaceChildren(h('div', { class: 'card' }, head(v),
      dat ? h('p', { class: 'small muted' }, t('Dativ-Verb: Wer „will/hat/braucht“, steht im Dativ – daher') + ' ', h('span', { class: 'ka' }, 'მას, მათ'), ' ' + t('statt') + ' ', h('span', { class: 'ka' }, 'ის, ისინი'), '.') : null,
      !dat && cols.some(c => ['aor', 'opt'].includes(tenseOf(c.f))) && aorPron(v) === PRON_ERG ? h('p', { class: 'small muted' }, t('Aorist/Optativ: Das Subjekt steht im Ergativ – daher') + ' ', h('span', { class: 'ka' }, 'მან, მათ'), ' ' + t('statt') + ' ', h('span', { class: 'ka' }, 'ის, ისინი'), ' (g-aorist-ergativ).') : null,
      h('div', { class: 'fc-wrap' }, h('table', { class: 'fc-table' }, rows.flatMap(r => [
        h('tr', {}, multi ? h('th', {}) : null, r.map(k => h('th', {}, pron(v, cols[k].f) ? h('span', { class: 'ka' }, pron(v, cols[k].f)) : label(cols[k].f).replace(/ \(.*/, '')))),
        h('tr', {}, multi ? h('th', { class: 'small' }, TENSE[tenseOf(cols[r[0]].f)] ?? '') : null, r.map(k => cells[k]))]))),
      fb, kb, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: next }, t('Anderes Wort ↻')), h('button', { class: 'btn', onclick: again }, t('Neu mischen')))));
    focus();
  };
  next();
}

// Gemeinsamer Aufbau: Moduswahl + Regel-Hinweise; lessons = abgefragte Lektionen, upTo = bekannte Buchstaben
function drill(lessons, upTo, el) {
  const items = formVocab(lessons, upTo);
  const known = new Set(knownLetters(upTo.id).map(l => l.char));
  const body = h('div'), ruleBox = h('div');
  const modes = [['single', t('Einzelform'), single], ['table', t('Tabelle ausfüllen'), table]];
  const btns = modes.map(([m, name]) => h('button', { class: 'btn', 'data-m': m, onclick: () => start(m) }, name));
  const start = m => {
    btns.forEach(b => b.classList.toggle('primary', b.dataset.m === m));
    setKeyHandler(null);
    modes.find(x => x[0] === m)[2](items, known, body, () => start(m));
  };
  el.append(h('p', { class: 'small muted' }, isKa() ? t('Formen aus den Formtabellen: Verben nach Person (ab A2 auch Aorist, Futur, ab A2-06 Optativ, ab A2-11 Imperfekt), Nomen im Dativ und Plural (ab A2-04 alle Kasus), ab A2-07 Steigerung der Adjektive. Einzelform: eine Form tippen. Tabelle: ganzes Paradigma nacheinander ausfüllen.')
      : t('Formen aus den Formtabellen, soweit die Lektionen sie eingeführt haben ({forms}). Einzelform: eine Form tippen. Tabelle: alle Formen eines Worts nacheinander.', { forms: [...groupsUpTo(upTo)].map(label).join(', ') })),
    h('div', { class: 'row' }, btns), body, ruleBox);
  rules(lessons.filter(L => items.some(x => x.L === L))).then(r => r && ruleBox.append(r));
  start('single');
}

// Lektions-Tab „Formen“ (nur, wenn Lektionswörter forms haben)
export function forms(L, el) { drill([L], L, el); }

// Kurzer Einzelform-Drill ohne Moduswahl (Heute-Ablauf, Schritt „Anwenden“); zu wenige Formen → frühere Lektionen dazu
export function formsDrill(L, el, { n = 5, onDone } = {}) {
  let items = formVocab([L]);
  if (items.flatMap(({ v, groups }) => columns(v, groups).filter(c => !c.given)).length < n)
    items = formVocab(D.lessons.filter(l => lessonIdx(l.id) <= lessonIdx(L.id)), L);
  single(items, new Set(knownLetters(L.id).map(l => l.char)), el, null, { n, onDone });
}

// Bestimmte Formen abfragen (Fehlerheft): keys = ['<vokabel>:<form>', …]
export function formsOnly(keys, el, { onDone, counter } = {}) {
  const only = new Set(keys);
  const items = [...new Set(keys.map(k => k.split(':')[0]))].map(vocabBy).filter(withForms).map(v => ({ v, L: D.lessons.find(l => l.id === v.lesson) ?? D.lessons[0] }));
  single(items, new Set(D.alphabet.map(l => l.char)), el, null, { n: keys.length, onDone, only, counter });
}

// Eigene Seite #/forms[/<Lektion>]: alle Lektionen bis zur aktuellen (bzw. gewählten)
export async function viewForms(id) {
  setLesson(null);
  const withF = D.lessons.filter(hasForms);
  const cur = id ?? (await api('/api/today').catch(() => ({}))).current;
  if (location.hash.split('/')[1] !== 'forms') return;   // inzwischen weiternavigiert
  let L = D.lessons.find(l => l.id === cur) ?? D.lessons[0];
  if (lessonIdx(L.id) < lessonIdx(withF[0]?.id)) L = withF[0];
  setLesson(L);
  const el = h('div');
  const sel = h('select', { onchange: e => location.hash = `#/forms/${e.target.value}` },
    withF.map(l => h('option', { value: l.id, selected: l.id === L.id }, `${l.id} · ${l.title}`)));
  $app.replaceChildren(h('a', { href: '#/review' }, t('← Wiederholen')), h('h1', {}, t('Formen üben')),
    h('p', { class: 'small' }, t('bis Lektion') + ' ', sel), el);
  if (!withF.length) return el.append(h('p', { class: 'muted' }, t('Noch keine Wörter mit Formtabellen.')));
  drill(withF.filter(l => lessonIdx(l.id) <= lessonIdx(L.id)), L, el);
}
