// Wiederholen = einzige Übungs-Sammelseite (I10): oben „Fällig“ (Karteikarten aller Lektionen, Fehlerkarten),
// darunter „Gezielt üben“ als Kacheln – nur Übungen, die zur aktuellen Lektion passen (extras.js)
import { h, $app } from '../util.js';
import { setLesson } from '../opts.js';
import { dueKeys } from '../srs.js';
import { flashcards } from './flashcards.js';
import { openErrs, dueErrs } from '../mistakes.js';
import { extras, tiles } from '../extras.js';
import { t } from '../i18n.js';

export function viewReview() {
  setLesson(null);
  const el = h('div');
  const errs = openErrs().length, errDue = dueErrs().length;
  const more = h('div', { class: 'tiles practice' });
  extras().then(({ ok }) => more.replaceWith(tiles(ok, { mistakes: t('{n} von {m} fällig', { n: errDue, m: errs }) }))).catch(() => {});
  $app.replaceChildren(h('a', { href: '#/' }, t('← Übersicht')), h('h1', {}, t('Wiederholen')),
    h('h2', { class: 'sec' }, t('Fällig')),
    errDue ? h('div', { class: 'card row' }, h('b', {}, t(errDue === 1 ? '📕 {n} Fehlerkarte fällig' : '📕 {n} Fehlerkarten fällig', { n: errDue })),
      h('button', { class: 'btn', style: 'margin-left:auto', onclick: () => location.hash = '#/mistakes' }, t('Fehlerheft'))) : '',
    el,
    h('h2', { class: 'sec' }, t('Gezielt üben')), more);
  // keine (weiteren) Karteikarten: „Alles erledigt“ nur, wenn auch keine Fehlerkarte fällig ist
  flashcards(null, el, dueKeys(), { onDone: ({ done }) => {
    const cards = done ? t(done === 1 ? '{n} Karte geschafft ✓' : '{n} Karten geschafft ✓', { n: done }) : t('Keine Karteikarten fällig.');
    el.replaceChildren(errDue
      ? h('div', { class: 'card flash' }, h('h2', {}, cards), h('p', {}, t(errDue === 1 ? 'Noch {n} Fehlerkarte fällig.' : 'Noch {n} Fehlerkarten fällig.', { n: errDue })),
        h('button', { class: 'btn primary', onclick: () => location.hash = '#/mistakes' }, t('📕 Fehlerheft starten')))
      : h('div', { class: 'card flash' }, h('h2', {}, done ? cards : t('Alles erledigt ✓')), done ? null : h('p', { class: 'muted' }, t('Keine fälligen Karten – unten gezielt üben.'))));
  } });
}
