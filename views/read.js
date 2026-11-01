// Lesemodus (#/read): Texte, Dialoge und Lektionssätze bis zur aktuellen Lektion. Jedes Wort antippbar →
// Grundform + Form („Aorist 3. Sg. von …“, über forms/Endungen aufgelöst, lemma.js), Übersetzung, Transliteration/IPA, Audio;
// „Lernen“ legt die Karteikarte an (auch vor der Lektion), unbekannte Wörter merken; Wörter ohne Treffer gepunktet unterstrichen.
// kaText() und reading() nutzt auch der Dialog-Tab (dialog.js). Andere Sprachen (sv): ohne Transliteration, IPA aus dem Eintrag.
import { h, api, log, toast, $app, url } from '../util.js';
import { D, P, lessonIdx, letterBy, translit, vocabBy, isKa, LANG, gloss, glossText, trText, txt } from '../data.js';
import { setLesson } from '../opts.js';
import { canPlay, play, playBtn } from '../audio.js';
import { saveP } from '../srs.js';
import { makeLexicon } from '../lemma.js';
import { verifiedBadge } from '../checkbadge.js';
import { me } from '../account.js';
import { t } from '../i18n.js';

let R = null, LEX = null;
export const reading = async () => R ??= await api('/api/reading');      // {dialogs, texts, sentences}
const lexicon = () => LEX ??= makeLexicon(D.vocab, D.lessons.map(l => l.id), { articles: LANG().articles ?? [] });
// IPA wie makeTranslit in scripts/lib.mjs (ვ nach Konsonant = Lippenrundung)
export const ttsInfo = () => ({ kind: 'tts', label: t('Sprachsynthese ({voice}) – keine echte Aufnahme', { voice: LANG().tts ?? 'ka-GE-EkaNeural' }) });
export const ipaOf = s => [...s].map((c, i, a) => c === 'ვ' && letterBy(a[i - 1]) && letterBy(a[i - 1]).type !== 'vowel' ? 'ʷ' : letterBy(c)?.ipa ?? c).join('');

// ---------- unbekannte Wörter (pro Browser; Markierungen gehen zusätzlich als ex:'read' ins Log) ----------
let unknown = {};
try { unknown = JSON.parse(localStorage.getItem('unknownWords') ?? '{}'); } catch {}
const saveUnknown = () => { try { localStorage.setItem('unknownWords', JSON.stringify(unknown)); } catch {} };
const refreshMarks = () => document.querySelectorAll('.w').forEach(e => e.classList.toggle('unk', !!unknown[e.dataset.w]));

// Karten ka→de und de→ka; auch für Wörter späterer Lektionen (Wiederholen nimmt jede fällige v:-Karte, srs.js dueKeys)
const cardKeys = v => [`v:${v.id}:ka`, `v:${v.id}:de`];
function queueCard(v, lesson, item = v.t) {     // neue Karte sofort fällig bzw. vorhandene vorziehen
  const fresh = !P[cardKeys(v)[0]];
  for (const k of cardKeys(v)) P[k] = { ease: 2.5, ivl: 0, reps: 0, lapses: 0, ...P[k], due: Date.now() };
  saveP();
  if (fresh) log({ lesson, ex: 'read', item, lemma: v.id, mark: 'learn' });
  toast(t('„{w}“ ist jetzt als Karte fällig (Wiederholen).', { w: v.t }));
}

// Formschlüssel aus `forms` (CLAUDE.md, Schemas) → deutsche Bezeichnung, z. B. aor3sg → „Aorist 3. Sg.“
const CASE = { dat: t('Dativ'), pl: t('Plural'), erg: t('Ergativ'), gen: t('Genitiv'), ins: t('Instrumental'), adv: t('Adverbial'), voc: t('Vokativ'), masdar: t('Masdar (Verbalnomen)') };
export function formLabel(k) {
  if (!isKa()) return txt(LANG().formLabels?.[k]) || k;
  const m = /^(aor|fut|opt|impf)?([123])(sg|pl)$/.exec(k);
  return m ? `${{ aor: t('Aorist'), fut: t('Futur'), opt: t('Optativ'), impf: t('Imperfekt') }[m[1]] ?? t('Präsens')} ${m[2]}. ${m[3] === 'sg' ? t('Sg.') : t('Pl.')}` : CASE[k] ?? k;
}

// ---------- Wort-Popup ----------
const pop = h('div', { class: 'card wordpop', style: 'display:none' });
document.body.append(pop);
const closePop = () => { pop.style.display = 'none'; document.querySelectorAll('.w.sel').forEach(e => e.classList.remove('sel')); };
document.addEventListener('click', e => { if (!pop.contains(e.target) && !e.target.closest?.('.w')) closePop(); });
document.addEventListener('keydown', e => e.key === 'Escape' && closePop());
window.addEventListener('hashchange', closePop);

