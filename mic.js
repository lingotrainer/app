// Mikrofon + Aufnahme für Sprechen (asr.js), Prüfseite (check.js) und Aufnahme-Seite (record.js).
// iOS (alle Browser = WebKit): nimmt je nach Version webm oder mp4 auf, spielt webm im <audio> aber nicht zuverlässig ab →
// dort zuerst audio/mp4 (AAC). Rohes Mikrofon (ohne Echo-/Rauschunterdrückung, für saubere Muttersprachler-Aufnahmen)
// nur außerhalb von iOS – dort liefert es teils stumme/sehr leise Aufnahmen.
import { toast } from './util.js';
import { t } from './i18n.js';

export const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// iOS ≥ 16.4/17: Audio Session API. Nach getUserMedia bleibt die Sitzung sonst auf „Aufnahme + Wiedergabe“ und spielt
// über die leise Hörmuschel statt den Lautsprecher → vor dem Abspielen auf „playback“ zurückstellen.
const session = type => { try { if (navigator.audioSession) navigator.audioSession.type = type; } catch {} };

export const openMic = (raw = false) => {
  session('play-and-record');
  return navigator.mediaDevices.getUserMedia({
    audio: raw && !isIOS ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false } : true });
};

// Pegel einer Aufnahme: peak (0..1) und voiced = Sekunden mit Stimme (20-ms-Fenster mit RMS über −50 dBFS und
// mindestens 12 dB über dem Rauschboden = 15 %-Quantil – höchstens aber 15 dB unter dem lautesten Fenster, sonst zählt
// eine Aufnahme ganz ohne Pause nicht); null, wenn nicht dekodierbar. peak < ~0,02 = praktisch stumm
export async function blobLevel(blob) {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ac.decodeAudioData(await blob.arrayBuffer());
    ac.close?.();
    const x = buf.getChannelData(0), F = Math.round(buf.sampleRate / 50), nf = Math.floor(x.length / F), rms = [];
    let peak = 0;
    for (const v of x) { const a = Math.abs(v); if (a > peak) peak = a; }
    for (let f = 0; f < nf; f++) {
      let s = 0;
      for (let i = f * F; i < (f + 1) * F; i++) s += x[i] * x[i];
      rms.push(Math.sqrt(s / F));
    }
    const floor = [...rms].sort((a, b) => a - b)[Math.floor(nf * .15)] ?? 0;
    const thr = Math.max(10 ** (-50 / 20), Math.min(floor * 4, Math.max(0, ...rms) * .18));
    return { peak, voiced: rms.filter(r => r > thr).length * .02, duration: buf.duration };
  } catch { return null; }
}
export const blobPeak = async blob => (await blobLevel(blob))?.peak ?? null;
// Hinweis nach der Aufnahme: stumm oder nicht lesbar (Text für toast), sonst null
export async function silentHint(blob, level) {
  const p = level === undefined ? await blobPeak(blob) : level?.peak ?? null;
  if (p == null) return t('Aufnahme lässt sich hier nicht dekodieren ({type}, {size} Byte).', { type: blob.type || t('unbekanntes Format'), size: blob.size });
  if (p < .02) return t('Aufnahme ist praktisch stumm (Pegel {p} %) – Mikrofon prüfen (Einstellungen → Datenschutz → Mikrofon) oder näher heran.', { p: Math.round(p * 1000) / 10 });
  return null;
}

// iOS: das Umschalten der Audiositzung beim Mikrofonstart knackt hörbar → Aufnahme kurz danach beginnen
export async function startRec(mr) {
  if (isIOS) await new Promise(r => setTimeout(r, 250));
  mr.start();
}

