// Lautieren (nur ka): ein Wort wird Laut für Laut aufgebaut, wie Leseanfänger es tun – Lesehilfe zwischen „nur Mkhedruli“
// und „Lösung zeigen“. Buchstaben nacheinander hervorgehoben, dazu ihr Laut, die Umschrift erscheint erst danach;
// am Ende das ganze Wort einmal normal und einmal mit 0,75×. Antippen eines Buchstabens → Details (letters.js).
// Laute: Vokale pur (letter-a.mp3 …), Konsonanten sind als Silbe Konsonant+ა aufgenommen (letter-audio.mjs) und werden
// standardmäßig gekürzt: Web Audio sucht den Vokaleinsatz (erstes Stück > −10 dB unter dem Spitzenwert, mind. 100 ms nach
// dem Lautbeginn) und spielt bis 70 ms danach – genug Übergang, dass Ejektiv/Hauch hörbar bleiben. Umschaltbar auf die
// ganze Silbe (localStorage spell.syl). Ohne Web Audio oder bei Fehlern läuft die ganze Silbe.
// Aufrufe: spellView(item, c) als Element (Blitzlesen ✗, Quiz falsch, Karteikarte „Nochmal“), openSpell(item, c) als Dialog
// (Knopf 🔤 neben playBtn, audio.js). c = ctx(). Log: {ex:'spell', item, lesson}.
// Offline: Buchstaben-Audios lädt prefetch.js mit; fetch() geht über den Service Worker (Audio-Cache).
import { t } from './i18n.js';

const STEP_MIN = 850, PAUSE = 300, SOUND = -35, LOUD = -10, CONS_MIN = .10, TAIL = .07, FADE = .03;
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} };
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- Audio ----------
let ac = null, cur = null;
const actx = () => ac ??= new (window.AudioContext || window.webkitAudioContext)();
const segs = new Map();
// Datei → { buf, start, cut, end } (Sekunden): Lautbeginn, Vokaleinsatz + TAIL, Lautende
function segment(url) {
  if (!segs.has(url)) segs.set(url, fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(b => actx().decodeAudioData(b)).then(buf => {
      const x = buf.getChannelData(0), hop = Math.round(buf.sampleRate / 100), n = Math.floor(x.length / hop);
      const db = Array.from({ length: n }, (_, i) => {
        let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j];
        return Math.sqrt(s / hop) + 1e-9;
      });
      const peak = Math.max(...db), rel = db.map(v => 20 * Math.log10(v / peak));
      const on = Math.max(0, rel.findIndex(v => v > SOUND)), off = n - [...rel].reverse().findIndex(v => v > SOUND);
      const loud = rel.findIndex((v, i) => i >= on && v > LOUD);
      const start = Math.max(0, on / 100 - .02), end = Math.min(buf.duration, off / 100 + .03);
      return { buf, start, end, cut: Math.min(end, Math.max(loud / 100, start + CONS_MIN) + TAIL) };
    }).catch(e => { segs.delete(url); throw e; }));
  return segs.get(url);
}
function playBuf({ buf }, from, to) {
  return new Promise(res => {
    const a = actx(), src = a.createBufferSource(), g = a.createGain();
    src.buffer = buf; src.connect(g).connect(a.destination);
    const t0 = a.currentTime + .01, d = Math.max(.05, to - from);
    g.gain.setValueAtTime(1, t0); g.gain.setValueAtTime(1, t0 + d - FADE); g.gain.linearRampToValueAtTime(0, t0 + d);
    // Zeitlimit: ein (ohne Nutzeraktion) angehaltener AudioContext würde onended nie auslösen
    const t2 = setTimeout(res, d * 1000 + 600);
    src.onended = () => { clearTimeout(t2); res(); }; cur = { stop: () => { try { src.stop(); } catch {} clearTimeout(t2); res(); } };
    src.start(t0, from, d);
  });
}
const audioUrl = f => 'audio/' + f.split('/').map(encodeURIComponent).join('/');
// HTML-Audio mit Ende-Erkennung (Wort, Ersatz für Buchstaben); ohne Datei Browser-Stimme über c.play und feste Wartezeit
function playEl(file, rate = 1) {
  return new Promise(res => {
    const a = new Audio(audioUrl(file)); a.playbackRate = rate;
    const tm = setTimeout(res, 6000);
    const fin = () => { clearTimeout(tm); res(); };
    a.onended = a.onerror = fin; cur = { stop: () => { a.pause(); fin(); } };
    a.play().catch(fin);
  });
}
async function letterSound(l) {
  if (!l.audio) return wait(STEP_MIN);
  const syl = store('spell.syl') === '1' || l.type === 'vowel';
  try { const s = await segment(audioUrl(l.audio)); if (actx().state === 'suspended') ac.resume().catch(() => {}); return playBuf(s, s.start, syl ? s.end : s.cut); }
  catch { return playEl(l.audio); }
}
const stop = () => { cur?.stop(); cur = null; };

