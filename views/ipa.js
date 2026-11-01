// Lautschrift-Legende und Alphabettabelle
import { h, $app } from '../util.js';
import { D } from '../data.js';
import { setLesson } from '../opts.js';
import { playBtn } from '../audio.js';
import { t } from '../i18n.js';

export function viewIpa() {
  setLesson(null);
  const legend = [
    ['ʰ', t('hochgestelltes h = behaucht (kleiner Luftstoß), wie deutsches t, p, k'), 'tʰ pʰ kʰ'],
    ['ʼ', t('Apostroph = ejektiv: ohne Hauch, mit geschlossenem Kehlkopf („Knack“)'), 'tʼ pʼ kʼ qʼ'],
    ['ɑ ɛ ɔ', t('offenes a (Vater), offenes e (Bett), offenes o (Sonne) – alle kurz'), ''],
    ['ɡ', t('g (nur eine andere Schreibweise)'), ''],
    ['z', t('stimmhaftes s wie in „Sonne“ – nicht deutsches z!'), ''],
    ['v', t('w wie in „Wasser“'), ''],
    ['r', t('gerolltes Zungenspitzen-r'), ''],
    ['ʃ ʒ', t('sch (Schule) · stimmhaftes sch (Garage)'), ''],
    ['t͡s d͡z', t('ts (Zahn) · stimmhaftes ds'), ''],
    ['t͡ʃ d͡ʒ', t('tsch (Matsch) · dsch (Dschungel)'), ''],
    ['χ', t('ch wie in „Bach“, weit hinten'), ''],
    ['ʁ', t('Zäpfchen-r wie in „Rabe“, gerieben'), ''],
    ['q', t('k, aber am Zäpfchen (ganz hinten) gebildet'), ''],
  ];
  $app.replaceChildren(h('h1', {}, t('Lautschrift (IPA)')),
    h('p', {}, t('Die Lautschrift in eckigen Klammern zeigt, wie ein Wort klingt. Weil Georgisch so geschrieben wird, wie man spricht, entspricht jeder Buchstabe genau einem IPA-Zeichen.')),
    h('table', {}, legend.map(([s, d, ex]) => h('tr', {}, h('td', { style: 'font-size:22px;white-space:nowrap' }, s), h('td', {}, d, ex ? h('div', { class: 'muted small' }, ex) : null)))),
    h('h2', {}, t('Alle 33 Buchstaben')),
    h('table', {}, D.alphabet.map(l => h('tr', {}, h('td', { class: 'ka', style: 'font-size:28px' }, l.char), h('td', {}, l.translit), h('td', {}, `[${l.ipa}]`), h('td', { class: 'small' }, l.sound), h('td', {}, playBtn(l))))));
}
