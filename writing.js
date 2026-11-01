// Schreibübung (Lektions-Tab „Schreiben“): Buchstaben nachfahren, dann frei schreiben und mit der Vorlage vergleichen.
// Strichfolge aus data/strokes.json (D.strokes): Animation, Startpunkte beim Nachfahren, Hinweis zu Reihenfolge/Richtung.
import { t } from './i18n.js';

// replaceChildren ohne null/false (würde sonst als Text „null“ erscheinen)
const fill = (el, ...kids) => el.replaceChildren(...kids.filter(k => k != null && k !== false));
const FONT = '"Noto Sans Georgian", "Sylfaen", sans-serif';
const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();

// Schriftmaße einmal bestimmen (bei 100 px): größte Ober-/Unterlänge über alle Buchstaben, x-Höhe aus ა
let metrics = null;
function measure(chars) {
  const g = document.createElement('canvas').getContext('2d');
  g.font = `100px ${FONT}`;
  const m = c => g.measureText(c);
  return { asc: Math.max(...chars.map(c => m(c).actualBoundingBoxAscent)), desc: Math.max(...chars.map(c => m(c).actualBoundingBoxDescent)),
    xh: m('ა').actualBoundingBoxAscent };
}
// Layout im Einheitsquadrat 0..1: Schriftgröße und Linien so, dass Ober- bis Unterlänge 80 % der Höhe füllen
function layout() {
  const k = .8 / (metrics.asc + metrics.desc);           // pro px bei 100 px Schrift
  const size = 100 * k, base = .1 + metrics.asc * k;
  return { size, base, asc: base - metrics.asc * k, xh: base - metrics.xh * k, desc: base + metrics.desc * k, pen: size * .085 };
}

