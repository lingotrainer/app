// Spektrogramm (zum Vergleich Original ↔ eigene Aufnahme)
import { h, url } from './util.js';
import { t } from './i18n.js';

function fft(re, im) {                 // in-place, Länge = 2^k
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}
const RATE = 16000;
async function decode(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, RATE, RATE);
  const audio = await ctx.decodeAudioData(buf);
  // Stille am Rand abschneiden, damit beide Aufnahmen gleich beginnen
  const d = audio.getChannelData(0), peak = d.reduce((m, x) => Math.max(m, Math.abs(x)), 0) || 1, thr = peak * .06;
  let s = d.findIndex(x => Math.abs(x) > thr), e = d.length - 1;
  while (e > s && Math.abs(d[e]) < thr) e--;
  return d.slice(Math.max(0, s - 800), Math.min(d.length, e + 1600)).map(x => x / peak);
}
function drawSpectrogram(canvas, samples, seconds) {
  const N = 512, hop = 128, frames = Math.max(1, Math.floor((samples.length - N) / hop));
  const W = canvas.width, H = canvas.height, g = canvas.getContext('2d');
  const img = g.createImageData(W, H);
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const bins = N / 2 * (8000 / (RATE / 2)) | 0;           // 0–8 kHz
  const usedW = Math.min(W, Math.round(W * (samples.length / RATE) / seconds));
  // erst alle Frames berechnen, dann relativ zum lautesten Punkt darstellen (50 dB Dynamik)
  const spec = [];
  let max = -Infinity;
  for (let f = 0; f < frames; f++) {
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) re[i] = (samples[f * hop + i] ?? 0) * (.5 - .5 * Math.cos(2 * Math.PI * i / N));
    fft(re, im);
    const col = new Float32Array(bins);
    for (let b = 0; b < bins; b++) { col[b] = 10 * Math.log10(re[b] ** 2 + im[b] ** 2 + 1e-10); if (col[b] > max) max = col[b]; }
    spec.push(col);
  }
  for (let x = 0; x < usedW; x++) {
    const col = spec[Math.min(frames - 1, Math.floor(x / usedW * frames))];
    for (let y = 0; y < H; y++) {
      const b = Math.min(bins - 1, Math.floor((1 - y / H) * bins));
      const v = Math.max(0, Math.min(1, (col[b] - max + 50) / 50)) ** 1.6;
      const p = (y * W + x) * 4, c = dark ? v * 255 : 255 - v * 235;
      img.data[p] = dark ? c * .9 : c; img.data[p + 1] = dark ? c * .8 : c * .97; img.data[p + 2] = dark ? c * .6 : c * .92; img.data[p + 3] = 255;
    }
  }
  g.clearRect(0, 0, W, H);
  g.putImageData(img, 0, 0);
}
export const comparePanel = h('div', { class: 'card compare', style: 'display:none' });
export async function showCompare(item, mineUrl, scoreBox, title) {
  comparePanel.style.display = '';
  comparePanel.replaceChildren(h('span', { class: 'small muted' }, t('lade …')));
  comparePanel.scrollIntoView({ block: 'nearest' });       // Panel steht über der Wortliste: nach einer Aufnahme weiter unten sonst außer Sicht
  const ref = item.audio ? url('/audio/' + item.audio) : null;
  const [a, b] = await Promise.all([ref ? decode(ref) : null, decode(mineUrl)]);
  const secs = Math.max(a?.length ?? 0, b.length) / RATE;
  const mk = (label, data, url) => {
    const c = h('canvas', { width: 700, height: 120, style: 'width:100%;height:120px;border-radius:6px' });
    if (data) drawSpectrogram(c, data, secs);
    return h('div', {}, h('div', { class: 'row small' }, h('b', {}, label), url ? h('button', { class: 'btn icon', onclick: () => new Audio(url).play() }, '▶️') : t(' (kein Original)')), c);
  };
  comparePanel.replaceChildren(
    h('div', { class: 'row' }, h('b', { class: 'ka', style: 'font-size:26px' }, title), h('span', { class: 'ipa' }, item.ipa),
      h('button', { class: 'btn icon', style: 'margin-left:auto', onclick: () => comparePanel.style.display = 'none' }, '✕')),
    scoreBox ?? '',
    spectro(mk(t('Original'), a, ref), mk(t('Du'), b, mineUrl),
    h('p', { class: 'small muted' }, t('Lesehilfe: Dunkle waagerechte Streifen = Vokal. Behauchte Laute (თ ფ ქ ც ჩ) zeigen vor dem Vokal eine graue Rauschfläche (der Hauch). Bei Ejektiven (ტ პ კ წ ჭ ყ) fehlt sie: ein scharfer senkrechter Strich, kurze Lücke, dann setzt der Vokal hart ein. Zischlaute (ს შ ც) sind Rauschen oben im Bild.'))));
  comparePanel.scrollIntoView({ block: 'nearest', behavior: 'smooth' });   // Höhe hat sich geändert (Ergebnis + Spektrogramm)
}
// Am Handy nimmt das Spektrogramm fast den ganzen Bildschirm ein: dort eingeklappt (Ergebnis der Prüfung bleibt sichtbar)
const spectro = (...kids) => matchMedia('(max-width: 560px)').matches
  ? h('details', {}, h('summary', { class: 'small' }, t('Spektrogramm zeigen (Original ↔ du)')), ...kids)
  : h('div', {}, ...kids);