// Format, das dieser Browser aufnehmen UND abspielen kann
const TYPES = isIOS ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'];
const probe = new Audio();
const recType = () => TYPES.find(ty => MediaRecorder.isTypeSupported?.(ty) && probe.canPlayType(ty.split(';')[0]));
export function newRecorder(stream) {
  const type = recType();
  // 128 kbit/s: iOS-AAC rauscht mit der niedrigen Standardrate hörbar
  return new MediaRecorder(stream, { audioBitsPerSecond: 128000, ...(type && { mimeType: type }) });
}
// Aufnahme fürs Anhören/Spektrogramm aufbereiten (iOS nimmt mit Sprachverarbeitung leise und verrauscht auf):
// Hochpass 80 Hz (Brummen, Griffgeräusche), Pausen um ~16 dB absenken (Rauschen zwischen den Wörtern; Sprache
// samt 30 ms davor/150 ms danach bleibt unberührt, damit Hauch und leise Anlaute nicht abgeschnitten werden),
// Spitze auf −1 dBFS anheben (höchstens +24 dB) → WAV. Hochgeladen wird weiter das Original (Server normalisiert selbst,
// Ausspracheprüfung bleibt bei den gemessenen Eingaben). Bei Fehler: Original.
export async function enhance(blob) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    const ac = new AC();
    const src = await ac.decodeAudioData(await blob.arrayBuffer());
    ac.close?.();
    const rate = src.sampleRate, n = src.length;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new OAC(1, n, rate);
    const node = off.createBufferSource(), hp = off.createBiquadFilter();
    node.buffer = src; hp.type = 'highpass'; hp.frequency.value = 80; hp.Q.value = .7;
    node.connect(hp).connect(off.destination); node.start();
    const x = (await off.startRendering()).getChannelData(0);
    // Rahmen à 10 ms: RMS → Rauschboden = 15 %-Quantil, Sprache = > 4× Boden (12 dB)
    const F = Math.round(rate / 100), nf = Math.ceil(n / F), rms = new Float32Array(nf);
    for (let f = 0; f < nf; f++) {
      let s = 0; const e = Math.min(n, (f + 1) * F);
      for (let i = f * F; i < e; i++) s += x[i] * x[i];
      rms[f] = Math.sqrt(s / Math.max(1, e - f * F));
    }
    const floor = [...rms].sort((a, b) => a - b)[Math.floor(nf * .15)] || 1e-6;
    const loud = Math.max(...rms);
    const gain = new Float32Array(nf).fill(1);
    if (loud > floor * 10) {                       // nur bei erkennbarem Abstand Sprache/Rauschen (> 20 dB)
      const open = new Uint8Array(nf);
      rms.forEach((r, f) => { if (r > floor * 4) for (let k = Math.max(0, f - 3); k <= Math.min(nf - 1, f + 15); k++) open[k] = 1; });
      for (let f = 0; f < nf; f++) gain[f] = open[f] ? 1 : .16;
      for (let f = 1; f < nf; f++) if (gain[f] < gain[f - 1]) gain[f] = Math.max(gain[f], gain[f - 1] * .8);   // langsam schließen
      for (let f = nf - 2; f >= 0; f--) if (gain[f] < gain[f + 1]) gain[f] = Math.max(gain[f], gain[f + 1] * .6); // rasch öffnen
    }
    let peak = 0;
    for (let i = 0; i < n; i++) {
      const f = i / F, f0 = Math.min(nf - 1, Math.floor(f)), f1 = Math.min(nf - 1, f0 + 1);
      x[i] *= gain[f0] + (gain[f1] - gain[f0]) * (f - f0);
      const a = Math.abs(x[i]); if (a > peak) peak = a;
    }
    const g = peak > 0 ? Math.min(16, .89 / peak) : 1;
    // WAV 16 bit mono
    const out = new DataView(new ArrayBuffer(44 + n * 2));
    const str = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
    str(0, 'RIFF'); out.setUint32(4, 36 + n * 2, true); str(8, 'WAVEfmt '); out.setUint32(16, 16, true);
    out.setUint16(20, 1, true); out.setUint16(22, 1, true); out.setUint32(24, rate, true); out.setUint32(28, rate * 2, true);
    out.setUint16(32, 2, true); out.setUint16(34, 16, true); str(36, 'data'); out.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) out.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x[i] * g)) * 32767, true);
    return new Blob([out.buffer], { type: 'audio/wav' });
  } catch { return blob; }
}

// Blob mit dem tatsächlichen Format (sonst spielt iOS ihn nicht ab)
// (aufgerufen in onstop, nach dem Stoppen der Spuren: Sitzung zurück auf Wiedergabe, auch fürs Original-Audio)
export function recordedBlob(mr, chunks) {
  session('playback');
  return new Blob(chunks, { type: mr.mimeType || chunks[0]?.type || 'audio/webm' });
}

// Wiedergabe über ein festes Element (wird nicht mitten im Abspielen weggeräumt; iOS: nach der Aufnahme neu laden)
const player = new Audio();
player.setAttribute('playsinline', '');
export function playBlob(url) {
  if (!url) return Promise.resolve();
  session('playback');
  // ohne Audio Session API (Chrome/Firefox auf iOS = eingebettetes WebKit, iOS < 17) bleibt iOS nach dem Mikrofon
  // auf der Hörmuschel – einmal pro Sitzung erklären
  if (isIOS && !navigator.audioSession && !sessionStorage.getItem('earpieceHint')) {
    try { sessionStorage.setItem('earpieceHint', '1'); } catch {}
    toast(t('iPhone spielt nach dem Aufnehmen leise über die Hörmuschel (ans Ohr halten oder Kopfhörer). Abhilfe: die App in Safari öffnen (ab iOS 17).'), 9000);
  }
  player.pause();
  player.src = url;
  player.load();
  return player.play();
}
