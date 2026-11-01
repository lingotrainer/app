// Dialog (Rollenspiel), Tab in der Lektion: Gegenüber spricht (Zeilen-Audio, sonst Text), du wählst die passende Antwort
// aus 3 Optionen oder sprichst sie (Aufnahme + Ausspracheprüfung, dann selbst bewerten). Daten: data/dialogs/<Lektion>.json
import { h, log, shuffle, url } from '../util.js';
import { canPlay, play, playBtn } from '../audio.js';
import { comparePanel } from '../spectrogram.js';
import { asrStatus, ensureAsr, recorder } from '../asr.js';
import { reading, kaText, ipaOf, ttsInfo } from './read.js';
import { translit, isKa, LANG, trText, txt } from '../data.js';
import { mistake } from '../mistakes.js';
import { verifiedBadge } from '../checkbadge.js';
import { t } from '../i18n.js';

const lineItem = (d, l, i) => ({ id: `${d.id}-${i + 1}`, t: l.t, audio: l.audio, audioInfo: l.audio ? ttsInfo() : null, lesson: d.lesson,
  translit: isKa() ? translit(l.t) : '', ipa: isKa() ? ipaOf(l.t) : '' });
// Zeile vorspielen; Promise endet mit der Wiedergabe (ohne Datei: kurze Pause)
const rate = () => { try { return Number(localStorage.getItem('rate')) || 1; } catch { return 1; } };
function sayLine(it) {
  if (!it.audio) { if (canPlay(it)) play(it); return new Promise(ok => setTimeout(ok, 1200)); }
  const a = new Audio(url('/audio/' + it.audio));
  a.playbackRate = rate();
  return new Promise(ok => { a.onended = a.onerror = ok; a.play().catch(ok); });
}

let mode = 'choose';              // bleibt beim Wechsel zwischen Dialogen erhalten
export async function dialog(L, el) {
  const R = await reading();
  const ds = R.dialogs.filter(d => d.lesson === L.id);
  if (!ds.length) return el.append(h('p', { class: 'muted' }, t('Für diese Lektion gibt es noch keinen Dialog.') + ' ', h('a', { href: '#/read' }, t('📖 Zum Lesemodus'))));
  const modeSel = h('div', { class: 'row' }, t('Antworten:') + ' ', [['choose', t('👆 auswählen')], ['speak', t('🎙️ sprechen')]].map(([m, name]) =>
    h('label', {}, h('input', { type: 'radio', name: 'dmode', checked: m === mode, onchange: () => mode = m }), ' ', name)));
  el.append(h('p', {}, t('Rollenspiel: Hör zu, was dein Gegenüber sagt, und antworte. Wörter lassen sich antippen.')), modeSel,
    ...ds.map(d => h('div', { class: 'card lesson-row' }, h('div', { style: 'flex:1' }, h('b', {}, txt(d.title)),
      h('div', { class: 'small muted' }, t('{name} und du · {n} Antworten', { name: txt(d.speakers[d.you === 'A' ? 'B' : 'A']), n: d.lines.filter(l => l.speaker === d.you).length }))),
      h('a', { href: `#/read/${d.id}`, class: 'small' }, t('📖 lesen')),
      h('button', { class: 'btn primary', onclick: () => run(d, el, mode, () => { el.replaceChildren(); dialog(L, el); }) }, t('Start')))));
}

// Ein Dialog der Lektion im Heute-Ablauf (zufällig gewählt); onDone({score, of, wrong}), ohne Dialog onDone({skipped: true})
export async function dialogDrill(L, el, { onDone }) {
  const ds = (await reading()).dialogs.filter(d => d.lesson === L.id);
  if (!ds.length) return onDone({ skipped: true });
  run(shuffle(ds)[0], el, mode, null, onDone);
}

// Nur bestimmte eigene Zeilen abfragen (Fehlerheft): lines = 0-basierte Zeilennummern; davor nur kurz der Zusammenhang
export async function dialogLines(id, lines, el, { onDone, counter }) {
  const d = (await reading()).dialogs.find(x => x.id === id);
  if (!d) return onDone({ skipped: true });
  run(d, el, 'choose', null, onDone, new Set(lines), counter);
}

