// Startseite: Lektionsübersicht
import { h, api, $app } from '../util.js';
import { D, P, LANG, txt } from '../data.js';
import { setLesson } from '../opts.js';
import { isDue, cardsFor, dueKeys } from '../srs.js';
import { weekHint } from '../week.js';
import { reminderCard } from '../reminder.js';
import { homeBox, coachTasks, learners } from '../coach.js';
import { linkLine } from '../extras.js';
import { lettersCard } from '../letters.js';
import { t } from '../i18n.js';

export function viewHome() {
  setLesson(null);
  const due = dueKeys().length;
  const today = h('div', { class: 'card row' }, h('b', {}, t('Heute lernen')), h('span', { class: 'muted small' }, t('~30 min, geführt')),
    h('span', { class: 'row', style: 'margin-left:auto;gap:6px' },
      h('button', { class: 'btn', title: t('Kurzrunde 5–10 min: nur Wiederholen und Hören'), onclick: () => location.hash = '#/today/kurz' }, t('⚡ Kurz')),
      h('button', { class: 'btn primary', onclick: () => location.hash = '#/today' }, t('Start'))));
  api('/api/today').then(d => today.children[1].textContent =
    t(d.streak === 1 ? '~30 min, geführt · Lektion {lesson} · 🔥 {n} Tag in Folge' : '~30 min, geführt · Lektion {lesson} · 🔥 {n} Tage in Folge', { lesson: d.current, n: d.streak })).catch(() => {});
  levels.splice(0, levels.length, ...lessonGroups());
  // Übungen nur über Wiederholen (I10: Hörtraining, Blitzlesen, Problemlaute … sind dort Kacheln); Lesen steht ab A1 in der Kopfzeile
  const extra = linkLine(['review', 'week'], {}, t('Extra: '));
  $app.replaceChildren(
    h('h1', {}, t('Lektionen')),
    h('p', { class: 'muted' }, t('Täglich ~30 Minuten: erst fällige Wiederholungen, dann die nächste Lektion.')),
    coachTasks(),    // Coaches: „Für <Lernende>“ oben (Lernende dieser Sprache, /api/me → learners)
    today,
    learners().length && !Object.keys(P).length ? '' : lettersCard({ onlyA0: true }),   // „33 Buchstaben“ nur in A0 (danach Statistik), nicht für Coaches ohne eigenen Lernstand
    homeBox(),
    weekHint(h, api),
    extra,
    due ? h('div', { class: 'card row' }, h('b', {}, t(due === 1 ? '{n} Karte fällig' : '{n} Karten fällig', { n: due })), h('button', { class: 'btn primary', onclick: () => location.hash = '#/review' }, t('Jetzt wiederholen'))) : '',
    ...levels,
    reminderCard() ?? '');
  // Coach ohne eigene Lernaktivität: Lektionsliste eingeklappt (die Box „Für …“ ist dann das Wichtigste)
  api('/api/today').then(d => learners().length && !Object.keys(P).length && !d.streak && !Object.keys(d.passedDays ?? {}).length ? openLevel(null, true) : openLevel(d.current)).catch(() => {});
}

// Lektionen nach Stufe (A0, A1, A2 bzw. sv-A1 …) zum Aufklappen; offen ist die Stufe der aktuellen Lektion
const levelOf = id => id.replace(/-\d+$/, '');
const levels = [];
function lessonGroups() {
  const by = new Map();
  for (const l of D.lessons) { const k = levelOf(l.id); by.has(k) || by.set(k, []); by.get(k).push(l); }
  return [...by].map(([lv, ls], i) => {
    let seen = 0, all = 0, due = 0;
    const rows = ls.map(l => {
      const keys = cardsFor(l.id);
      const s = keys.filter(k => P[k]).length, d = keys.filter(isDue).length;
      seen += s; all += keys.length; due += d;
      return h('a', { href: `#/lesson/${l.id}`, class: 'card lesson-row', style: 'display:flex;color:inherit' },
        h('div', { style: 'flex:1' }, h('b', {}, `${l.id} · ${l.title}`),
          l.letters?.length ? h('div', { class: 'ka', style: 'font-size:22px' }, l.letters.join(' ')) : null,
          h('div', { class: 'bar' }, h('i', { style: `width:${keys.length ? 100 * s / keys.length : 0}%` }))),
        h('div', { class: 'stats' }, t('{s}/{n} gesehen', { s, n: keys.length }), h('br'), d ? t('{n} fällig', { n: d }) : ''));
    });
    return h('details', { class: 'lv-group', 'data-level': lv, open: i === 0 },
      h('summary', {}, h('b', {}, txt(LANG().levels?.[lv.replace(/^[a-z]+-/, '')]) || lv.replace(/^[a-z]+-/, '')), h('span', { class: 'muted small' }, ' · ' + t('{n} Lektionen', { n: ls.length }) + ' · ' + t('{s}/{n} gesehen', { s: seen, n: all }) + (due ? ' · ' + t('{n} fällig', { n: due }) : ''))),
      ...rows);
  });
}
function openLevel(current, none = false) {
  if (!current && !none) return;
  for (const d of levels) d.open = !none && d.dataset.level === levelOf(current);
}