function showWord(w, span, ctx) {
  const r = span.phrase ? { v: span.phrase } : lexicon().lookup(w, ctx.glossary);
  const v = r?.v && D.vocab.find(x => x.id === r.v.id) && !r.num ? r.v : null;
  const cur = lessonIdx(ctx.lesson);
  const later = x => x && lessonIdx(x.lesson) > cur;
  const sameForm = v && v.t === w;
  pop.replaceChildren(
    h('div', { class: 'row' }, h('span', { class: 'ka', style: 'font-size:30px' }, w),
      h('button', { class: 'btn icon', title: sameForm && v.audioInfo ? v.audioInfo.label : t('Anhören (Browser-Stimme)'), disabled: !(sameForm ? canPlay(v) : canPlay({ t: w })),
        onclick: () => play(sameForm ? v : { t: w }) }, '🔊'),
      sameForm && v.audioInfo ? h('span', { class: 'badge ' + v.audioInfo.kind }, v.audioInfo.kind === 'native' ? t('echt') : 'TTS') : null,
      h('button', { class: 'btn icon', style: 'margin-left:auto', onclick: closePop }, '✕')),
    isKa() ? h('div', {}, h('span', { class: 'tr', 'data-ka': w }, translit(w)), ' ', h('span', { class: 'ipa', 'data-ka': w }, ipaOf(w)))
      : sameForm && v.ipa ? h('div', {}, h('span', { class: 'ipa' }, '[' + v.ipa + ']')) : '',
    !r ? h('p', { class: 'muted' }, t('Nicht im Wortschatz.') + (ctx.sentenceDe ? ' ' + t('Tipp: Satz übersetzen aufklappen.') : '')) : h('div', {},
      r.gloss ? h('p', { style: 'font-size:18px;margin:6px 0' }, txt(r.gloss)) : null,
      v && !sameForm ? h('p', { style: 'margin:6px 0' }, r.guess ? t('vermutlich') + ' ' : '', r.form ? t('{form} von', { form: formLabel(r.form) }) + ' ' : r.guess ? t('von') + ' ' : t('Grundform:') + ' ',
        h('b', { class: 'ka', style: 'font-size:20px' }, v.t), ' ', h('span', { class: 'tr', 'data-ka': v.t }, v.translit), ' ', playBtn(v)) : null,
      v && sameForm && !span.phrase && !r.num ? h('p', { class: 'small muted', style: 'margin:4px 0' }, v.pos === 'verb' ? (isKa() ? t('Grundform (Präsens 1. Sg.)') : t('Grundform (Infinitiv)')) : t('Grundform')) : null,
      v && !r.gloss ? h('p', { style: 'font-size:18px;margin:6px 0' }, glossText(v)) : null,
      r.num != null ? h('p', { style: 'font-size:18px;margin:6px 0' }, t('Zahl: {n}', { n: r.num })) : null,
      r.parts?.length ? h('div', { class: 'small' }, r.parts.map(p => h('span', { style: 'margin-right:10px' }, h('span', { class: 'ka' }, p.t), ` = ${gloss(p)[0] ?? ''}`))) : null,
      r.note ? h('div', { class: 'small muted' }, (r.guess ? t('Endung:') + ' ' : '') + txt(r.note)) : null,
      r.alts?.length ? h('div', { class: 'small' }, t('auch:') + ' ', r.alts.map(a => `${glossText(a)} (${a.lesson})`).join(' · ')) : null,
      v ? h('div', { class: 'small muted' }, t('Lektion {id}', { id: v.lesson }), later(v) ? ' ' + t('– kommt erst später') : '', v.notes ? ' · ' + v.notes : '') : null),
    h('div', { class: 'row', style: 'margin-top:8px' },
      h('button', { class: 'btn', onclick: () => {
        if (unknown[w]) delete unknown[w];
        else { unknown[w] = { lemma: v?.id ?? null, lesson: ctx.lesson, ts: Date.now() }; log({ lesson: ctx.lesson, ex: 'read', item: w, lemma: v?.id ?? null, mark: 'unknown' }); }
        saveUnknown(); refreshMarks(); showWord(w, span, ctx);
      } }, unknown[w] ? t('✓ kenne ich jetzt') : t('❓ unbekannt markieren')),
      v && vocabBy(v.id) ? h('button', { class: 'btn primary', onclick: () => { queueCard(v, ctx.lesson, w); showWord(w, span, ctx); },
        title: t('Karteikarten ka→de und de→ka anlegen und sofort fällig machen (auch vor der Lektion)') },
        P[cardKeys(v)[0]] ? t('⏩ Karte vorziehen') : t('📚 Lernen')) : null));
  const b = span.getBoundingClientRect();
  pop.style.display = '';
  pop.style.top = `${window.scrollY + b.bottom + 6}px`;
  pop.style.left = `${Math.max(8, Math.min(window.scrollX + b.left, window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8))}px`;
  document.querySelectorAll('.w.sel').forEach(e => e.classList.remove('sel'));
  span.classList.add('sel');
}