// counter(k, n): k-te eigene Zeile von n (Fehlerheft); ohne Option läuft kein Zähler mit
function run(d, el, mode, back, onDone, only = null, counter = null) {
  const chat = h('div', { class: 'chat' }), act = h('div', { class: 'dlg-act' });
  if (mode === 'speak') { comparePanel.style.display = 'none'; if (LANG().asr) ensureAsr(); }
  el.replaceChildren(h('div', { class: 'row' }, back ? h('button', { class: 'btn', onclick: back }, t('← Dialoge')) : null, h('b', {}, txt(d.title))),
    mode === 'speak' ? h('div', {}, asrStatus, comparePanel) : '', chat, act);
  let i = 0, firstTry = 0, turns = 0;
  const wrong = [];
  const ctx = { glossary: d.glossary, lesson: d.lesson };
  const bubble = (l, n, mine) => {
    const it = lineItem(d, l, n);
    const b = h('div', { class: 'bubble' + (mine ? ' mine' : '') },
      h('div', { class: 'small muted' }, txt(d.speakers[l.speaker])),
      l.hint && !mine ? h('div', { class: 'small muted', style: 'font-style:italic' }, txt(l.hint)) : null,
      h('div', { class: 'row', style: 'flex-wrap:nowrap;align-items:flex-start' }, h('div', { style: 'flex:1' }, kaText(l.t, ctx)), canPlay(it) ? playBtn(it) : null),
      h('details', { class: 'small' }, h('summary', { class: 'muted' }, t('übersetzen')), trText(l),
        verifiedBadge(l)));
    chat.append(b);
    b.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return it;
  };
  const next = () => {
    if (!chat.isConnected) return;   // Ansicht verlassen
    act.replaceChildren();
    if (i >= d.lines.length) return finish();
    const l = d.lines[i], n = i++;
    if (only) {
      if (n > Math.max(...only)) { i = d.lines.length; return finish(); }
      if (n < Math.min(...only) - 1 || (l.speaker === d.you && !only.has(n))) { bubble(l, n, l.speaker === d.you); return next(); }
    }
    if (l.speaker !== d.you) return sayLine(bubble(l, n, false)).then(() => setTimeout(next, 400));
    turns++;
    counter?.(turns, only ? only.size : d.lines.filter(x => x.speaker === d.you).length);
    const it = lineItem(d, l, n);
    let tries = 0;
    const done = ok => {
      if (ok && tries === 0) firstTry++; else wrong.push(l.t);
      log({ lesson: d.lesson, ex: 'dialog', item: `${d.id}:${n + 1}`, ok: ok && tries === 0, mode });
      mistake('dialog', `${d.id}:${n + 1}`, { lesson: d.lesson, d: d.id, line: n }, ok && tries === 0);
      bubble(l, n, true); sayLine(it);
      act.replaceChildren(h('button', { class: 'btn primary', onclick: next }, t('Weiter')));
    };
    const prompt = h('div', { class: 'small' }, t('👉 Du bist dran'), l.hint ? h('span', { class: 'muted' }, ` – ${txt(l.hint)}`) : null);
    if (mode === 'choose') {
      const fb = h('div', { class: 'small' });
      const opts = shuffle([{ t: l.t, tr: l.tr, ok: true }, ...l.wrong]);
      act.append(prompt, h('div', { class: 'options dlg-opts' }, opts.map(o => h('button', { onclick: e => {
        if (o.ok) return done(true);
        tries++;
        e.currentTarget.classList.add('bad'); e.currentTarget.disabled = true;
        fb.replaceChildren(h('span', { class: 'feedback bad' }, '✗ '), h('span', { class: 'ka' }, o.t), ' ' + t('heißt „{de}“ – passt hier nicht.', { de: trText(o) }));
      } }, h('span', { class: 'ka' }, o.t)))), fb);
    } else {
      const reveal = h('div');
      act.append(prompt, h('p', {}, t('Sag auf {lang}:', { lang: txt(LANG().name) }) + ' ', h('b', {}, `„${trText(l)}“`)),
        h('div', { class: 'row' }, recorder({ ...it, t: l.t.replace(/[^\p{L} ]/gu, '').replace(/\s+/g, ' ').trim() }),
          h('button', { class: 'btn', onclick: () => {
            reveal.replaceChildren(h('div', { class: 'row' }, kaText(l.t, ctx), playBtn(it)),
              isKa() ? h('div', { class: 'small' }, h('span', { class: 'tr', 'data-ka': it.t }, it.translit), ' ', h('span', { class: 'ipa', 'data-ka': it.t }, it.ipa)) : null,
              h('div', { class: 'row', style: 'margin-top:8px' }, t('Hattest du es richtig?'),
                h('button', { class: 'btn primary', onclick: () => done(true) }, t('✓ ja')),
                h('button', { class: 'btn', onclick: () => { tries++; done(false); } }, t('✗ nein'))));
          } }, t('Lösung zeigen'))), reveal);
    }
  };
  const finish = () => act.replaceChildren(h('div', { class: 'card flash' },
    h('h2', {}, t('Dialog geschafft ✓')), h('p', {}, t('{n} von {m} Antworten auf Anhieb richtig.', { n: firstTry, m: turns })),
    h('div', { class: 'row', style: 'justify-content:center' }, onDone
      ? h('button', { class: 'btn primary', onclick: () => onDone({ score: firstTry, of: turns, wrong, title: txt(d.title) }) }, t('Weiter'))
      : [h('button', { class: 'btn primary', onclick: () => run(d, el, mode, back) }, t('Nochmal')),
        h('button', { class: 'btn', onclick: back }, t('Andere Dialoge'))])));
  next();
}
