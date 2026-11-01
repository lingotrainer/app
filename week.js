// Wochenrückblick (#/week/<offset>, 0 = diese Woche, 1 = letzte): Zahlen aus GET /api/week (app/logstats.mjs → weekStats)
import { t, LOCALE } from './i18n.js';

const fmtDay = (k, o = { day: 'numeric', month: 'short' }) => new Date(k + 'T12:00').toLocaleDateString(LOCALE === 'de' ? 'de-DE' : LOCALE, o);
const diff = (a, b) => a === b ? t('wie Vorwoche') : t('{d} zur Vorwoche', { d: (a > b ? '+' : '−') + Math.abs(a - b) });

export function viewWeek($app, { D, h, api }, offset = 0) {
  $app.replaceChildren(h('a', { href: '#/' }, t('← Übersicht')), h('h1', {}, t('Wochenrückblick')), h('p', { class: 'muted' }, t('lade …')));
  api('/api/week?offset=' + offset).then(w => render($app, w, { D, h }))
    .catch(e => $app.lastChild.replaceWith(h('p', { class: 'feedback bad' }, t('Rückblick konnte nicht geladen werden: {msg}', { msg: e.message }))));
}

function render($app, w, { D, h }) {
  const box = (title, ...kids) => h('section', { class: 'card' }, h('h2', { style: 'margin-top:0' }, title), ...kids);
  const tile = (n, label, sub) => h('div', { class: 'tile' }, h('div', { class: 'num' }, n), h('div', {}, label), sub ? h('div', { class: 'small muted' }, sub) : null);
  const lesson = D.lessons.find(l => l.id === w.next.lesson);
  const maxMin = Math.max(10, ...w.days.map(d => d.min));
  const nav = h('div', { class: 'row small' },
    h('a', { href: `#/week/${w.offset + 1}` }, t('‹ Woche davor')),
    h('b', { style: 'margin:0 auto' }, `${fmtDay(w.from)} – ${fmtDay(w.to, { day: 'numeric', month: 'short', year: 'numeric' })}`,
      w.offset === 0 ? t(' (diese Woche)') : w.offset === 1 ? t(' (letzte Woche)') : ''),
    w.offset ? h('a', { href: `#/week/${w.offset - 1}` }, t('Woche danach ›')) : h('span', { class: 'muted' }, t('Woche danach ›')));
  const verdict = !w.activeDays ? t('In dieser Woche wurde nicht geübt. Ein kurzer Tag mit „Heute“ reicht für den Neustart.')
    : w.activeDays >= 5 ? t('Stark: an {n} von 7 Tagen geübt.', { n: w.activeDays })
    : t('An {n} von 7 Tagen geübt – Ziel sind 5+ Tage mit je ~30 min.', { n: w.activeDays });
  // I7/R12: laufende Woche, seit ≥ 6 Tagen (bzw. noch nie) keine Chat-Lektion (ex:'chat' im Log, /lektion) → dezenter Hinweis
  const suf = (D.lang?.code ?? 'ka') === 'ka' ? '' : ' ' + D.lang.code, code = s => h('code', {}, s);
  const chat = w.chat?.due ? h('div', { class: 'card small' }, '💬 ', h('b', {}, t('Diese Woche eine Chat-Lektion? ')),
    t('In Claude '), code('/lektion' + suf), w.coaches?.length ? [t(' bzw. gemeinsam '), code(`/lektion ${[w.user, ...w.coaches].join(' ')}${suf}`)] : null,
    h('span', { class: 'muted' }, w.chat.last ? t(' – die letzte war vor {days} Tagen ({lesson}).', { days: w.chat.days, lesson: w.chat.lesson ?? '?' }) : t(' – bisher gab es noch keine.'))) : null;
  const quizBy = {};
  for (const q of w.quiz) (quizBy[q.lesson] ??= []).push(q);

  $app.replaceChildren(
    h('a', { href: '#/' }, t('← Übersicht')), h('h1', {}, t('Wochenrückblick')), nav,
    h('p', {}, verdict), chat ?? '',
    h('div', { class: 'tiles' },
      tile(`${w.activeDays}/7`, t('Lerntage'), diff(w.activeDays, w.prev.activeDays)),
      tile(w.minutes, t('Minuten aktiv'), diff(w.minutes, w.prev.minutes)),
      tile(w.streak, t('Tage in Folge'), w.done ? t('am Wochenende') : t('bis heute')),
      tile(w.cards.reviewed, t('Karten geübt'), t('davon ~{n} neu · {solid}/{total} gefestigt', { n: w.cards.new, solid: w.cards.solid, total: w.cards.total })),
      tile(w.cards.dueNow, t('jetzt fällig'), w.cards.dueNow ? h('a', { href: '#/review' }, t('wiederholen →')) : t('{n} in den nächsten 7 Tagen', { n: w.cards.dueWeek }))),
    box(t('Tage'), h('div', { class: 'week-days' }, w.days.map(d => h('div', { class: 'wd' + (d.n || d.min ? ' on' : ''), title: t('{n} Aktivitäten', { n: d.n }) },
      h('div', { class: 'wd-bar' }, h('i', { style: `height:${Math.round(100 * d.min / maxMin)}%` })),
      h('b', {}, fmtDay(d.day, { weekday: 'short' })), h('span', { class: 'small muted' }, d.n || d.min ? t('{n} min', { n: d.min }) : '–')))),
      h('p', { class: 'small muted' }, t('Minuten = gemessene aktive Lernzeit (⏱ oben); für Tage ohne Messung grob geschätzt aus den Abständen zwischen Übungen.'))),
    box(t('Quiz'),
      w.quiz.length ? h('table', { class: 'small' }, h('tr', {}, h('th', {}, t('Lektion')), h('th', {}, t('Ergebnisse')), h('th', {}, t('bestes'))),
        Object.entries(quizBy).map(([id, qs]) => h('tr', {}, h('td', {}, id),
          h('td', {}, qs.map((q, i) => h('span', { class: q.score / q.of >= .9 ? 'feedback ok' : '' }, i ? ', ' : '', `${fmtDay(q.day, { weekday: 'short' })} ${Math.round(100 * q.score / q.of)} %`))),
          h('td', {}, `${Math.round(100 * Math.max(...qs.map(q => q.score / q.of)))} %`))))
        : h('p', { class: 'muted small' }, t('Kein Quiz in dieser Woche.'))),
    box(t('Problemlaute'),
      w.weak.length ? [h('div', { class: 'row' }, w.weak.map(s => h('span', { class: 'card', style: 'margin:0' },
        h('span', { class: 'ka', style: 'font-size:26px' }, s.char), ' ',
        h('span', { class: 'small muted' }, Object.keys(s.confusions).length ? t('verwechselt mit {x}', { x: Object.entries(s.confusions).sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 2).join(', ') }) : t('{n} Fehler', { n: Math.round(s.errors * 10) / 10 }))))),
        h('p', { class: 'small' }, h('a', { href: '#/weak' }, t('🎯 Problemlaute üben →')))]
        : h('p', { class: 'muted small' }, t('Keine auffälligen Laute in dieser Woche.'))),
    box(t('Als Nächstes'),
      h('p', {}, h('b', {}, `${w.next.lesson}${lesson ? ' · ' + lesson.title : ''}`), t(' – Quiz ≥ 90 % an '),
        t('{n}/2 Tagen', { n: w.next.passedDays.length }), w.next.passedDays.length ? ` (${w.next.passedDays.map(d => fmtDay(d)).join(', ')})` : ''),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => location.hash = '#/today' }, t('Heute lernen')),
        lesson ? h('a', { href: `#/lesson/${lesson.id}` }, t('zur Lektion')) : null)),
  );
}

// Hinweis für die Startseite: Mo–Mi auf die abgeschlossene Vorwoche hinweisen (wegklickbar, pro Woche gemerkt)
export function weekHint(h, api) {
  const el = h('div');
  if (![1, 2, 3].includes(new Date().getDay())) return el;
  api('/api/week?offset=1').then(w => {
    let seen; try { seen = localStorage.getItem('week.seen'); } catch {}
    if (!w.activeDays || seen === w.from) return;
    const close = h('button', { class: 'btn', title: t('ausblenden'), onclick: () => { try { localStorage.setItem('week.seen', w.from); } catch {} el.replaceChildren(); } }, '✕');
    el.replaceChildren(h('div', { class: 'card row' }, h('b', {}, t('📅 Rückblick letzte Woche')),
      h('span', { class: 'muted small' }, t('{d}/7 Lerntage · {m} min · {c} Karten', { d: w.activeDays, m: w.minutes, c: w.cards.reviewed })),
      h('button', { class: 'btn primary', style: 'margin-left:auto', onclick: () => { try { localStorage.setItem('week.seen', w.from); } catch {} location.hash = '#/week/1'; } }, t('Ansehen')), close));
  }).catch(() => {});
  return el;
}