// Georgischer Text mit antippbaren Wörtern. ctx: {glossary, lesson, sentenceDe?}
export function kaText(text, ctx) {
  return h('span', { class: 'ka katext' }, lexicon().segment(text).map(seg => {
    if (!seg.word) return seg.t;
    const s = h('span', { class: 'w' + (unknown[seg.t] ? ' unk' : '') + (seg.phrase || lexicon().lookup(seg.t, ctx.glossary) ? '' : ' nohit'), 'data-w': seg.t, onclick: e => { e.stopPropagation(); showWord(seg.t, s, ctx); } }, seg.t);
    s.phrase = seg.phrase;
    return s;
  }));
}

// ---------- Ansicht #/read ----------
const lineAudio = l => l.audio ? { audio: l.audio, audioInfo: ttsInfo() } : { t: l.t };

function pieces(R) {
  const glossary = Object.assign({}, ...[...R.dialogs, ...R.texts].map(d => d.glossary));
  const bySent = Object.groupBy(R.sentences, s => s.lesson);
  return [...R.texts.map(d => ({ ...d, label: t('Text') })), ...R.dialogs.map(d => ({ ...d, label: t('Dialog') })),
    ...Object.entries(bySent).map(([lesson, ss]) => ({ id: 's-' + lesson, kind: 'sentences', label: t('Sätze'), lesson, title: t('Sätze aus {id}', { id: lesson }), glossary,
      lines: ss.map(s => ({ t: s.t, tr: s.tr, trClaude: s.trClaude, trChecked: s.trChecked, verified: s.verified, reviewed: s.reviewed })) }))]
    .sort((a, b) => lessonIdx(a.lesson) - lessonIdx(b.lesson) || ['text', 'dialog', 'sentences'].indexOf(a.kind) - ['text', 'dialog', 'sentences'].indexOf(b.kind));
}

function readPiece(p, el) {
  const lines = p.lines.map(l => {
    const ctx = { glossary: p.glossary, lesson: p.lesson, sentenceDe: trText(l) };
    return h('div', { class: 'readline' },
      p.speakers ? h('div', { class: 'small muted' }, txt(p.speakers[l.speaker])) : null,
      h('div', { class: 'row', style: 'flex-wrap:nowrap;align-items:flex-start' }, h('div', { style: 'flex:1' }, kaText(l.t, ctx)),
        canPlay(lineAudio(l)) ? playBtn(lineAudio(l)) : null),
      h('details', { class: 'small' }, h('summary', { class: 'muted' }, t('Satz übersetzen')),
        h('div', {}, trText(l), verifiedBadge(l)),
        isKa() ? h('div', {}, h('span', { class: 'tr', 'data-ka': l.t }, translit(l.t)), ' ', h('span', { class: 'ipa', 'data-ka': l.t }, ipaOf(l.t))) : null));
  });
  let stop = false;
  const playAll = h('button', { class: 'btn', onclick: async () => {
    stop = false;
    for (const l of p.lines.filter(l => l.audio)) {
      if (stop) break;
      await new Promise(ok => { const a = new Audio(url('/audio/' + l.audio)); a.onended = a.onerror = ok; a.play().catch(ok); });
      await new Promise(ok => setTimeout(ok, 400));
    }
  } }, t('▶ Alles vorlesen'));
  el.replaceChildren(
    h('a', { href: '#/read' }, t('← alle Texte')),
    h('h1', {}, txt(p.title)), h('p', { class: 'small muted' }, `${p.label} · ` + t('Lektion {id}', { id: p.lesson }) + ' · ' + t('Wort antippen für Bedeutung, Grundform und Aussprache; gepunktet = nicht im Wortschatz.')),
    p.lines.some(l => l.audio) ? h('div', { class: 'row' }, playAll, h('button', { class: 'btn', onclick: () => stop = true }, '⏹')) : '',
    h('div', { class: 'card' }, lines),
    p.kind === 'dialog' ? h('p', {}, h('a', { href: `#/lesson/${p.lesson}/dialog` }, t('🎭 Als Rollenspiel üben'))) : '',
    unknownList());
}