function drawGlyph(g, char, S, L, mode, extra = 0) {
  g.font = `${L.size * S}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  if (mode === 'fill' || mode === 'both') g.fillText(char, S / 2, L.base * S);
  if (extra) { g.lineWidth = extra * S; g.lineJoin = 'round'; g.strokeText(char, S / 2, L.base * S); }
}
function drawStrokes(g, strokes, S, width) {
  g.lineCap = g.lineJoin = 'round'; g.lineWidth = width * S;
  for (const st of strokes) {
    g.beginPath();
    st.forEach(([x, y], i) => i ? g.lineTo(x * S, y * S) : g.moveTo(x * S, y * S));
    if (st.length === 1) g.lineTo(st[0][0] * S + .1, st[0][1] * S);
    g.stroke();
  }
}

// ---------- Strichfolge ----------
// strokes.json: Punkte 0..1 im Tintenrahmen der Glyphe → Einheitsquadrat der Schreibübung (passt so auch bei Ersatzschrift)
export function strokePaths(char, entry, L) {
  const g = document.createElement('canvas').getContext('2d');
  g.font = `100px ${FONT}`; g.textAlign = 'center';
  const m = g.measureText(char), k = L.size / 100;
  const x0 = .5 - m.actualBoundingBoxLeft * k, x1 = .5 + m.actualBoundingBoxRight * k;
  const y0 = L.base - m.actualBoundingBoxAscent * k, y1 = L.base + m.actualBoundingBoxDescent * k;
  return entry.strokes.map(st => st.map(([x, y]) => [x0 + x * (x1 - x0), y0 + y * (y1 - y0)]));
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const lengthOf = st => st.reduce((n, p, i) => i ? n + dist(st[i - 1], p) : 0, 0);
// Anfang eines Strichs bis zur Länge len (für die Animation)
function cut(st, len) {
  const out = [st[0]];
  for (let i = 1; i < st.length; i++) {
    const d = dist(st[i - 1], st[i]);
    if (d >= len) { const f = d ? len / d : 0; out.push([st[i - 1][0] + (st[i][0] - st[i - 1][0]) * f, st[i - 1][1] + (st[i][1] - st[i - 1][1]) * f]); return out; }
    len -= d; out.push(st[i]);
  }
  return out;
}
// Pfeilspitze am Ende von st, Nummernkreis am Anfang
function arrowHead(g, st, S, size) {
  const b = st[st.length - 1];
  let a = st[st.length - 2];
  for (let i = st.length - 2; i >= 0 && dist(st[i], b) < .02; i--) a = st[i];
  if (!a || dist(a, b) < 1e-4) return;
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  g.beginPath();
  for (const s of [-1, 1]) { g.moveTo(b[0] * S, b[1] * S); g.lineTo((b[0] - size * Math.cos(ang + s * .45)) * S, (b[1] - size * Math.sin(ang + s * .45)) * S); }
  g.stroke();
}
function startMark(g, p, n, S, r) {
  g.beginPath(); g.arc(p[0] * S, p[1] * S, r * S, 0, 7); g.fill();
  const fill = g.fillStyle; g.fillStyle = '#fff';
  g.font = `600 ${r * 1.3 * S}px "Noto Sans", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(n, p[0] * S, p[1] * S + r * .08 * S); g.fillStyle = fill;
}
// Striche bis zur Gesamtlänge len zeichnen (Infinity = alle): Linie, Pfeil an der Spitze, Nummer am Start
export function drawOrder(g, paths, S, { len = Infinity, width = .03, color = '#2563eb' } = {}) {
  g.save(); g.strokeStyle = g.fillStyle = color; g.lineCap = g.lineJoin = 'round';
  paths.forEach((st, i) => {
    const l = lengthOf(st);
    if (len <= 0) return;
    const part = len >= l ? st : cut(st, len);
    len -= l;
    g.lineWidth = width * S; g.globalAlpha = .75;
    g.beginPath(); part.forEach(([x, y], j) => j ? g.lineTo(x * S, y * S) : g.moveTo(x * S, y * S)); g.stroke();
    g.globalAlpha = 1; g.lineWidth = Math.max(1.5, width * S * .45);
    if (part.length > 1) arrowHead(g, part, S, width * 1.6);
    startMark(g, st[0], i + 1, S, width * .9);
  });
  g.restore();
}
// Animation auf canvas (Pixelgröße = canvas.width), Tempo in Einheiten/s, kurze Pause zwischen Strichen; liefert stop()
export function animateOrder(canvas, paths, { speed = .55, width, color, onDone } = {}) {
  const g = canvas.getContext('2d'), S = canvas.width, gap = .08;
  const total = paths.reduce((n, st) => n + lengthOf(st) + gap, 0);
  let t0 = null, raf = 0;
  const frame = ts => {
    t0 ??= ts;
    const at = (ts - t0) / 1000 * speed;
    let len = 0, rest = at;
    for (const st of paths) { const l = lengthOf(st); if (rest <= 0) break; len += Math.min(rest, l); rest -= l + gap; }
    g.clearRect(0, 0, S, S);
    drawOrder(g, paths, S, { len, width, color });
    if (at < total) raf = requestAnimationFrame(frame); else onDone?.();
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// Reihenfolge/Richtung der gezeichneten Striche gegen die Vorlage: Striche auf n Punkte umrechnen, mittlerer Abstand
// vorwärts/rückwärts. Absetzen mitten im Strich (Start nahe am letzten Ende) zählt nicht als neuer Strich.
function resample(st, n = 16) {
  const l = lengthOf(st);
  return Array.from({ length: n }, (_, i) => cut(st, l * i / (n - 1)).at(-1));
}
const meanDist = (a, b) => a.reduce((n, p, i) => n + dist(p, b[i]), 0) / a.length;
export function orderCheck(user, ref) {
  const merged = [];
  for (const st of user.filter(st => st.length > 1 && lengthOf(st) > .01))
    if (merged.length && dist(merged.at(-1).at(-1), st[0]) < .05) merged[merged.length - 1] = [...merged.at(-1), ...st];
    else merged.push([...st]);
  if (!merged.length) return null;
  const R = ref.map(st => resample(st)), U = merged.map(st => resample(st));
  const issues = [];
  if (U.length !== R.length) {
    issues.push(t(R.length === 1 ? 'Der Buchstabe hat {n} Strich, du hast {m} gezeichnet.' : 'Der Buchstabe hat {n} Striche, du hast {m} gezeichnet.', { n: R.length, m: U.length }));
    if (dist(U[0][0], R[0][0]) > .15) issues.push(t('Fang beim Punkt 1 an.'));
    return { ok: false, issues };
  }
  U.forEach((u, i) => {
    const fwd = R.map(r => meanDist(u, r)), rev = R.map(r => meanDist(u, [...r].reverse()));
    const best = R.map((_, j) => Math.min(fwd[j], rev[j])).reduce((b, d, j, a) => d < a[b] ? j : b, 0);
    if (best !== i) issues.push(t('Dein {i}. Strich gehört zu Strich {j} – Reihenfolge beachten.', { i: i + 1, j: best + 1 }));
    else if (rev[i] < fwd[i] * .7) issues.push(R.length > 1 ? t('Strich {i} andersherum schreiben (Start beim Punkt {i}).', { i: i + 1 }) : t('Andersherum schreiben: Start beim Punkt 1, der Pfeil zeigt die Richtung.'));
  });
  return { ok: !issues.length, issues };
}

// Pixel-Überlappung auf 128×128: Treffer = Anteil der Striche innerhalb der (verbreiterten) Vorlage,
// Abdeckung = Anteil der Vorlage, den die (verbreiterten) Striche überdecken; Wert = Produkt (fehlende Teile zählen voll)
function score(char, strokes, L) {
  const S = 128, tol = .04;
  const mask = draw => { const c = new OffscreenCanvas(S, S), g = c.getContext('2d'); g.fillStyle = g.strokeStyle = '#000'; draw(g); return g.getImageData(0, 0, S, S).data; };
  const T = mask(g => drawGlyph(g, char, S, L, 'fill'));
  const Td = mask(g => drawGlyph(g, char, S, L, 'fill', tol * 2));
  const U = mask(g => drawStrokes(g, strokes, S, L.pen));
  const Ud = mask(g => drawStrokes(g, strokes, S, L.pen + tol * 2));
  let u = 0, uIn = 0, tn = 0, tCov = 0;
  for (let i = 3; i < T.length; i += 4) {
    if (U[i] > 127) { u++; if (Td[i] > 127) uIn++; }
    if (T[i] > 127) { tn++; if (Ud[i] > 127) tCov++; }
  }
  const prec = u ? uIn / u : 0, rec = tn ? tCov / tn : 0;
  return { prec, rec, f: prec * rec };
}

// opts (Schritt in „Heute“): chars = Teilmenge der Buchstaben, onDone(res) nach dem freien Schreiben des letzten,
// res = { Buchstabe: bester Wert frei geschrieben }
export async function writing(L, el, { D, h, log }, { chars = null, onDone = null } = {}) {
  const letters = (chars ?? L.letters).map(c => D.alphabet.find(l => l.char === c)).filter(Boolean);
  try { await document.fonts.load(`100px ${FONT}`, letters.map(l => l.char).join('')); } catch {}
  metrics ??= measure(D.alphabet.map(l => l.char));
  const Lay = layout();

  let cur = letters[0], mode = 'trace', strokes = [], checked = false, peek = false, stopAnim = null;
  const res = {};
  const guide = h('canvas'), demo = h('canvas'), ink = h('canvas');
  const pad = h('div', { class: 'write-pad' }, guide, demo, ink);
  const order = () => D.strokes?.[cur.char] ?? null;
  const paths = () => order() && strokePaths(cur.char, order(), Lay);
  const side = h('div', { class: 'write-side' });
  const acts = h('div', { class: 'actionbar write-acts' });     // Löschen/Prüfen/Weiter direkt unter dem Feld (am Handy ohne Scrollen)
  const picker = h('div', { class: 'row letter-pick' });
  let S = 0;

  const drawGuide = () => {
    const g = guide.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, S, S);
    const line = (y, dash, label) => {
      g.strokeStyle = css('--muted'); g.globalAlpha = dash ? .45 : .8; g.lineWidth = Math.max(1, S / 300);
      g.setLineDash(dash ? [S / 60, S / 60] : []);
      g.beginPath(); g.moveTo(0, y * S); g.lineTo(S, y * S); g.stroke();
      g.globalAlpha = .8; g.setLineDash([]); g.fillStyle = css('--muted'); g.font = `${S / 30}px "Noto Sans", sans-serif`; g.textAlign = 'left';
      g.fillText(label, S / 80, y * S - S / 120);
    };
    line(Lay.asc, true, t('Oberlänge')); line(Lay.xh, true, t('Mittellinie')); line(Lay.base, false, t('Grundlinie')); line(Lay.desc, true, t('Unterlänge'));
    g.globalAlpha = 1;
    if (mode === 'trace' || checked || peek) {
      g.fillStyle = checked ? css('--ok') : css('--fg'); g.globalAlpha = checked ? .35 : .14;
      drawGlyph(g, cur.char, S, Lay, 'fill');
      g.globalAlpha = 1;
    }
    // beim Nachfahren: Startpunkte mit Nummer und Richtung (erstes Stück jedes Strichs)
    if (mode === 'trace' && !checked && order()) drawOrder(g, paths().map(st => cut(st, .07)), S, { color: css('--accent'), width: .028 });
  };
  const stop = () => { stopAnim?.(); stopAnim = null; demo.style.display = 'none'; };
  const play = () => {
    stop();
    if (!order() || !S) return;
    demo.style.display = '';
    stopAnim = animateOrder(demo, paths(), { color: css('--accent'), onDone: () => { stopAnim = () => clearTimeout(tm); const tm = setTimeout(stop, 900); } });
  };
  const drawInk = () => {
    const g = ink.getContext('2d');
    g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, S, S);
    g.strokeStyle = checked ? css('--bad') : css('--accent');
    drawStrokes(g, strokes, S, Lay.pen);
    if (checked) {   // Strichteile innerhalb der Vorlage (mit Toleranz) grün einfärben
      g.globalCompositeOperation = 'source-atop'; g.fillStyle = g.strokeStyle = css('--ok');
      drawGlyph(g, cur.char, S, Lay, 'fill', .1);
      g.globalCompositeOperation = 'source-over';
    }
  };
  const resize = () => {
    const px = Math.round(pad.clientWidth * devicePixelRatio);
    if (!px || px === S) return;
    S = guide.width = guide.height = demo.width = demo.height = ink.width = ink.height = px;
    drawGuide(); drawInk();
  };

  // Zeichnen mit Maus, Stift oder Finger
  let drawing = null;
  const pos = e => { const r = ink.getBoundingClientRect(); return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height]; };
  ink.addEventListener('pointerdown', e => {
    if (checked) return;
    e.preventDefault(); ink.setPointerCapture(e.pointerId);
    stop();
    drawing = [pos(e)]; strokes.push(drawing); drawInk();
  });
  ink.addEventListener('pointermove', e => {
    if (!drawing) return;
    const evs = e.getCoalescedEvents?.();
    for (const ev of evs?.length ? evs : [e]) drawing.push(pos(ev));
    drawInk();
  });
  const end = () => { drawing = null; };
  ink.addEventListener('pointerup', end); ink.addEventListener('pointercancel', end);

  const result = h('div');
  const check = () => {
    if (!strokes.length) return;
    checked = true;
    const r = score(cur.char, strokes, Lay);
    drawGuide(); drawInk();
    const p = Math.round(r.f * 100);
    const oc = order() && orderCheck(strokes, paths());
    fill(result,
      h('div', { class: 'write-score feedback ' + (p >= 70 ? 'ok' : p >= 45 ? '' : 'bad') }, `${p} %`),
      h('div', { class: 'small muted' }, t('Im Umriss: {a} % · Vorlage abgedeckt: {b} %', { a: Math.round(r.prec * 100), b: Math.round(r.rec * 100) })),
      h('div', { class: 'small' }, p >= 70 ? t('Gut getroffen!') : r.rec < .6 ? t('Teile der Form fehlen – Vorlage (grün) genau ansehen.') : t('Form stimmt grob; achte auf Lage zu den Linien (rot = außerhalb).')),
      oc ? h('div', { class: 'small feedback ' + (oc.ok ? 'ok' : '') }, h('b', {}, t('Strichfolge: ')), oc.ok ? t('Reihenfolge und Richtung stimmen ✓') : oc.issues.join(' '),
        oc.ok ? null : h('button', { class: 'btn', style: 'margin-left:6px', onclick: play }, t('▶ ansehen'))) : null);
    log({ lesson: L.id, ex: 'writing', item: cur.char, mode, score: +r.f.toFixed(3), ...(oc ? { order: oc.ok } : {}) });
    if (mode === 'free') res[cur.char] = Math.max(res[cur.char] ?? 0, +r.f.toFixed(3));
    renderSide();
  };
  const reset = () => { strokes = []; checked = false; peek = false; result.replaceChildren(); drawGuide(); drawInk(); renderSide(); };
  const select = (l, m = 'trace') => { const isNew = cur !== l; cur = l; mode = m; stop(); reset(); renderPicker(); if (isNew && m === 'trace') play(); };

  const renderPicker = () => picker.replaceChildren(...letters.map(l => h('button', { class: 'btn' + (l === cur ? ' on' : ''), onclick: () => select(l) }, l.char)));
  const renderSide = () => {
    const idx = letters.indexOf(cur), next = letters[(idx + 1) % letters.length];
    fill(side, 
      h('div', { class: 'row' }, h('button', { class: 'btn' + (mode === 'trace' ? ' primary' : ''), onclick: () => select(cur, 'trace') }, t('1 · Nachfahren')),
        h('button', { class: 'btn' + (mode === 'free' ? ' primary' : ''), onclick: () => select(cur, 'free') }, t('2 · Frei schreiben'))),
      h('p', {}, mode === 'trace' ? t('Fahre die graue Vorlage nach. Achte auf die Linien: Wo beginnt der Buchstabe, reicht er über die Mittellinie (Oberlänge) oder unter die Grundlinie (Unterlänge)?')
        : t('Schreib den Buchstaben ohne Vorlage. Danach wird die Vorlage grün darübergelegt: grüne Striche liegen im Umriss, rote daneben.')),
      h('div', { style: 'font-size:22px' }, mode === 'free' && !checked && !peek ? '' : h('span', { class: 'ka', style: 'font-size:40px' }, cur.char), ' ',
        h('b', {}, cur.translit), ' ', h('span', { class: 'ipa' }, cur.ipa)),
      cur.mnemonic ? h('div', { class: 'mnemonic small' }, h('b', {}, t('Merkhilfe: ')), cur.mnemonic) : null,
      order() ? h('div', { class: 'small', style: 'margin-top:8px' },
        h('button', { class: 'btn', onclick: play, title: t('Striche in Schreibreihenfolge zeigen') }, t('▶ Strichfolge')), ' ',
        order().reviewed ? h('span', { class: 'badge native', title: t('bestätigt von {user} am {date}', { user: order().reviewed.user, date: order().reviewed.date }) }, t('geprüft'))
          : order().verified ? null : h('span', { class: 'badge', title: t('Reihenfolge und Richtung nach der gemeinfreien Tabelle auf Wikimedia Commons (File:Mkhedruli.svg), Pfade von Claude nachgezeichnet – noch nicht von einer Muttersprachlerin bestätigt') }, t('ungeprüft')),
        order().notes ? h('div', { class: 'muted' }, order().notes) : null) : null);
    fill(acts,
      h('button', { class: 'btn', onclick: reset }, checked ? t('Nochmal') : t('Löschen')),
      !checked ? h('button', { class: 'btn primary', onclick: check }, mode === 'trace' ? t('Prüfen') : t('Vergleichen')) : null,
      mode === 'free' && !checked && !peek ? h('button', { class: 'btn', onclick: () => { peek = true; drawGuide(); renderSide(); } }, t('Vorlage zeigen')) : null,
      checked && mode === 'trace' ? h('button', { class: 'btn primary', onclick: () => select(cur, 'free') }, t('Jetzt frei →')) : null,
      checked && mode === 'free' ? (onDone && idx === letters.length - 1 ? h('button', { class: 'btn primary', onclick: () => onDone(res) }, t('Fertig ✓'))
        : h('button', { class: 'btn primary', onclick: () => select(next) }, t('Nächster: {c} →', { c: next.char }))) : null);
  };

  el.append(picker, h('div', { class: 'write-wrap' }, h('div', { class: 'write-col' }, pad, acts, result), side),
    h('p', { class: 'small muted' }, t('Mit Maus, Stift oder Finger schreiben. Georgisch kennt keine Großbuchstaben – die Größe ergibt sich nur aus Ober- und Unterlängen. Der Wert ist ein einfacher Pixel-Vergleich mit der Druckschrift; Handschrift darf abweichen.')));
  demo.style.display = 'none';
  renderPicker(); renderSide();
  new ResizeObserver(resize).observe(pad);
  resize();
  play();
  addEventListener('hashchange', stop, { once: true });
}
