// Tippen: deutsches Wort → georgisch schreiben (Bildschirmtastatur oder echte Tastatur)
import { h, shuffle, log } from '../util.js';
import { knownLetters, vocabBy, LANG, isKa, glossText, txt } from '../data.js';
import { playBtn } from '../audio.js';
import { keyboard, setKeyHandler } from '../keyboard.js';
import { t } from '../i18n.js';

export function typing(L, el) {
  const known = new Set(knownLetters(L.id).map(l => l.char));
  const vs = shuffle((L.vocab ?? []).map(vocabBy).filter(Boolean));
  let i = 0, text = '', checked = false;
  const prompt = h('div'), typed = h('div', { class: 'typed' }), fb = h('p', { class: 'feedback' });
  const load = () => {
    const v = vs[i % vs.length];
    text = ''; checked = false; typed.textContent = ''; typed.className = 'typed'; fb.textContent = '';
    prompt.replaceChildren(h('div', { class: 'muted small' }, t('Schreib auf {lang}:', { lang: txt(LANG().name) })), h('div', { style: 'font-size:26px' }, glossText(v)),
      h('div', { class: 'tr', 'data-ka': v.t }, v.translit), playBtn(v));
  };
  const onKey = k => {
    const v = vs[i % vs.length];
    if (k === 'Enter') {
      if (checked) { i++; return load(); }
      checked = true;
      // ohne eigene Schrift: Groß-/Kleinschreibung und Satzzeichen am Ende egal
      const norm = x => isKa() ? x.trim() : x.trim().toLowerCase().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
      const ok = norm(text) === norm(v.t);
      typed.className = 'typed ' + (ok ? 'ok' : 'bad');
      fb.className = 'feedback ' + (ok ? 'ok' : 'bad');
      fb.replaceChildren(ok ? t('✓ richtig') : h('span', {}, t('✗ richtig:') + ' ', h('span', { class: 'ka', style: 'font-size:24px' }, v.t), ' ', h('span', { class: 'ipa' }, v.ipa)), h('span', { class: 'muted small' }, '  ' + t('(⏎ weiter)')));
      log({ lesson: L.id, ex: 'typing', item: v.id, ok, typed: text });
      return;
    }
    if (checked) return;
    text = k === 'Backspace' ? text.slice(0, -1) : text + k;
    typed.textContent = text;
  };
  const kb = keyboard(onKey, known);
  setKeyHandler(kb.physical);
  el.append(h('div', { class: 'card' }, prompt, typed, fb, kb,
    h('p', { class: 'small muted' }, isKa() ? t('Du kannst auch die echte Tastatur benutzen (Layout „Georgian QWERTY“: ა = a, ბ = b …; ⇧ für die roten).')
      : t('Tippe mit der echten Tastatur; die Knöpfe oben helfen bei Sonderzeichen. ⏎ prüft.'))));
  load();
}
