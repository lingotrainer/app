// Karteikarten (Lektion oder globale Wiederholung)
import { h, log } from '../util.js';
import { letterBy, vocabBy, listenBy, LANG, glossText, glossIn, trOf } from '../data.js';
import { play, playBtn } from '../audio.js';
import { grade, cardsFor, isNew, dueUpTo, mixQueue, isKnownOnFirst } from '../srs.js';
import { setKeyHandler, stepKeys, showTop } from '../keyboard.js';
import { ctx } from '../ctx.js';
import { t } from '../i18n.js';

// onDone({done}) statt Abschlusskarte (für „Heute“). Aufdecken/Bewerten in der Aktionsleiste (am Handy unten fest),
// Tasten: Leertaste/Enter = Aufdecken, dann 1–4 = Nochmal…Leicht, Leertaste/Enter = Gut
// „Nochmal“ bei ka→de: erst Lautieren (spell.js), dann Weiter (Leertaste/Enter)
// Langes Wort: Schrift so verkleinern, dass das längste Wort am Handy in eine Zeile passt (Mkhedruli ≈ 0,62 em je Zeichen; Wendungen umbrechen am Leerzeichen)
const hugeKa = txt => {
  const len = Math.max(...txt.split(/\s+/).map(w => w.length));
  return h('div', { class: 'huge', style: `font-size:min(60px, calc((100vw - 60px) / ${(len * 0.62).toFixed(2)}))` }, txt);
};

export function flashcards(L, el, keysOverride, { onDone } = {}) {
  let queue;
  // Lektion: fällige Karten bis zu dieser Lektion (auch ältere) + bis 20 neue dieser Lektion (lang.json newPerSession), gemischt
  if (keysOverride) queue = mixQueue(keysOverride);
  else queue = mixQueue(dueUpTo(L.id), cardsFor(L.id).filter(isNew).slice(0, LANG().newPerSession ?? 20));
  if (!queue.length) return onDone ? onDone({ done: 0 }) : el.replaceChildren(h('div', { class: 'card flash' }, h('h2', {}, t('Alles erledigt ✓')), h('p', { class: 'muted' }, t('Keine fälligen oder neuen Karten.'))));
  let done = 0;
  const show = () => {
    const key = queue.shift();
    if (!key) { setKeyHandler(null); return onDone ? onDone({ done }) : el.replaceChildren(h('div', { class: 'card flash' }, h('h2', {}, t('{n} Karten geschafft ✓', { n: done })))); }
    const [kind, id, dir] = key.split(':');
    let front, back, item;
    if (kind === 'l') {
      item = letterBy(id);
      front = h('div', { class: 'huge' }, item.char);
      back = h('div', {}, h('div', { style: 'font-size:30px' }, h('b', {}, item.translit), ' ', h('span', { class: 'ipa' }, item.ipa)), h('p', { class: 'small' }, item.sound));
    } else if (kind === 's') {         // Hörkarte (R8): erst nur Audio, beim Aufdecken Text + Deutsch, Satz läuft noch einmal
      item = listenBy(id);
      if (!item) return show();
      front = h('div', {}, h('div', { style: 'font-size:40px' }, '🎧'), h('p', { class: 'muted' }, t('Hör zu – was bedeutet der Satz?')));
      back = h('div', {}, h('div', { class: 'ka', style: 'font-size:28px' }, item.t), h('div', {}, h('span', { class: 'tr', 'data-ka': item.t }, item.translit), ' ', h('span', { class: 'ipa', 'data-ka': item.t }, item.ipa)),
        h('div', { style: 'font-size:22px;margin-top:8px' }, trOf(item).text), trOf(item).claude ? h('p', { class: 'small muted' }, t('Übersetzung von Claude, ungeprüft')) : null);
      setTimeout(() => play(item), 300);
    } else {
      item = vocabBy(id);
      if (!item) return show();
      // Vorderseite ka→de nur Mkhedruli (an die Schrift gewöhnen), Umschrift/IPA erst beim Aufdecken zur Kontrolle
      const reading = () => h('div', {}, h('span', { class: 'tr', 'data-ka': item.t }, item.translit), ' ', h('span', { class: 'ipa', 'data-ka': item.t }, item.ipa));
      const de = h('div', { style: 'font-size:26px' }, glossText(item));
      front = dir === 'ka' ? hugeKa(item.t) : de;
      // Englisch: einsprachige Erklärung aus Wiktionary dazu (Synonyme im Deutschen sind oft mehrdeutig)
      const en = LANG().code === 'en' ? glossIn(item, 'en') : [];
      const gloss = en.length ? h('p', { class: 'small', lang: 'en' }, en[0]) : null;
      back = h('div', {}, dir === 'ka' ? h('div', {}, reading(), de) : h('div', {}, hugeKa(item.t), reading()), gloss,
        item.notes ? h('p', { class: 'small muted' }, item.notes) : null);
    }
    const area = h('div'), bar = h('div', { class: 'actionbar' });
    const fresh = isKnownOnFirst(key);      // neue Karte: „Leicht“ = sicher bekannt, wird aussortiert
    let open = false, spelling = false;
    const rate = q => {
      if (spelling) return;
      grade(key, q); done++;
      if (q === 0) { queue.splice(Math.min(3, queue.length), 0, key); log({ lesson: item.lesson, ex: 'flash', item: key, ok: false }); }
      const c = ctx();
      if (q === 0 && kind === 'v' && dir === 'ka' && c.canSpell(item)) {
        spelling = true;
        area.replaceChildren(c.spellView(item, c), h('div', { style: 'font-size:22px' }, glossText(item)));
        return bar.replaceChildren(h('button', { class: 'btn primary wide', onclick: show }, t('Weiter'), h('span', { class: 'keyhint' }, ' ⏎')));
      }
      show();
    };
    const grades = h('div', { class: 'grades' },
      [[t('Nochmal'), 0], [t('Schwer'), 1], [t('Gut'), 2], [fresh ? t('Kenne ich ✓') : t('Leicht'), 3]].map(([n, q]) => h('button', { class: 'btn' + (q === 2 ? ' primary' : ''), title: t('Taste {n}', { n: q + 1 }), onclick: () => rate(q) }, n)));
    const reveal = () => {
      open = true;
      area.replaceChildren(back, h('div', { class: 'row', style: 'justify-content:center;margin-top:10px' }, playBtn(item)));
      bar.replaceChildren(grades);
      if (dir !== 'ka' && kind !== 'l') play(item);
    };
    bar.append(h('button', { class: 'btn primary wide', onclick: reveal }, t('Aufdecken')));
    stepKeys(el, k => {
      if (spelling) return (k === 'Enter' || k === 'Space') && (show(), true);
      if (!open) return (k === 'Enter' || k === 'Space') && (reveal(), true);
      if (k === 'Enter' || k === 'Space') return rate(2), true;
      if (/^[1-4]$/.test(k)) return rate(+k - 1), true;
    });
    el.replaceChildren(h('div', { class: 'muted small' }, t('noch {n}', { n: queue.length + 1 }), fresh ? ' · ' + t('neu – „Kenne ich“ sortiert das Wort für {n} Tage aus', { n: LANG().knownOnFirst.ivl ?? 90 }) : ''),
      h('div', { class: 'card flash' }, front, dir === 'ka' || kind === 'l' || kind === 's' ? h('div', { style: 'margin:8px 0' }, playBtn(item)) : null, h('hr', { style: 'border:0;border-top:1px solid var(--line);margin:16px 0' }), area, bar));
    showTop(el);
  };
  show();
}
