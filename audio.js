// Audio abspielen (Datei oder Browser-Stimme)
import { h, toast, url } from './util.js';
import { canSpell } from './data.js';
import { t } from './i18n.js';

export let kaVoice = null;
// kaVoice = Browser-Stimme der Lernsprache (Name historisch; geo_lang setzt account.js)
const voiceLang = () => { try { return localStorage.getItem('geo_lang') || 'ka'; } catch { return 'ka'; } };
function findVoice() { kaVoice = speechSynthesis?.getVoices().find(v => v.lang?.toLowerCase().startsWith(voiceLang())) ?? null; }
if ('speechSynthesis' in window) { findVoice(); speechSynthesis.onvoiceschanged = findVoice; }
export const canPlay = item => !!(item.audio || kaVoice);

// Wiedergabegeschwindigkeit (global, 1× oder 0,75×), Schalter oben in der Kopfzeile und im Hörtraining
let rate = 1;
try { rate = Number(localStorage.getItem('rate')) || 1; } catch {}
const rateLabel = () => rate === 1 ? '1×' : '0,75×';
export function rateToggle() {
  const b = h('button', { class: 'btn rate', title: t('Wiedergabegeschwindigkeit umschalten (1× / 0,75×)'), onclick: () => {
    rate = rate === 1 ? .75 : 1;
    try { localStorage.setItem('rate', rate); } catch {}
    document.querySelectorAll('button.rate').forEach(x => x.textContent = '🐢 ' + rateLabel());
  } }, '🐢 ' + rateLabel());
  return b;
}
document.getElementById('rate-slot')?.append(rateToggle());

export function play(item) {
  if (item.audio) { const a = new Audio(url('/audio/' + item.audio)); a.playbackRate = rate; return a.play(); }
  if (kaVoice) { const u = new SpeechSynthesisUtterance(item.t ?? item.char); u.voice = kaVoice; u.lang = kaVoice.lang; u.rate = .8 * rate; return speechSynthesis.speak(u); }
  toast(t('Für dieses Element gibt es noch keine Aufnahme.'));
}
// Neben einem georgischen Wort zusätzlich 🔤 Lautieren (spell.js, erst beim Antippen geladen); spell: false lässt es weg
const spellBtn = item => h('button', { class: 'btn icon', title: t('Lautieren: Buchstabe für Buchstabe'), 'aria-label': t('Lautieren'), onclick: e => {
  e.stopPropagation();
  Promise.all([import('./spell.js'), import('./ctx.js')]).then(([s, x]) => s.openSpell(item, x.ctx()));
} }, '🔤');
export const playBtn = (item, { spell = true } = {}) => h('span', { class: 'row', style: 'display:inline-flex;gap:4px' },
  h('button', { class: 'btn icon', title: item.audioInfo?.label ?? t('Anhören'), onclick: e => { e.stopPropagation(); play(item); }, disabled: !item.audio && !kaVoice }, '🔊'),
  item.audioInfo ? h('span', { class: 'badge ' + item.audioInfo.kind, title: item.audioInfo.label }, item.audioInfo.kind === 'native' ? t('echt') : 'TTS') : null,
  spell && canSpell(item) ? spellBtn(item) : null);
