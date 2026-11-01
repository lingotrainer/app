// Karte „33 Buchstaben“ (I9): Raster aller Mkhedruli-Buchstaben, Farbe = Zustand aus GET /api/letters (letterMastery in
// app/logstats.mjs): grau = Lektion noch nicht erreicht, umrandet = neu, gelb = wackelig, grün = sicher.
// Antippen → Buchstabe, Umschrift/IPA, Merkhilfe, was zuletzt schiefging, „anhören“ und „üben“ (Blitzlesen mit Schwerpunkt).
// Startseite (nur solange die aktuelle Lektion A0 ist) und Statistik (#/stats, für Coaches #/stats/<id>, dann ohne „üben“).
import { h, api } from './util.js';
import { letterBy, vocabBy, isKa } from './data.js';
import { playBtn } from './audio.js';
import { t } from './i18n.js';

const STATES = { solid: t('sicher'), shaky: t('wackelig'), new: t('neu'), locked: t('noch nicht dran') };
const SRC = { quiz: t('Quiz'), flashread: t('Blitzlesen'), listen: t('Hören'), asr: t('Ausspracheprüfung'), coach: t('Coach'), writing: t('Schreiben') };

// onlyA0: nichts zeigen, sobald die aktuelle Lektion nicht mehr A0 ist (Startseite)
export function lettersCard({ learner = null, onlyA0 = false } = {}) {
  const card = h('div', { class: 'card letters-card', hidden: true });
  if (!isKa()) return card;
  api('/api/letters' + (learner ? '?user=' + encodeURIComponent(learner) : '')).then(r => {
    if (r.error || !r.letters?.length || (onlyA0 && !/^A0/.test(r.current ?? ''))) return;
    render(card, r, learner);
    card.hidden = false;
  }).catch(() => {});
  return card;
}

function render(card, { letters }, learner) {
  const n = s => letters.filter(l => l.state === s).length;
  const detail = h('div', { class: 'letter-detail', hidden: true });
  let sel = null;
  const grid = h('div', { class: 'letter-grid', role: 'list' }, letters.map(m => {
    const l = letterBy(m.char);
    const b = h('button', { class: 'lg ' + m.state, role: 'listitem', title: `${m.char} ${l?.translit ?? ''}: ${STATES[m.state]}`,
      'aria-label': `${l?.translit ?? m.char}, ${STATES[m.state]}`, onclick: () => {
        sel?.classList.remove('sel');
        if (sel === b) { sel = null; detail.hidden = true; return; }
        sel = b; b.classList.add('sel');
        detail.replaceChildren(...info(m, l, learner)); detail.hidden = false;
      } }, h('span', { class: 'ka' }, m.char),
      m.state === 'shaky' || m.state === 'solid' ? h('i', { style: `width:${Math.round(m.score * 100)}%` }) : null);
    return b;
  }));
  card.replaceChildren(
    h('div', { class: 'row', style: 'justify-content:space-between' }, h('b', {}, t('33 Buchstaben')),
      h('span', { class: 'small muted' }, t('{a} sicher · {b} wackelig · {c} neu', { a: n('solid'), b: n('shaky'), c: n('new') }))),
    grid,
    h('div', { class: 'letter-legend small muted' }, ['solid', 'shaky', 'new', 'locked'].map(s => h('span', {}, h('i', { class: 'lg ' + s }), STATES[s]))),
    detail);
}

// Detailansicht eines Buchstabens außerhalb der Karte (Lautieren, spell.js): erst ohne Lernstand, dann mit /api/letters
// (2 min zwischengespeichert; offline bleibt es bei Buchstabe, Laut und Merkhilfe)
let cached = null, cachedAt = 0;
export function letterDetail(char) {
  const l = letterBy(char), box = h('div');
  const fill = m => box.replaceChildren(...info(m, l, null));
  fill({ char });
  if (!cached || Date.now() - cachedAt > 12e4) { cachedAt = Date.now(); cached = api('/api/letters').catch(() => (cached = null)); }
  cached.then(r => { const m = r?.letters?.find(x => x.char === char); if (m) fill(m); });
  return box;
}

const ago = ts => {
  const d = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ts).setHours(0, 0, 0, 0)) / 864e5);
  return d <= 0 ? t('heute') : d === 1 ? t('gestern') : t('vor {d} Tagen', { d });
};
const wordOf = item => item?.startsWith('letter-') ? null : vocabBy(item)?.t ?? item;

// Ein Fehler in Worten: „Hören: klang wie ქ“, „Quiz: in კაკა“, „Schreiben (frei) 38 %“
const ka = s => h('span', { class: 'ka' }, s);
function what(r) {
  const w = wordOf(r.item), parts = [];
  if (r.src === 'writing') parts.push(t(r.mode === 'free' ? '(frei) {p} %' : '(nachfahren) {p} %', { p: Math.round(r.score * 100) }));
  else {
    if (r.close) parts.push(t('fast richtig'));
    if (r.alt) parts.push(h('span', {}, t('klang wie '), ka(r.alt)));
    if (w) parts.push(h('span', {}, t('in '), ka(w)));
  }
  return h('li', {}, h('b', {}, SRC[r.src] ?? r.src), ' ', parts.flatMap((p, i) => i ? [', ', p] : [p]), h('span', { class: 'muted' }, ' · ' + ago(r.ts)));
}

function info(m, l, learner) {
  if (!l) return [m.char];
  const conf = Object.entries(m.confusions ?? {}).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  return [
    h('div', { class: 'row', style: 'gap:14px;align-items:center' },
      h('span', { class: 'ka', style: 'font-size:52px;line-height:1' }, l.char),
      h('div', { style: 'flex:1' }, h('b', {}, l.translit), ' ', h('span', { class: 'ipa' }, l.ipa),
        h('span', { class: 'muted small' }, ` · ${l.name} (${l.nameTr})`),
        h('div', { class: 'small' }, l.sound),
        m.state ? h('div', { class: 'small lg-state ' + m.state }, STATES[m.state], m.state === 'locked' ? t(' – kommt in {lesson}', { lesson: m.lesson }) : m.state === 'new' ? '' : ` · ${Math.round(m.score * 100)} %`) : ''),
      playBtn(l)),
    l.mnemonic ? h('p', { class: 'small' }, '💡 ', l.mnemonic) : '',
    !m.state || m.state === 'locked' ? '' : h('p', { class: 'small muted' },
      m.ivl ? t(m.ivl === 1 ? 'Karteikarte: nächster Abstand {n} Tag' : 'Karteikarte: nächster Abstand {n} Tage', { n: m.ivl }) : t('Noch keine Karteikarte wiederholt'),
      conf.length ? h('span', {}, t(' · verwechselt mit '), ka(conf.join(' '))) : ''),
    m.recent?.length ? h('div', { class: 'small' }, t('Zuletzt schiefgegangen:'), h('ul', { class: 'letter-recent' }, m.recent.map(what))) : '',
    learner || m.state === 'locked' ? '' : h('div', { class: 'row', style: 'gap:8px' },
      h('button', { class: 'btn primary', onclick: () => location.hash = '#/flash-read?l=' + encodeURIComponent(l.char) }, t('⚡ Üben')),
      m.recent?.some(r => r.src === 'writing') ? h('button', { class: 'btn', onclick: () => location.hash = `#/lesson/${m.lesson}/writing` }, t('✍️ Schreiben')) : ''),
  ];
}
