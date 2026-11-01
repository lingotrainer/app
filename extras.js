// Zusatz-Übungen (Kacheln „Gezielt üben“ in Wiederholen) nur, wenn sie zur aktuellen Lektion passen (todo.md B5):
// Zahlen ab A1-04 (sv: sv-A1-04), Blitzlesen nur Georgisch (alle Stufen), Formen ab der ersten Lektion mit Formen, Problemlaute erst ab ≥ 3 Fehlern.
import { h, api } from './util.js';
import { D, isKa, stageOf, reached } from './data.js';
import { hasForms } from './views/forms.js';
import { openErrs } from './mistakes.js';
import { langMod } from './langmods.js';
import { t } from './i18n.js';

export async function extras() {
  const [td, weak] = await Promise.all([api('/api/today').catch(() => ({})), api('/api/weak').catch(() => [])]);
  const stage = stageOf(td.current), firstForms = D.lessons.find(hasForms)?.id;
  const ok = {
    listen: true,
    weak: weak.reduce((a, w) => a + w.errors, 0) >= 3,
    forms: !!firstForms && reached(td.current, firstForms),
    numbers: !!langMod('numbers') && reached(td.current, langMod('numbers').from20),   // ab der Zahlen-Lektion (ka A1-04, sv-A1-04, en-A1-02)
    'flash-read': true,
    mistakes: openErrs().length > 0,
  };
  return { current: td.current, stage, ok };
}

const LINKS = {
  review: () => t('🔁 Wiederholen & üben'), week: () => t('📅 Wochenrückblick'),
};
// Kacheln „Gezielt üben“ (Wiederholen, I10): [Schlüssel, Titel, Kurzbeschreibung]; sub überschreibt die Beschreibung
const TILES = [
  ['listen', t('🎧 Hörtraining'), t('Minimalpaare, Diktat')], ['flash-read', t('⚡ Blitzlesen'), t('Wörter schnell erkennen')],
  ['weak', t('🎯 Problemlaute'), t('Laute mit den meisten Fehlern')], ['mistakes', t('📕 Fehlerheft'), t('Fehler in Übungsform')],
  ['forms', t('📋 Formen'), t('Wortformen abfragen')], ['numbers', t('🔢 Zahlen'), () => isKa() ? t('Zwanzigersystem') : t('Zahlwörter, Uhrzeit, Preise')],
];
export const tiles = (ok, sub = {}) => h('div', { class: 'tiles practice' }, TILES.filter(([k]) => ok[k]).map(([k, name, desc]) =>
  h('a', { class: 'tile', href: '#/' + k }, h('b', {}, name), h('div', { class: 'small muted' }, sub[k] ?? (typeof desc === 'function' ? desc() : desc)))));
// Zeile „a · b · c“ aus den erlaubten Schlüsseln (Reihenfolge wie übergeben)
export const linkLine = (keys, ok, prefix = '') => h('p', { class: 'small' }, prefix,
  keys.filter(k => ok[k] ?? true).flatMap((k, i) => [i ? ' · ' : '', h('a', { href: '#/' + k }, LINKS[k]())]));