// ---------- Ansicht ----------
// onDone() nach dem ersten Durchlauf; auto = sofort starten (sobald das Element im Dokument hängt)
export function spellView(item, c, { auto = true, onDone = null } = {}) {
  const { h } = c;
  const chars = [...item.t];
  const len = Math.max(...item.t.split(/\s+/).map(w => [...w].length));
  const size = `min(46px, calc((100vw - 70px) / ${(len * 0.8).toFixed(2)}))`;
  const detail = h('div', { class: 'letter-detail spell-detail', hidden: true });
  let sel = null;
  const cells = chars.map(ch => {
    const l = c.letterBy(ch);
    if (!l) return h('span', { class: 'spell-gap' }, ch.trim() ? ch : '');
    const b = h('button', { class: 'spell-l', title: t('{ch}: Details', { ch }), 'aria-label': t('Buchstabe {name}', { name: l.name }), onclick: () => {
      sel?.classList.remove('sel');
      if (sel === b) { sel = null; detail.hidden = true; return; }
      sel = b; b.classList.add('sel');
      detail.replaceChildren(c.letterDetail(ch)); detail.hidden = false;
    } }, h('span', { class: 'ka', style: `font-size:${size}` }, ch), h('span', { class: 'spell-tr' }, l.translit));
    b._l = l;
    return b;
  });
  const word = h('div', { class: 'spell-word', lang: 'ka' }, cells);
  const again = h('button', { class: 'btn', onclick: () => go() }, t('🔤 nochmal'));
  const syl = h('label', { class: 'small muted spell-syl' }, h('input', { type: 'checkbox', checked: store('spell.syl') === '1',
    onchange: e => store('spell.syl', e.target.checked ? '1' : '0') }), t(' Konsonanten als Silbe ('), h('span', { class: 'ka' }, 'კა'), ')');
  const el = h('div', { class: 'spell' }, word,
    h('div', { class: 'row spell-ctl', style: 'justify-content:center;gap:10px' }, again, syl), detail);
  let run = 0, first = true;
  async function go() {
    const me = ++run; stop();
    const alive = () => me === run && el.isConnected;
    cells.forEach(b => b.classList?.remove('cur', 'done'));
    word.classList.remove('whole');
    again.disabled = true;
    for (const b of cells) {
      if (!b._l) continue;
      if (!alive()) return;
      b.classList.add('cur');
      const t0 = performance.now();
      await letterSound(b._l);
      if (!alive()) return;
      b.classList.add('done');
      await wait(Math.max(PAUSE, STEP_MIN - (performance.now() - t0)));
      b.classList.remove('cur');
    }
    if (!alive()) return;
    word.classList.add('whole');
    for (const rate of [1, .75]) {
      if (item.audio) await playEl(item.audio, rate); else { c.play(item); await wait(1500 / rate); }
      if (!alive()) return;
      await wait(400);
    }
    again.disabled = false;
    if (first) { first = false; onDone?.(); }
  }
  c.log({ ex: 'spell', item: item.id, lesson: item.lesson });
  // Web Audio noch im Klick des Aufrufers freigeben (iOS: resume() nur in einer Nutzeraktion)
  try { if (actx().state === 'suspended') ac.resume().catch(() => {}); } catch {}
  // erst starten, wenn eingehängt (Aufrufer hängt el gleich nach der Rückgabe ein)
  if (auto) requestAnimationFrame(() => el.isConnected && go());
  el.start = go;
  return el;
}

// Als Dialog über der aktuellen Seite (Knopf 🔤 neben einem Wort); schließt bei Seitenwechsel
export function openSpell(item, c) {
  const { h } = c;
  const close = () => { stop(); dlg.close(); };
  const dlg = h('dialog', { class: 'spell-dialog', onclose: () => { stop(); dlg.remove(); removeEventListener('hashchange', close); } },
    h('div', { class: 'row', style: 'justify-content:space-between;align-items:center' },
      h('b', {}, t('🔤 Lautieren')), h('button', { class: 'btn icon', 'aria-label': t('Schließen'), onclick: close }, '✕')),
    spellView(item, c),
    c.gloss(item).length ? h('p', { class: 'small muted', style: 'text-align:center' }, c.glossText(item)) : null);
  dlg.addEventListener('click', e => { if (e.target === dlg) close(); });   // Klick neben den Inhalt
  addEventListener('hashchange', close);
  document.body.append(dlg);
  dlg.showModal();
}
