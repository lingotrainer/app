// Aufnahme-Seite (#/record) für Muttersprachler: ersetzt TTS-Audio durch echte Aufnahmen.
// Liste: GET /api/record/list (alle Einträge mit TTS bzw. eigener Aufnahme), Speichern: POST /api/record?id=…&author=…
// #/record/<id> (Coach): nur Einträge mit den Problemlauten dieses Lernenden (GET /api/weak?user=<id>, coach.js)
// #/record[/<id>]?next=1 (Coach-Box „Für …“): nur aktuelle + nächste zwei Lektionen (GET /api/coach/tasks), Buchstaben zuerst
// replaceChildren ohne null/false (würde sonst als Text „null“ erscheinen)
const fill = (el, ...kids) => el.replaceChildren(...kids.filter(k => k != null && k !== false));
const MAX_SECONDS = 6;
const span = ls => ls.length ? ls[0] + (ls.length > 1 ? '…' + ls.at(-1) : '') : '–';

import { openMic, newRecorder, startRec, recordedBlob, playBlob, silentHint, enhance } from './mic.js';
import { t, LOCALE } from './i18n.js';

export function viewRecord($app, { h, toast, api, learner, picker, next }) {
  let items = [], idx = 0, showDone = false, blob = null, blobUrl = null, mr = null, busy = false;
  let weakChars = null, onlyWeak = !!learner && !next;    // Problemlaute des Lernenden (Set) bzw. null
  let nextLs = null, onlyNext = !!next;                   // Lektionen aus /api/coach/tasks bzw. null
  let author = '';
  try { author = localStorage.getItem('recordAuthor') ?? ''; } catch {}

  const nameIn = h('input', { type: 'text', value: author, placeholder: t('Name (für die Quellenangabe)'), style: 'font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg);min-width:220px',
    oninput: e => { author = e.target.value.trim(); try { localStorage.setItem('recordAuthor', author); } catch {} renderStage(); } });
  const progress = h('div', { class: 'small muted' });
  const stage = h('div', { class: 'card flash' });
  const list = h('div', { class: 'rec-list' });
  const level = h('i');
  const inNext = it => !onlyNext || !nextLs || nextLs.includes(it.lesson);
  const visible = () => items.filter(it => (showDone || !it.own) && inNext(it) && (!onlyWeak || !weakChars?.size || [...it.ka].some(c => weakChars.has(c))));
  const weakInfo = h('div', { class: 'small' }), nextInfo = h('div', { class: 'small' });

  const go = i => { idx = i; discard(); renderStage(); renderList(); };
  const discard = () => { if (blobUrl) URL.revokeObjectURL(blobUrl); blob = blobUrl = null; };
  const nextOpen = () => { const j = visible().findIndex((it, k) => k > idx && !it.own); return j >= 0 ? j : idx; };

  async function record() {
    if (mr?.state === 'recording') return mr.stop();
    let stream;
    try { stream = await openMic(true); }
    catch { return toast(t('Kein Mikrofonzugriff.')); }
    discard();
    const chunks = [];
    mr = newRecorder(stream);
    // Pegelanzeige
    const ac = new AudioContext(), an = ac.createAnalyser(), buf = new Float32Array(an.fftSize);
    ac.createMediaStreamSource(stream).connect(an);
    let raf;
    const meter = () => { an.getFloatTimeDomainData(buf); level.style.width = Math.min(100, 300 * Math.max(...buf.map(Math.abs))) + '%'; raf = requestAnimationFrame(meter); };
    meter();
    mr.ondataavailable = e => chunks.push(e.data);
    mr.onstop = async () => {
      cancelAnimationFrame(raf); level.style.width = '0'; ac.close();
      stream.getTracks().forEach(tr => tr.stop());
      blob = recordedBlob(mr, chunks);
      silentHint(blob).then(msg => msg && toast(msg));
      blobUrl = URL.createObjectURL(await enhance(blob));   // nur zum Anhören; hochgeladen wird das Original
      renderStage();
      playBlob(blobUrl).catch(() => {});
    };
    await startRec(mr);
    renderStage();
    setTimeout(() => mr?.state === 'recording' && mr.stop(), MAX_SECONDS * 1000);
  }

  async function keep() {
    const it = visible()[idx];
    if (!blob || !it || busy) return;
    if (!author) { nameIn.focus(); return toast(t('Bitte zuerst einen Namen eingeben.')); }
    busy = true; renderStage();
    try {
      const r = await fetch(`api/record?id=${encodeURIComponent(it.id)}&author=${encodeURIComponent(author)}`, { method: 'POST', body: blob }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      Object.assign(it, { own: true, kind: 'native', author: r.credit.author, v: Date.now() });
      toast(t('Gespeichert: {ka}', { ka: it.ka }));
      busy = false;
      go(showDone ? nextOpen() : Math.min(idx, visible().length - 1));
    } catch (e) { busy = false; toast(t('Speichern fehlgeschlagen: ') + e.message); renderStage(); }
  }

  function renderStage() {
    const v = visible(), it = v[idx];
    const base = items.filter(inNext), open = base.filter(x => !x.own).length;
    progress.textContent = t('{n} von {m} aufgenommen · {open} noch mit Sprachsynthese', { n: base.length - open, m: base.length, open }) + (onlyNext && nextLs ? ` (${span(nextLs)})` : '');
    if (!it) return stage.replaceChildren(h('h2', {}, t('Alles aufgenommen 🎉')), h('p', { class: 'muted' }, 'Danke! / მადლობა!'));
    const recording = mr?.state === 'recording';
    fill(stage, 
      h('div', { class: 'small muted' }, `${idx + 1} / ${v.length} · ${it.lesson} · ${it.id}`),
      h('div', { class: 'rec-word' }, it.ka),
      h('div', { class: 'muted' }, it.hint),
      it.own ? h('div', { class: 'small' }, h('span', { class: 'badge native' }, t('echt')), t(' aufgenommen von {name} ', { name: it.author }),
        h('button', { class: 'btn icon', title: t('Gespeicherte Aufnahme anhören'), onclick: () => new Audio(`audio/${it.id}.mp3?v=${it.v ?? 0}`).play() }, '🔊')) : null,
      h('div', { class: 'row', style: 'justify-content:center;margin-top:14px' },
        h('button', { class: 'btn primary' + (recording ? ' rec' : ''), onclick: record, disabled: busy }, recording ? t('⏹️ Stopp') : blob ? t('🎙️ Neu aufnehmen') : t('🎙️ Aufnehmen')),
        h('button', { class: 'btn', onclick: () => playBlob(blobUrl).catch(e => toast(t('Wiedergabe fehlgeschlagen: ') + e.message)), disabled: !blob || busy }, t('▶️ Anhören')),
        h('button', { class: 'btn primary', onclick: keep, disabled: !blob || busy || !author }, busy ? t('speichere …') : t('✓ Behalten')),
        h('button', { class: 'btn', onclick: () => go(Math.min(idx + 1, v.length - 1)), disabled: busy || idx >= v.length - 1 }, t('Überspringen →'))),
      h('div', { class: 'row', style: 'justify-content:center;margin-top:8px' }, h('div', { class: 'level' }, level)),
      h('p', { class: 'small muted' }, t('Tasten: Leertaste = Aufnahme starten/stoppen (max. {n} s), Enter = behalten, → = überspringen.', { n: MAX_SECONDS })),
      !author ? h('p', { class: 'small feedback bad' }, t('Zum Speichern oben einen Namen eingeben.')) : null);
  }

  function renderList() {
    const v = visible();
    list.replaceChildren(h('table', { class: 'words small' }, v.map((it, i) => h('tr', { class: i === idx ? 'cur' : '', onclick: () => go(i) },
      h('td', { class: 'ka', style: 'font-size:20px' }, it.ka), h('td', {}, it.hint), h('td', {}, it.lesson),
      h('td', {}, it.own ? h('span', { class: 'badge native' }, t('echt')) : h('span', { class: 'badge' }, 'TTS'))))));
    list.querySelector('tr.cur')?.scrollIntoView({ block: 'nearest' });
  }

  const onKey = e => {
    if (e.target === nameIn || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); record(); }
    else if (e.key === 'Enter') { e.preventDefault(); keep(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.min(idx + 1, visible().length - 1)); }
  };
  document.addEventListener('keydown', onKey);
  addEventListener('hashchange', () => { document.removeEventListener('keydown', onKey); if (mr?.state === 'recording') mr.stop(); }, { once: true });

  $app.replaceChildren(
    h('a', { href: '#/' }, t('← Übersicht')), h('h1', {}, t('Aufnahmen für Muttersprachler')),
    h('p', {}, t('Für diese Wörter und Silben gibt es bisher nur Sprachsynthese. Bitte jedes Wort einmal deutlich und natürlich sprechen, wie zu einem Lernenden. Bei Buchstaben die Silbe sprechen (z. B. კა).')),
    LOCALE !== 'de' ? null : h('p', { class: 'small muted' }, 'For these words and syllables we only have synthetic speech. Please read each word once, clearly and naturally. Recordings are stored locally and used only in this private learning app.'),
    h('div', { class: 'row' }, nameIn,
      h('label', { class: 'small' }, h('input', { type: 'checkbox', onchange: e => { showDone = e.target.checked; idx = 0; discard(); renderStage(); renderList(); } }), t(' auch schon aufgenommene zeigen'))),
    picker ? h('div', { class: 'row' }, picker, weakInfo) : '', next ? nextInfo : '',
    progress, stage, h('h2', {}, t('Liste')), list);
  stage.replaceChildren(h('span', { class: 'muted' }, t('lade …')));
  const userQ = learner ? '?user=' + encodeURIComponent(learner) : '';
  Promise.all([api('/api/record/list'), learner && !next ? api('/api/weak' + userQ) : null, next ? api('/api/coach/tasks' + userQ) : null]).then(([r, weak, tasks]) => {
    items = r;
    if (tasks?.error) nextInfo.textContent = tasks.error;
    else if (tasks) {
      nextLs = tasks.lessons;
      // nächste Lektionen nach vorn, dort nach Lektion und Buchstaben vor Wörtern
      const rank = it => nextLs.includes(it.lesson) ? nextLs.indexOf(it.lesson) * 2 + (it.id.startsWith('letter-') ? 0 : 1) : 99;
      items = items.map((it, n) => ({ it, n })).sort((a, b) => rank(a.it) - rank(b.it) || a.n - b.n).map(x => x.it);
      nextInfo.replaceChildren(h('label', {}, h('input', { type: 'checkbox', checked: onlyNext, onchange: e => { onlyNext = e.target.checked; idx = 0; discard(); renderStage(); renderList(); } }),
        t(' nur die nächsten Lektionen ({span}, aktuell {cur})', { span: span(nextLs), cur: tasks.current })));
    }
    if (weak?.error) weakInfo.textContent = weak.error;
    else if (weak) {
      weakChars = new Set(weak.map(w => w.char));
      weakInfo.replaceChildren(h('label', {}, h('input', { type: 'checkbox', checked: onlyWeak, onchange: e => { onlyWeak = e.target.checked; idx = 0; discard(); renderStage(); renderList(); } }),
        t(' nur Problemlaute: ')), weakChars.size ? h('span', { class: 'ka', style: 'font-size:20px' }, [...weakChars].join(' ')) : h('span', { class: 'muted' }, t('keine erkannt')));
    }
    renderStage(); renderList();
  }).catch(e => stage.replaceChildren(t('Fehler: {msg}', { msg: e.message })));
}
