// Lokale Ausspracheprüfung (wav2vec2 in WSL) und Aufnahme
import { h, api, log, toast, apiFetch } from './util.js';
import { t } from './i18n.js';
import { letterBy, LANG, txt } from './data.js';
import { showCompare } from './spectrogram.js';
import { net, onNet, ping, send } from './offline.js';
import { openMic, newRecorder, startRec, recordedBlob, playBlob, silentHint, enhance, blobLevel } from './mic.js';

// Gültige Aufnahme: mindestens so viele Sekunden mit Stimme (blobLevel), sonst nicht bewerten und nicht loggen
const MIN_VOICED = .15;
// Laut gilt im Log als schwach (→ Problemlaute) erst unter dieser Wahrscheinlichkeit (rot im UI beginnt bei .4)
const WEAK_P = .3;
const NOTHING = t('Nichts gehört – nochmal aufnehmen (näher ans Mikrofon, deutlich sprechen).');
const soundOf = l => l.sound?.replace(/.$/, '');

export const asrStatus = h('div', { class: 'small muted' });
let asrReady = false, asrPoll = null;
export async function ensureAsr() {
  if (asrReady) return;
  if (!LANG().asr) { asrStatus.textContent = t('Ausspracheprüfung gibt es für {name} noch nicht – Aufnahme und Spektrogramm gehen trotzdem.', { name: txt(LANG().name) }); return; }
  if (!net.online) { clearTimeout(asrPoll); asrStatus.textContent = t('📴 Offline – die Ausspracheprüfung braucht den Server und ist unterwegs nicht verfügbar. Aufnahme, Vergleich mit dem Original und Spektrogramm gehen trotzdem; die Aufnahme wird gespeichert und später hochgeladen.'); return; }
  let s = await api('/api/asr').catch(() => null);
  if (!s) { if (!await ping()) return ensureAsr(); s = {}; }   // Server weg → Offline-Hinweis statt „startet …“
  if (s.ready) { asrReady = true; asrStatus.textContent = t('🧠 Ausspracheprüfung bereit'); return; }
  if (!s.starting) await api('/api/asr/start', { method: 'POST' }).catch(() => {});
  asrStatus.textContent = s.error ? t('🧠 Ausspracheprüfung nicht verfügbar: {error}', { error: s.error }) : t('🧠 Ausspracheprüfung startet (Modell wird geladen, ~30 s) …');
  clearTimeout(asrPoll);
  if (!s.error) asrPoll = setTimeout(ensureAsr, 3000);
}
// Was die Aufnahme enthalten soll: Wort, bzw. bei Konsonanten die Silbe Konsonant + ა (wie im Hörbeispiel)
export const speakText = item => item.t ?? (item.type === 'vowel' ? item.char : item.char + 'ა');
function explain(l) {
  const lt = letterBy(l.char), b = letterBy(l.best);
  if (!lt || !b || l.best === l.char) return null;
  if (lt.type === 'ejective' && b.type === 'aspirated') return t('{a} klang behaucht wie {b} – Luft anhalten, ohne Hauch, hart „knacken“.', { a: l.char, b: b.char });
  if (lt.type === 'aspirated' && b.type === 'ejective') return t('{a} klang gepresst wie {b} – lockerer, mit Lufthauch wie im Deutschen.', { a: l.char, b: b.char });
  if (b.type === 'ejective' && lt.type !== 'ejective') return t('{a} klang wie {b} ({tr}).', { a: l.char, b: b.char, tr: b.translit });
  if (lt.type === 'voiced' && ['aspirated', 'ejective', 'fricative'].includes(b.type)) return t('{a} klang stimmlos wie {b} – Stimme dazunehmen (auch am Wortende!).', { a: l.char, b: b.char });
  if (lt.type === 'vowel') return t('Vokal {a} ({ta}) klang eher wie {b} ({tb}). {a} = {sa}', { a: l.char, ta: lt.translit, b: b.char, tb: b.translit, sa: soundOf(lt) }) +
    (b.type === 'vowel' ? t(' ({b} wäre {sb}).', { b: b.char, sb: soundOf(b) }) : '.');
  return t('{a} ({ta}) klang eher wie {b} ({tb}).', { a: l.char, ta: lt.translit, b: b.char, tb: b.translit });
}
onNet(n => n.online && asrStatus.isConnected && ensureAsr());
// → false, wenn der Server die Aufnahme als zu leise verwirft (dann auch nicht hochladen); 'unscored', wenn nicht geprüft
// wurde (offline / Dienst noch nicht bereit) – der Upload bittet den Server dann um die Prüfung
async function scoreRecording(item, blob, box) {
  if (!LANG().asr) return box.replaceChildren(asrStatus);
  if (!net.online) { box.replaceChildren(asrStatus); ensureAsr(); return 'unscored'; }
  if (!asrReady) { box.replaceChildren(asrStatus); ensureAsr(); return 'unscored'; }
  box.replaceChildren(h('span', { class: 'small muted' }, t('🧠 prüfe …')));
  try {
    const r = await apiFetch('/api/score?target=' + encodeURIComponent(speakText(item)), { method: 'POST', body: blob }).then(r => r.json());
    if (r.error === 'asr-stopped') { asrReady = false; box.replaceChildren(asrStatus); ensureAsr(); return 'unscored'; }   // Server hat sie im Leerlauf beendet
    if (r.error === 'zu leise') { box.replaceChildren(h('span', { class: 'small feedback bad' }, NOTHING)); return false; }
    if (r.error) throw new Error(r.error);
    const tips = r.letters.map(explain).filter(Boolean);
    const pct = Math.round(r.score * 100);
    const allGood = r.letters.every(l => l.p == null || l.p >= .7);
    // ein einzelner Vokal: ein CTC-Vergleich allein entscheidet zwischen 0 und 100 % → höchstens orange
    const lone = r.letters.length === 1 && letterBy(r.letters[0].char)?.type === 'vowel';
    const cls = p => p == null ? '' : p >= .7 ? 'ok' : p >= .4 || lone ? 'mid' : 'bad';
    box.replaceChildren(
      h('div', { class: 'row' }, h('b', {}, t('Aussprache: ')),
        h('span', { class: 'scoreword' }, r.letters.map(l => h('span', {
          class: 'sl ' + cls(l.p),
          title: l.p == null ? '' : `${Math.round(l.p * 100)} % ${l.char}` + (l.alts?.length ? t(' · sonst: ') + l.alts.map(a => `${a.char} ${Math.round(a.p * 100)} %`).join(', ') : ''),
        }, l.char))),
        h('span', { class: 'feedback ' + (allGood ? 'ok' : lone ? 'mid' : 'bad') }, `${pct} %`)),
      tips.length ? h('ul', { class: 'small', style: 'margin:4px 0' }, tips.map(tip => h('li', {}, tip))) : h('div', { class: 'small feedback ok' }, t('Alle Laute klar erkannt ✓')),
      h('div', { class: 'small muted' }, t('Erkannt: {heard} · grün sicher, orange unsicher, rot eher ein anderer Laut (Maus drüber für Details). ', { heard: r.heard || '–' }),
        t('Bei echten Muttersprachlern markiert die Prüfung ~5 % der Laute fälschlich rot – bei Zweifel Original anhören und Spektrogramm vergleichen.')));
    // weak nur bei erkanntem Text (leeres heard = nichts Verwertbares gehört), weakP parallel dazu (für die Gewichtung)
    const weak = r.heard ? r.letters.filter(l => l.p != null && l.p < WEAK_P) : [];
    log({ lesson: item.lesson, ex: 'asr', item: item.id, score: r.score, heard: r.heard, weak: weak.map(l => `${l.char}→${l.best}`), weakP: weak.map(l => l.p) });
  } catch (e) { box.replaceChildren(h('span', { class: 'small muted' }, t('Prüfung fehlgeschlagen: {msg}', { msg: e.message }))); }
}

