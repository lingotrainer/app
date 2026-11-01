// Sprechen: anhören → nachsprechen → Ausspracheprüfung + Spektrogramm
import { h, api } from '../util.js';
import { letterBy, vocabBy, letterItem, isKa, glossText } from '../data.js';
import { playBtn } from '../audio.js';
import { comparePanel } from '../spectrogram.js';
import { asrStatus, ensureAsr, recorder } from '../asr.js';
import { ratingBadge } from '../coach.js';
import { t } from '../i18n.js';

// Tabelle zum Nachsprechen für beliebige Elemente (Wörter oder letterItem); Urteil eines Coaches (GET /api/ratings,
// jüngstes je Item) als Badge unter dem Wort – auch in „Heute → Sprechen“
export function speakList(items, el) {
  comparePanel.style.display = 'none';
  ensureAsr();
  const slots = {};
  api('/api/ratings').then(rs => { for (const [id, r] of Object.entries(rs ?? {})) slots[id]?.replaceChildren(ratingBadge(r)); }).catch(() => {});
  el.append(asrStatus, comparePanel,
    h('table', { class: 'words' }, items.map(it => h('tr', {},
      h('td', { class: 'ka' }, it.isLetter ? it.char : it.t),
      h('td', {}, h('span', { class: 'tr', 'data-ka': it.isLetter ? it.char : it.t }, it.translit), ' ', h('span', { class: 'ipa small', 'data-ka': it.isLetter ? it.char : it.t }, it.ipa), glossText(it) ? h('div', { class: 'small muted' }, glossText(it)) : null,
        slots[it.id] = h('div', { class: 'small' })),
      h('td', {}, h('div', { class: 'row' }, playBtn(it), recorder(it)))))));
}

export function speak(L, el) {
  const items = [...(L.letters ?? []).map(letterBy).map(l => ({ ...letterItem(l, L.id), isLetter: true })),
    ...(L.vocab ?? []).map(vocabBy).filter(Boolean)];
  el.append(h('p', {}, isKa() ? t('Anhören 🔊 → nachsprechen 🎙️ (4 s). Danach bewertet die lokale Erkennung jeden Laut, und die Spektrogramme zeigen Original und dich übereinander. Bei Buchstaben sprichst du die Silbe aus dem Hörbeispiel (z. B. კა).')
    : t('Anhören 🔊 → nachsprechen 🎙️ (4 s). Die Spektrogramme zeigen Original und dich übereinander – achte auf Vokallänge und Melodie.')));
  speakList(items, el);
}
