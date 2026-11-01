// Problemlaute üben: die schwächsten Laute aus /api/weak (Ausspracheprüfung, Hörtraining, Quiz)
// → Laut erklären, Minimalpaare mit diesen Lauten hören, Wörter mit diesen Lauten nachsprechen.
// Schwedisch: Laute = IPA-Einheiten (logstats.mjs → soundUnits), Erklärung aus lang.json (sounds), Wörter über ihre IPA.
import { h, api, shuffle, $app } from '../util.js';
import { D, lessonIdx, knownLetters, letterBy, letterItem, isKa, LANG, txt } from '../data.js';
import { setLesson } from '../opts.js';
import { playBtn, canPlay, rateToggle } from '../audio.js';
import { pairsDrill, ipaUnits } from './listen.js';
import { speakList } from './speak.js';
import { learnerPicker, learnerName, noteForm, userQ } from '../coach.js';
import { t } from '../i18n.js';

const SRC = { asr: t('Aussprache'), listen: t('Hören'), quiz: t('Quiz'), flashread: t('Blitzlesen'), coach: t('Coach') };

// weak: Einträge von /api/weak; nur Laute bis zur Lektion L, höchstens 3
export const focusOf = (L, weak) => {
  if (!isKa()) return weak.slice(0, 3);
  const known = new Set(knownLetters(L.id).map(l => l.char));
  return weak.filter(w => known.has(w.char)).slice(0, 3);
};

export function weakDrill(L, el, weak, { onDone } = {}) {
  const focus = focusOf(L, weak);
  if (!focus.length) {
    el.replaceChildren(h('p', { class: 'muted' }, t('Noch keine Problemlaute erkannt – weiter so! (Sie ergeben sich aus Ausspracheprüfung, Hörtraining und Quiz.)')));
    return onDone?.({ skipped: true });
  }
  const chars = new Set(focus.map(w => w.char));
  const info = weakTable(focus, t('Deine Problemlaute'));
  const box = h('div');
  el.replaceChildren(info, h('div', { class: 'row' }, h('b', {}, t('1. Hören: Minimalpaare')), rateToggle()), box);
  pairsDrill(L, box, { n: 6, focus: chars, onDone: pairs => {
    // 2. Nachsprechen: Silben der Problemlaute + Wörter, die sie enthalten (aktuelle Lektion zuerst)
    const has = v => (isKa() ? [...v.t] : ipaUnits(v.ipa ?? '')).some(c => chars.has(c));
    const words = shuffle(D.vocab.filter(v => canPlay(v) && lessonIdx(v.lesson) <= lessonIdx(L.id) && has(v)))
      .sort((a, b) => (a.lesson === L.id ? 0 : 1) - (b.lesson === L.id ? 0 : 1)).slice(0, 4);
    const items = [...(isKa() ? focus.map(w => ({ ...letterItem(letterBy(w.char)), isLetter: true })).filter(canPlay) : []), ...words];
    box.replaceChildren(h('p', {}, h('b', {}, t('2. Nachsprechen')), ' ' + t('– {score} / {of} Paare richtig gehört. Jetzt selbst sprechen und auf die markierten Laute achten.', { score: pairs.score, of: pairs.of })));
    speakList(items, box);
    box.append(h('button', { class: 'btn primary', onclick: () => onDone ? onDone({ chars: [...chars], pairs, words: items.length }) : location.hash = '#/review' }, onDone ? t('Weiter') : t('Fertig')));
  } });
}

// Tabelle der Problemlaute (Laut, Verwechslungen, Fehler je Quelle)
function weakTable(list, title) {
  return h('div', { class: 'card' }, h('b', {}, title),
    h('table', {}, list.map(w => {
      const l = letterBy(w.char) ?? { translit: '', ipa: w.char, sound: txt(LANG().sounds?.[w.char]) };
      const conf = Object.entries(w.confusions).sort((a, b) => b[1] - a[1]).map(([c]) => c);
      return h('tr', {}, h('td', { class: isKa() ? 'ka' : 'ipa', style: 'font-size:30px' }, w.char),
        h('td', {}, isKa() ? [h('b', {}, l.translit), ' ', h('span', { class: 'ipa' }, l.ipa)] : '',
          conf.length ? h('span', {}, isKa() ? ' – ' + t('verwechselt mit') + ' ' : t('verwechselt mit') + ' ', h('span', { class: isKa() ? 'ka' : 'ipa' }, conf.join(' '))) : null,
          h('div', { class: 'small' }, l.sound),
          h('div', { class: 'small muted' }, t('{n} Fehler ({src})', { n: Math.round(w.errors * 10) / 10, src: Object.entries(w.sources).map(([s, n]) => `${SRC[s] ?? s} ${n}×`).join(', ') }))),
        h('td', {}, isKa() ? playBtn(l) : ''));
    })));
}

// Eigene Seite #/weak; #/weak/<id> = Problemlaute eines Lernenden für den Coach (nur lesen + Notiz, coach.js)
export async function viewWeak(learner) {
  setLesson(null);
  $app.replaceChildren(h('p', { class: 'muted' }, t('Lade …')));
  if (learner) return coachView(learner);
  const [weak, info] = await Promise.all([api('/api/weak'), api('/api/today')]);
  if (!location.hash.startsWith('#/weak')) return;
  const L = D.lessons.find(l => l.id === info.current) ?? D.lessons[0];
  setLesson(L);
  const el = h('div');
  $app.replaceChildren(h('a', { href: '#/review' }, t('← Wiederholen')), h('h1', {}, t('Problemlaute üben')), learnerPicker('weak') ?? '', el);
  weakDrill(L, el, weak);
}

async function coachView(id) {
  const [weak, info] = await Promise.all([api('/api/weak' + userQ(id)), api('/api/today' + userQ(id))]);
  if (location.hash !== '#/weak/' + id) return;
  const head = [h('a', { href: '#/' }, t('← Übersicht')), h('h1', {}, t('Problemlaute – {name}', { name: learnerName(id) })), learnerPicker('weak', id) ?? ''];
  if (weak.error) return $app.replaceChildren(...head, h('p', { class: 'feedback bad' }, weak.error));
  $app.replaceChildren(...head,
    h('p', { class: 'small muted' }, t(info.streak === 1 ? 'Aktuelle Lektion: {id} · {n} Tag in Folge · nur lesen' : 'Aktuelle Lektion: {id} · {n} Tage in Folge · nur lesen', { id: info.current, n: info.streak })),
    weak.length ? weakTable(weak, t('Problemlaute (Ausspracheprüfung, Hörtraining, Quiz; jüngere Fehler zählen mehr)'))
      : h('p', { class: 'card muted' }, t('Noch keine Problemlaute erkannt.')),
    weak.length ? h('p', {}, h('a', { class: 'btn', href: `#/record/${id}` }, t('🎙️ Wörter mit diesen Lauten aufnehmen'))) : '',
    noteForm(id));
}