// Aufnehmen (4 s) → Spektrogramm-Vergleich + lokale Ausspracheprüfung
export function recorder(item) {
  const box = h('span', { class: 'row' });
  let mr, mine, started = 0, cancel = false, opening = false;
  const btn = h('button', { class: 'btn icon', title: t('Aufnehmen') }, '🎙️');
  const mineBtn = h('button', { class: 'btn icon', title: t('Meine Aufnahme'), disabled: true, onclick: () => playBlob(mine).catch(e => toast(t('Wiedergabe fehlgeschlagen: {msg}', { msg: e.message }))) }, t('▶️ ich'));
  btn.onclick = async () => {
    // zweiter Klick gleich nach dem Start (< 0,5 s) = abbrechen statt stoppen und prüfen
    if (mr?.state === 'recording') { cancel = Date.now() - started < 500; return mr.stop(); }
    if (opening) return;                         // Mikrofon öffnet noch: kein zweiter Start
    opening = true;
    try {
      const stream = await openMic();
      const chunks = [];
      mr = newRecorder(stream);
      mr.ondataavailable = e => chunks.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach(tr => tr.stop());
        btn.textContent = '🎙️'; btn.classList.remove('rec');
        const blob = recordedBlob(mr, chunks);
        if (cancel) return toast(t('Aufnahme abgebrochen.'));
        const ts = new Date().toISOString(), level = await blobLevel(blob);
        mine = URL.createObjectURL(await enhance(blob));
        mineBtn.disabled = false;
        // zu wenig Stimme oder fast leer (stummes Mikrofon liefert ~100 Byte) → kein Spektrogramm, keine Prüfung, kein Upload;
        // sonst nicht dekodierbar (level null, z. B. Format) → Server entscheidet
        if (level ? level.voiced < MIN_VOICED : blob.size < 1000) return toast((level && await silentHint(blob, level)) || NOTHING, 6000);
        silentHint(blob, level).then(m => m && toast(m));
        const scoreBox = h('div', { style: 'margin:6px 0' });
        showCompare(item, mine, scoreBox, speakText(item)).catch(e => toast(t('Spektrogramm fehlgeschlagen: {msg}', { msg: e.message })));
        // Hochladen über den Offline-Puffer: ohne Server bleibt die Aufnahme auf dem Gerät und geht beim nächsten Kontakt raus
        // (Dateiname = Aufnahmezeit ts); nachträglich geprüft wird sie nicht, Coaches können sie trotzdem anhören (B4)
        const res = await scoreRecording(item, blob, scoreBox);
        if (res !== false) {
          const redo = res === 'unscored' && LANG().asr && item.id ? `&offline=1&target=${encodeURIComponent(speakText(item))}&lesson=${encodeURIComponent(item.lesson ?? '')}` : '';
          send(`/api/recording?id=${encodeURIComponent(item.id ?? item.translit)}&ts=${encodeURIComponent(ts)}${redo}`, { body: blob })
            .then(r => r === null && !net.online && toast(t('Aufnahme gespeichert – wird hochgeladen, sobald der Server erreichbar ist.')))
            .catch(() => toast(t('Aufnahme konnte nicht gespeichert werden.')));
        }
      };
      await startRec(mr);
      started = Date.now(); cancel = false;
      btn.textContent = '⏹️'; btn.classList.add('rec');
      const cur = mr;
      setTimeout(() => cur.state === 'recording' && cur.stop(), 4000);
    } catch { toast(t('Kein Mikrofonzugriff.')); }
    finally { opening = false; }
  };
  box.append(btn, mineBtn);
  return box;
}