function unknownList() {
  const ws = Object.keys(unknown);
  if (!ws.length) return h('p', { class: 'small muted' }, t('Noch keine unbekannten Wörter markiert.'));
  const withV = ws.map(w => [w, D.vocab.find(v => v.id === unknown[w].lemma)]);
  return h('div', { class: 'card' }, h('b', {}, t('Unbekannte Wörter ({n})', { n: ws.length })),
    h('div', { class: 'row', style: 'margin:8px 0' }, withV.map(([w, v]) => h('span', { class: 'chip' }, h('span', { class: 'ka' }, w), v ? ` ${gloss(v)[0] ?? ''}` : ' ?',
      h('button', { class: 'btn icon', title: t('Markierung entfernen'), onclick: e => { delete unknown[w]; saveUnknown(); e.target.closest('.chip').remove(); refreshMarks(); } }, '×')))),
    withV.some(([, v]) => v) ? h('button', { class: 'btn', onclick: () => withV.forEach(([w, v]) => v && queueCard(v, unknown[w].lesson, w)) }, t('➕ alle bekannten als Karten vormerken')) : null,
    h('div', { class: 'small muted' }, t('Wörter ohne Eintrag (?) stehen im Protokoll (ex: read) – Claude kann sie bei der nächsten Lektion in den Wortschatz aufnehmen.')));
}

export async function viewRead(id) {
  setLesson(null);
  $app.replaceChildren(h('p', { class: 'muted' }, t('Lade …')));
  let R, today;
  try { [R, today] = await Promise.all([reading(), api('/api/today').catch(() => ({}))]); }
  catch (e) { return $app.replaceChildren(h('a', { href: '#/' }, t('← Übersicht')), h('p', { class: 'card muted' }, t('Texte nicht geladen:') + ' ', e.message, ' (', h('a', { href: '#/offline' }, t('Für unterwegs laden')), ')')); }
  const all = pieces(R);
  const p = id && all.find(x => x.id === id);
  if (p) return readPiece(p, $app);
  // „bis Lektion“ pro Benutzer; gespeichert zählt nur, wenn später als die aktuelle Lektion (sonst folgt es der Lektion)
  const KEY = 'readUpTo:' + (me?.id ?? '');
  const cur = today.current ?? D.lessons.at(-1).id;
  const saved = (() => { try { return localStorage.getItem(KEY); } catch { return null; } })();
  let upTo = saved && lessonIdx(saved) > lessonIdx(cur) ? saved : cur;
  const list = h('div');
  const render = () => list.replaceChildren(...all.some(x => lessonIdx(x.lesson) <= lessonIdx(upTo)) ? [] : [h('p', { class: 'card muted' },
    t('Bis {upTo} gibt es noch nichts zu lesen – die ersten Texte kommen mit {first}. Oben eine spätere Lektion wählen, um vorzulesen.', { upTo, first: all[0]?.lesson ?? 'A1' }))],
  ...all.filter(x => lessonIdx(x.lesson) <= lessonIdx(upTo)).sort((a, b) => lessonIdx(b.lesson) - lessonIdx(a.lesson)).map(x =>
    h('a', { href: `#/read/${x.id}`, class: 'card lesson-row', style: 'display:flex;color:inherit' },
      h('div', { style: 'flex:1;min-width:0' }, h('b', {}, txt(x.title)), h('div', { class: 'ka small muted', style: 'white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, x.lines.slice(0, 2).map(l => l.t).join(' '))),
      h('div', { class: 'stats' }, `${x.label} · ${x.lesson}`, h('br'), t('{n} Zeilen', { n: x.lines.length })))));
  const sel = h('select', { onchange: e => { upTo = e.target.value; try { lessonIdx(upTo) > lessonIdx(cur) ? localStorage.setItem(KEY, upTo) : localStorage.removeItem(KEY); } catch {} render(); } },
    D.lessons.filter(l => all.some(x => x.lesson === l.id) || l.id === upTo).map(l => h('option', { value: l.id, selected: l.id === upTo }, `${l.id} · ${l.title}`)));
  $app.replaceChildren(h('a', { href: '#/' }, t('← Übersicht')), h('h1', {}, t('📖 Lesen')),
    h('p', { class: 'muted' }, t('Kurze Texte, Dialoge und Sätze bis zu deiner Lektion. Jedes Wort lässt sich antippen.')),
    h('label', { class: 'row' }, t('bis Lektion') + ' ', sel, today.current ? h('span', { class: 'small muted' }, t('(aktuell: {id})', { id: today.current })) : null),
    list, unknownList());
  render();
}
