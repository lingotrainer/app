// Prüfseite (#/check) für Muttersprachler (Rolle editor): von Claude erzeugte, ungeprüfte Inhalte bestätigen,
// korrigieren oder als unsicher markieren. Daten: GET /api/check?learner=<id> (app/reviews.mjs, Warteschlange ab der
// aktuellen Lektion dieser/dieses Lernenden), #/check?learner=<id>&next=1 (Coach-Box): gleich gefiltert auf die nächsten
// Lektionen (Feld next = aktuelle + zwei, wie /api/coach/tasks), Urteil: POST /api/check
// {kind, id, verdict: ok|fix|unsure, ka?, de?, comment?}, Vorlesen: POST /api/check/record?kind=…&id=… (Audio-Blob, nur ka).
// Inhalte und Urteile der gewählten Lernsprache (Server: Cookie geo_lang, reviews.jsonl Feld lang); ka = Text in der Lernsprache.
// kind ui (nur ka): georgische Oberflächentexte (i18n/ka.json, de = deutscher Schlüssel, nicht änderbar), Lektionswahl „Oberfläche“ = @ui.
// kind data (nur ka): georgische Fassung von Datentexten (Sprachnamen, Stufen, Form-/Lautbeschreibungen, Kurstitel), wie ui.
// Prüfpaar (Kurs src → tgt): Auswahl „Kurs“, ?tgt=…&src=… an allen /api/check-Aufrufen (#/check?tgt=de&src=ka aus der
// Startseite, gewählt in localStorage check.pair); ka = Inhalt in tgt, de = Übersetzung in src. Nur bei src ≠ de:
// gloss (Claudes Bedeutungen, Wort nicht änderbar), lessontext/grammartext (Abschnitt der Übersetzung neben dem Original).
import { h, api, toast, hashQuery, url, apiFetch } from './util.js';
import { keyboard, setKeyHandler } from './keyboard.js';
import { D, isKa } from './data.js';
import { setLesson } from './opts.js';
import { strokePaths, animateOrder, drawOrder } from './writing.js';
import { openMic, newRecorder, startRec, recordedBlob, playBlob, silentHint, enhance } from './mic.js';
import { t, tx } from './i18n.js';

const KIND = { sentence: t('Satz'), dialog: t('Dialogzeile'), text: t('Lesetext-Zeile'), grammar: t('Grammatik-Beispiel'), vocab: t('Wort'), stroke: t('Strichfolge'), ui: t('Oberfläche'), data: t('Kursdaten'),
  gloss: t('Bedeutung'), lessontext: t('Lektionstext'), grammartext: t('Grammatiktext') };
const isUi = it => it?.kind === 'ui' || it?.kind === 'data';   // ohne Lektion, Deutsch nicht änderbar
const isText = it => it?.kind === 'lessontext' || it?.kind === 'grammartext';   // Abschnitt: Original nicht änderbar
const VERDICT = { ok: t('✓ bestätigt'), fix: t('✎ korrigiert'), unsure: t('? unsicher') };
const RECORDABLE = ['sentence', 'dialog', 'text'];    // nur ka (Aufnahmen über WSL nach data/audio)
const short = s => { const l = (s ?? '').split('\n')[0]; return l.length > 60 ? l.slice(0, 60) + '…' : l; };
const MAX_SECONDS = 10;
const NEXT = 3;                                   // „nächste Lektionen“ für Rest-Zähler und Filter
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem('check.' + k); localStorage.setItem('check.' + k, v); } catch {} };
const isDone = it => it.review && it.review.verdict !== 'unsure';
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter(k => k != null && k !== false));

export function viewCheck() {
  setLesson(null);
  const $app = document.getElementById('app');
  const q = hashQuery(), fromBox = q.has('next');
  let items = [], queue = [], pos = 0, editing = false, busy = false, showAll = false, lesson = fromBox ? '@next' : '', failed = null;
  let mr = null, blob = null, blobUrl = null, latinMap = false, showKbd = false;
  let meta = { order: [], current: null, learner: null, learners: [] }, autoplay = store('autoplay') === '1';
  // Prüfpaar: aus dem Link, sonst zuletzt gewählt, sonst Vorgabe des Servers (Lernsprache, Deutsch); Link mit Lernender/m
  // (Coach-Box „Für …“) ohne tgt = deren Kurs von Deutsch aus
  const parsePair = s => { const m = /^([a-z]{2,3})\/([a-z]{2,3})$/.exec(s ?? ''); return m ? { tgt: m[1], src: m[2] } : null; };
  let pair = q.get('tgt') ? { tgt: q.get('tgt'), src: q.get('src') ?? 'de' } : q.has('learner') ? null : parsePair(store('pair')), pairs = [], names = {};
  const pq = () => pair ? `tgt=${pair.tgt}&src=${pair.src}` : '';
  const nameOf = l => names[l] ? tx(names[l]) : l;
  const langName = () => nameOf(pair?.tgt ?? D.lang?.code), srcName = () => nameOf(pair?.src ?? 'de');
  const DE = () => (pair?.src ?? 'de') === 'de';
  const canRecord = it => isKa() && pair?.tgt === 'ka' && DE() && RECORDABLE.includes(it?.kind);

  const progress = h('div', { class: 'check-progress' });
  const stage = h('div', { class: 'card check-card' });
  const comment = h('input', { type: 'text', class: 'check-in', placeholder: t('Kommentar (optional) – z. B. „klingt steif“, „so sagt man eher …“') });
  const lessonSel = h('select', { class: 'check-in', style: 'width:auto;max-width:100%', onchange: e => { lesson = e.target.value; build(); } });
  const learnerSel = h('select', { class: 'check-in', style: 'width:auto;max-width:100%', onchange: e => { store('learner', e.target.value); load(e.target.value); } });
  const pairSel = h('select', { class: 'check-in', style: 'width:auto;max-width:100%', onchange: e => { pair = parsePair(e.target.value); store('pair', e.target.value); lesson = ''; load(store('learner')); } });
  const intro = h('div');

  // Lektionsabstand zur aktuellen Lektion der/des Lernenden (0 = aktuell, < 0 = schon gelernt, null = ohne Lektion)
  const dist = l => { const i = meta.order.indexOf(l), c = meta.order.indexOf(meta.current); return i < 0 || c < 0 ? null : i - c; };
  // „nächste Lektionen“ = die ersten NEXT Lektionen ab der aktuellen, in denen beim Laden noch etwas offen war
  // (A0 ist geprüft – sonst stünde für Lernende in A0 dort immer 0)
  let nextLs = [];
  const isNext = it => nextLs.includes(it.lesson);
  const learnerName = () => meta.learners.find(u => u.id === meta.learner)?.name ?? meta.learner;
  const span = ls => ls.length ? ls[0] + (ls.length > 1 ? '…' + ls.at(-1) : '') : '–';
  function distLabel(l) {
    const d = dist(l), who = learnerName();
    return d == null || !who ? null : d === 0 ? t('lernt {who} gerade', { who }) : d > 0 ? t(d === 1 ? 'für {who} in {d} Lektion' : 'für {who} in {d} Lektionen', { who, d }) : t('von {who} schon gelernt', { who });
  }

  // offene zuerst, dann „unsicher“; mit „alle zeigen“ auch bereits geprüfte
  const inLesson = it => !lesson || (lesson === '@next' ? isNext(it) : lesson === '@ui' ? isUi(it) : it.lesson === lesson);
  function build(keepId) {
    const pool = items.filter(inLesson);
    queue = showAll ? pool : [...pool.filter(it => !it.review), ...pool.filter(it => it.review?.verdict === 'unsure')];
    pos = Math.max(0, keepId ? queue.findIndex(it => it.kind + it.id === keepId) : 0);
    editing = false; discard(); render();
  }
  const cur = () => queue[pos];
  const go = d => { if (busy) return; pos = Math.min(Math.max(pos + d, 0), Math.max(queue.length - 1, 0)); editing = false; discard(); comment.value = ''; render(); auto(); };
  const play = () => cur()?.audio && new Audio(cur().audio).play().catch(() => toast(t('Audio nicht abspielbar')));
  const auto = () => autoplay && !editing && play();

  async function judge(verdict, change = {}) {
    const it = cur();
    if (!it || busy) return;
    busy = true;
    try {
      const r = await api('/api/check?' + pq(), { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: it.kind, id: it.id, verdict, comment: comment.value, ...change }) });
      if (r.error) throw new Error(r.error);
      it.review = r.review;
      toast(VERDICT[verdict] + ': ' + short(isText(it) ? it.de : it.ka));
      busy = false;
      comment.value = '';
      comment.blur();
      if (pos < queue.length - 1) go(1); else { editing = false; render(); }
    } catch (e) { busy = false; toast(t('Nicht gespeichert: ') + e.message); render(); }
  }

  // ---------- Vorlesen (wie #/record) ----------
  const discard = () => { if (blobUrl) URL.revokeObjectURL(blobUrl); blob = blobUrl = null; if (mr?.state === 'recording') mr.stop(); };
  async function record() {
    if (mr?.state === 'recording') return mr.stop();
    let stream;
    try { stream = await openMic(true); }
    catch { return toast(t('Kein Mikrofonzugriff.')); }
    discard();
    const chunks = [];
    mr = newRecorder(stream);
    mr.ondataavailable = e => chunks.push(e.data);
    mr.onstop = async () => {
      stream.getTracks().forEach(tr => tr.stop());
      blob = recordedBlob(mr, chunks);
      silentHint(blob).then(msg => msg && toast(msg));
      blobUrl = URL.createObjectURL(await enhance(blob));   // nur zum Anhören; hochgeladen wird das Original
      render();
      playBlob(blobUrl).catch(() => {});    // iOS blockiert das ohne Tipp ggf. – dann „▶️ Aufnahme“
    };
    await startRec(mr);
    render();
    setTimeout(() => mr?.state === 'recording' && mr.stop(), MAX_SECONDS * 1000);
  }
  async function keepRecording() {
    const it = cur();
    if (!blob || busy) return;
    busy = true; render();
    try {
      const r = await apiFetch(`/api/check/record?kind=${it.kind}&id=${encodeURIComponent(it.id)}`, { method: 'POST', body: blob }).then(r => r.json());
      if (r.error) throw new Error(r.error);
      it.audio = url('/audio/' + r.files[0]) + '?v=' + Date.now();
      toast(t('Aufnahme gespeichert'));
      discard();
    } catch (e) { toast(t('Aufnahme nicht gespeichert: ') + e.message); }
    busy = false; render();
  }

  // ---------- Anzeige ----------
  function contextOf(it) {
    return it.context.map(c => h('div', { class: 'small muted check-ctx' },
      c.where,
      c.prev ? h('div', {}, t('davor'), c.prev.speaker ? ` (${c.prev.speaker})` : '', ': ', h('span', { class: 'ka' }, c.prev.ka), ` – ${c.prev.de}`) : null,
      c.speaker ? h('div', {}, t('spricht: ') + c.speaker) : null,
      c.line ? h('div', { class: 'check-line' }, c.line) : null));
  }
  function reviewInfo(r) {
    if (!r) return null;
    return h('div', { class: 'small check-prev' }, h('b', {}, VERDICT[r.verdict]), t(' von {user} am {date}', { user: r.user, date: r.ts.slice(0, 10) }),
      r.ka ? h('div', {}, t('neu: '), h('span', { class: 'ka' }, r.ka)) : null, r.de ? h('div', { class: 'check-pre' }, t('neu: ') + r.de) : r.de === '' ? h('div', {}, t('neu: (gestrichen)')) : null,
      r.comment ? h('div', { class: 'muted' }, '„' + r.comment + '“') : null);
  }

  const kaIn = h('textarea', { class: 'check-in ka', rows: 2, lang: D.lang?.code ?? 'ka', spellcheck: 'false' });
  const deIn = h('input', { type: 'text', class: 'check-in' });
  const secIn = h('textarea', { class: 'check-in check-sec', rows: 10, spellcheck: 'false' });   // Abschnitt (lessontext/grammartext)
  // georgisches Feld für Bildschirmtastatur / lateinische Tasten: Inhalt (tgt ka) oder Übersetzung (src ka); Tastatur nur,
  // wenn die App gerade Georgisch lädt (D.alphabet, Lernsprache ka)
  const geoField = () => !isKa() ? null : pair?.tgt === 'ka' ? (cur()?.deOnly ? null : kaIn) : pair?.src === 'ka' ? (isText(cur()) ? secIn : deIn) : null;
  const insertText = (el, x) => { el.setRangeText(x, el.selectionStart, el.selectionEnd, 'end'); el.focus(); };
  function insert(ch) {
    const el = geoField();
    if (ch === 'Enter') return el === secIn ? insertText(el, '\n') : saveFix();
    if (!el) return;
    const s = el.selectionStart, e = el.selectionEnd;
    if (ch === 'Backspace') el.setRangeText('', s === e ? Math.max(0, s - 1) : s, e, 'end');
    else el.setRangeText(ch, s, e, 'end');
    el.focus();
  }
  let kbd = null;
  const newKbd = () => keyboard(insert, new Set(D.alphabet.map(l => l.char)));
  function saveFix() {
    const it = cur();
    if (isText(it)) {
      const de = secIn.value.replace(/\r\n/g, '\n').trim();
      return de === it.de.trim() ? toast(t('Nichts geändert – sonst bitte ✓ korrekt.')) : judge('fix', { de });
    }
    const ka = kaIn.value.trim(), de = deIn.value.trim();
    if (ka === it.ka.trim() && de === it.de.trim()) return toast(t('Nichts geändert – sonst bitte ✓ korrekt.'));
    judge('fix', isUi(it) ? { ka } : { ka, de });   // ui: Deutsch = Schlüssel, Rand-Leerzeichen setzt der Server; gloss: leer = streichen
  }
  // Hinweis je Prüfart (Text in der Zielsprache geprüft → nur Übersetzung)
  function hint(it) {
    const p = (...x) => h('p', { class: 'small muted' }, ...x);
    if (it.kind === 'gloss') return p(t('Das Wort ({lang}) ist geprüft (Wiktionary). Bitte nur die Bedeutung auf {src} prüfen – passt sie, ist sie üblich? Mehrere mit „ / “ trennen; ganz leeren = Bedeutung streichen.', { lang: langName(), src: srcName() }),
      it.have ? t(' Schon belegt: „{have}“.', { have: it.have }) : '');
    if (isText(it)) return p(t('Abschnitt der Erklärung auf {src} (rechts) neben dem Original ({orig}, links): Stimmt der Inhalt, ist der Text verständlich und natürlich? Beim Korrigieren den ganzen Abschnitt bearbeiten, Überschrift „## …“ und Tabellen-Striche | stehen lassen.', { src: srcName(), orig: nameOf(it.orig) }),
      it.head ? t(' Kopf: erste Zeile „# Titel“, darunter je Lernziel eine Zeile „- …“ (ohne Komma).') : '');
    if (it.deOnly) return p(DE() ? t('{lang} stammt aus Tatoeba (geprüft). Bitte nur die deutsche Übersetzung prüfen', { lang: langName() }) +
      (it.en ? t(' – englisch dort: „{en}“.', { en: it.en }) : '.') : t('Der Text auf {lang} ist geprüft. Bitte nur die Übersetzung auf {src} prüfen', { lang: langName(), src: srcName() }) +
      (it.en ? t(' – {alt}: „{en}“.', { alt: nameOf(it.alt), en: it.en }) : '.'));
    return !DE() && it.en ? p(t('{alt} zum Vergleich: „{en}“', { alt: nameOf(it.alt), en: it.en })) : null;
  }
  // Abschnitt: Original und Übersetzung nebeneinander (schmal untereinander)
  const textView = it => h('div', { class: 'check-cols' },
    h('div', {}, h('div', { class: 'small muted' }, t('Original ({lang})', { lang: nameOf(it.orig) })), h('div', { class: 'check-pre' }, it.ka || h('span', { class: 'muted' }, t('(an dieser Stelle nichts)')))),
    h('div', {}, h('div', { class: 'small muted' }, t('Übersetzung ({lang})', { lang: srcName() })), editing ? secIn : h('div', { class: 'check-pre', lang: pair?.src }, it.de)));

  function render() {
    // Zähler für die gewählte Lektion bzw. „nächste Lektionen“ (z. B. „3 von 22“), sonst für alles
    const pool = items.filter(inLesson);
    const open = pool.filter(it => !it.review).length, unsure = pool.filter(it => it.review?.verdict === 'unsure').length;
    const nDone = pool.filter(isDone).length;
    // Rest für die/den Lernende(n): offen ab der aktuellen Lektion, davon in den nächsten NEXT Lektionen
    const ahead = items.filter(it => !isDone(it) && (dist(it.lesson) ?? -1) >= 0), next = ahead.filter(isNext);
    fill(progress, h('div', {}, h('b', {}, t('{n} von {m} geprüft', { n: nDone, m: pool.length })), lesson ? ` (${lesson === '@next' ? span(nextLs) : lesson === '@ui' ? t('Oberfläche') : lesson})` : '', t(' · {n} offen', { n: open }) + (unsure ? t(' · {n} unsicher', { n: unsure }) : '')),
      meta.current && meta.learner ? h('div', { class: 'check-rest' }, h('b', {}, t('noch {n} für {who}: {span}', { n: next.length, who: learnerName(), span: span(nextLs) })),
        t(' (nächste Lektionen, {who} steht bei {cur}) · {n} ab {cur} insgesamt', { who: learnerName(), cur: meta.current, n: ahead.length })) : null,
      h('div', { class: 'check-bar' }, h('i', { style: `width:${pool.length ? 100 * nDone / pool.length : 0}%` })));
    const it = cur();
    stage.classList.toggle('wide', isText(it));   // Original + Übersetzung nebeneinander
    if (failed) return fill(stage, t('Fehler: {msg}', { msg: failed }));
    if (!it) return fill(stage, h('h2', {}, t('Alles geprüft 🎉')), h('p', { class: 'muted' }, 'Danke! / დიდი მადლობა!'));
    const recording = mr?.state === 'recording';
    fill(stage,
      h('div', { class: 'small muted' }, `${pos + 1} / ${queue.length} · ${it.lesson ?? '–'} · ${KIND[it.kind] ?? it.kind}` + (it.kind === 'ui' || isText(it) ? '' : ` · ${it.id}`),
        it.refs.length ? t(it.refs.length === 1 ? ' (+ {n} gleiche Stelle)' : ' (+ {n} gleiche Stellen)', { n: it.refs.length }) : '',
        distLabel(it.lesson) ? h('span', { class: 'check-dist' + (isNext(it) ? ' next' : '') }, distLabel(it.lesson)) : null),
      contextOf(it),
      isText(it) ? textView(it) : [
        editing ? null : h('div', { class: 'check-ka' + (pair?.tgt === 'ka' ? ' ka' : '') }, it.ka),
        it.kind === 'stroke' ? strokeView(it) : null,
        editing ? null : h('div', { class: 'check-de', lang: pair?.src }, it.de || h('span', { class: 'muted' }, DE() ? t('(keine deutsche Bedeutung angegeben)') : t('(keine Übersetzung auf {src} angegeben)', { src: srcName() })))],
      hint(it),
      it.kind === 'ui' ? h('p', { class: 'small muted' }, t('Text der App-Oberfläche: Passt die georgische Übersetzung zum deutschen Text? Knopftexte kurz halten, Platzhalter in {geschweiften Klammern} unverändert lassen.')) : null,
      it.kind === 'data' ? h('p', { class: 'small muted' }, t('Text aus den Kursdaten (Sprachname, Stufe, Formbezeichnung, Lautbeschreibung oder Kurstitel): Ist die georgische Fassung richtig und für Georgischsprachige verständlich? Lautbeschreibungen dürfen anders formuliert sein als die deutschen.')) : null,
      reviewInfo(it.review),
      editing ? [
        ...(isText(it) ? [] : [h('label', { class: 'small muted' }, langName(), it.deOnly ? (DE() && it.kind === 'sentence' ? t(' (aus Tatoeba, nicht änderbar)') : t(' (geprüft, nicht änderbar)')) : ''), kaIn]),
        !geoField() ? null : h('div', { class: 'row small' },
          h('label', {}, h('input', { type: 'checkbox', checked: latinMap, onchange: e => { latinMap = e.target.checked; geoField()?.focus(); } }), t(' lateinische Tasten → ქართული')),
          h('button', { class: 'btn', onclick: () => { showKbd = !showKbd; render(); } }, showKbd ? t('⌨ Tastatur ausblenden') : t('⌨ Bildschirmtastatur'))),
        showKbd && geoField() ? (kbd ??= newKbd()) : null,
        ...(isText(it) ? [] : [h('label', { class: 'small muted' }, isUi(it) ? t('Deutsch (Original, nicht änderbar)') : t('{src} (mehrere Bedeutungen mit „ / “ trennen)', { src: srcName() })), deIn]),
        comment,
        h('div', { class: 'row' },
          h('button', { class: 'btn primary', onclick: saveFix, disabled: busy }, t('💾 Korrektur speichern')),
          h('button', { class: 'btn', onclick: () => { editing = false; render(); } }, t('Abbrechen')),
          h('span', { class: 'small muted' }, t('Strg+Enter = speichern, Esc = abbrechen')))
      ] : [
        comment,
        h('div', { class: 'row check-btns' },
          h('button', { class: 'btn primary', onclick: () => judge('ok'), disabled: busy, title: t('Taste 1 oder Enter') }, t('✓ korrekt')),
          h('button', { class: 'btn', onclick: startEdit, disabled: busy, title: t('Taste 2 oder K') }, t('✎ korrigieren')),
          h('button', { class: 'btn', onclick: () => judge('unsure'), disabled: busy, title: t('Taste 3 oder U') }, t('? unsicher')),
          h('button', { class: 'btn', onclick: () => go(-1), disabled: busy || pos === 0, title: '←' }, '←'),
          h('button', { class: 'btn', onclick: () => go(1), disabled: busy || pos >= queue.length - 1, title: t('→ (ohne Urteil weiter)') }, '→')),
        h('div', { class: 'row check-btns' },
          it.audio ? h('button', { class: 'btn', onclick: play, title: t('Taste A oder Leertaste') }, t('🔊 anhören')) : h('span', { class: 'small muted' }, t('kein Audio')),
          canRecord(it) ? h('button', { class: 'btn' + (recording ? ' rec' : ''), onclick: record, disabled: busy, title: t('Taste R') },
            recording ? t('⏹️ Stopp') : blob ? t('🎙️ neu vorlesen') : t('🎙️ vorlesen')) : null,
          blob ? h('button', { class: 'btn', onclick: () => playBlob(blobUrl).catch(e => toast(t('Wiedergabe fehlgeschlagen: ') + e.message)) }, t('▶️ Aufnahme')) : null,
          blob ? h('button', { class: 'btn primary', onclick: keepRecording, disabled: busy }, t('💾 Aufnahme behalten')) : null,
          h('label', { class: 'small', title: t('Taste P') }, h('input', { type: 'checkbox', checked: autoplay, onchange: e => setAuto(e.target.checked) }), t(' automatisch abspielen'))),
        h('p', { class: 'small muted' }, t('Tasten: 1/Enter = korrekt · 2/K = korrigieren · 3/U = unsicher · ←/→ oder J/L blättern · A/Leertaste = anhören · ') +
          t('P = automatisch abspielen · ') + (canRecord(it) ? t('R = vorlesen · ') : '') + t('N = nur nächste Lektionen')),
      ]);
  }

  function setAuto(on) { autoplay = on; store('autoplay', on ? '1' : '0'); render(); if (on) play(); }
  // Strichfolge (data/strokes.json): Buchstabe mit nummerierten Strichen und Pfeilen, ▶ zeigt sie nacheinander
  function strokeView(it) {
    const L = { size: .62, base: .72 }, S = 440, paths = strokePaths(it.ka, it, L);
    const bg = h('canvas', { width: S, height: S }), fg = h('canvas', { width: S, height: S }), g = bg.getContext('2d');
    g.fillStyle = '#8886'; g.font = `${L.size * S}px "Noto Sans Georgian", "Sylfaen", sans-serif`; g.textAlign = 'center';
    g.fillText(it.ka, S / 2, L.base * S);
    drawOrder(fg.getContext('2d'), paths, S, { width: .02 });
    let stop = null;
    return h('div', { class: 'row', style: 'align-items:flex-end' }, h('div', { class: 'write-pad', style: 'width:220px' }, bg, fg),
      h('button', { class: 'btn', onclick: () => { stop?.(); stop = animateOrder(fg, paths, { width: .02 }); } }, t('▶ abspielen')),
      h('p', { class: 'small muted' }, t('Stimmen Reihenfolge (Nummern), Startpunkt und Richtung (Pfeile)? Sonst ✎ und im Kommentar beschreiben, wie man den Buchstaben schreibt.')));
  }

  function startEdit() {
    const it = cur();
    if (!it || busy) return;
    if (it.kind === 'stroke') return comment.value.trim() ? judge('fix') : (toast(t('Bitte im Kommentar beschreiben, was an der Strichfolge anders ist.')), comment.focus());
    editing = true;
    kaIn.value = it.review?.ka ?? it.ka;
    kaIn.readOnly = !!it.deOnly;
    deIn.readOnly = isUi(it);
    deIn.value = it.review?.de ?? it.de;
    secIn.value = it.review?.de ?? it.de;
    secIn.rows = Math.min(24, Math.max(4, secIn.value.split('\n').length + 2));
    render();
    (isText(it) ? secIn : it.deOnly ? deIn : kaIn).focus();
  }

  setKeyHandler(e => {
    if (e.altKey || e.metaKey) return;
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
    if (editing) {
      if (e.key === 'Escape') { e.preventDefault(); editing = false; render(); }
      else if (e.key === 'Enter' && e.ctrlKey) { e.preventDefault(); saveFix(); }
      else if (latinMap && geoField() && e.target === geoField() && !e.ctrlKey) (kbd ??= newKbd()).physical(e);
      return;
    }
    if (inField) { if (e.key === 'Enter' && e.target === comment) { e.preventDefault(); judge('ok'); } return; }
    if (e.ctrlKey) return;
    const k = e.key.toLowerCase();
    const act = { '1': () => judge('ok'), enter: () => judge('ok'), '2': startEdit, k: startEdit, '3': () => judge('unsure'), u: () => judge('unsure'),
      arrowleft: () => go(-1), arrowright: () => go(1), j: () => go(-1), l: () => go(1), a: play, ' ': play, p: () => setAuto(!autoplay),
      n: () => { lesson = lesson === '@next' ? '' : '@next'; lessonSel.value = lesson; build(); },
      r: () => canRecord(cur()) && record() }[k];
    if (act) { e.preventDefault(); act(); }
  });
  addEventListener('hashchange', discard, { once: true });

  fill($app,
    h('a', { href: '#/' }, t('← Übersicht')), h('h1', {}, t('Prüfen')),
    h('div', { class: 'row' }, h('span', { class: 'small' }, t('Kurs')), pairSel),
    intro,
    h('div', { class: 'row' }, h('span', { class: 'small' }, t('für')), learnerSel, h('span', { class: 'small' }, t('Lektion')), lessonSel,
      h('label', { class: 'small' }, h('input', { type: 'checkbox', onchange: e => { showAll = e.target.checked; build(cur() && cur().kind + cur().id); } }), t(' auch schon geprüfte zeigen'))),
    progress, stage);
  function intro_() {
    const kaHint = pair?.tgt === 'ka' ? 'გთხოვთ, შეამოწმოთ ქართული ტექსტი და გერმანული თარგმანი. ✓ = სწორია · ✎ = შესწორება · ? = არ ვარ დარწმუნებული'
      : pair?.src === 'ka' ? 'გთხოვთ, შეამოწმოთ ქართული თარგმანები და ახსნები. ✓ = სწორია · ✎ = შესწორება · ? = არ ვარ დარწმუნებული' : null;
    fill(intro, DE() ? h('p', {}, t('Diese Sätze, Dialogzeilen und Beispiele ({lang}) hat Claude erstellt; sie sind noch nicht von einem Menschen geprüft. ', { lang: langName() }) +
      t('Bitte prüfen: Ist der Text auf {lang} natürlich und richtig, und passt die deutsche Bedeutung? Kleine Unsicherheiten gern als Kommentar.', { lang: langName() }))
      : h('p', {}, t('Ausgangssprache {src}: Die Übersetzungen und Erklärungen auf {src} hat Claude erstellt; sie sind noch nicht von einem Menschen geprüft. ', { src: srcName() }) +
        t('Bitte prüfen: Stimmen Bedeutung und Übersetzung, ist der Text auf {src} natürlich und verständlich? Inhalte auf {lang} sind meist schon geprüft. Kleine Unsicherheiten gern als Kommentar.', { src: srcName(), lang: langName() })),
      kaHint ? h('p', { class: 'small muted', lang: 'ka', title: t('Hinweis auf Georgisch (von Claude formuliert)') }, kaHint) : null);
  }
  function load(learner) {
    stage.replaceChildren(h('span', { class: 'muted' }, t('lade …')));
    api('/api/check?' + [learner ? 'learner=' + encodeURIComponent(learner) : '', pq()].filter(Boolean).join('&')).then(r => {
      if (r.error) throw new Error(r.error);
      items = r.items; failed = null;
      pair = { tgt: r.lang, src: r.src ?? 'de' }; pairs = r.pairs ?? []; names = r.names ?? {};
      fill(pairSel, (pairs.length ? pairs : [{ ...pair, id: pair.src + '-' + pair.tgt }]).map(p => h('option', { value: p.tgt + '/' + p.src, selected: p.tgt === pair.tgt && p.src === pair.src },
        t('{lang} mit Übersetzung {src} (Kurs {id})', { lang: nameOf(p.tgt), src: nameOf(p.src), id: p.id }) + (p.draft ? t(' – im Aufbau') : ''))));
      intro_();
      meta = { order: r.order ?? [], current: r.current, learner: r.learner, learners: r.learners ?? [] };
      learnerSel.style.display = meta.learners.length || r.learner ? '' : 'none';
      learnerSel.previousSibling.textContent = meta.learners.length || r.learner ? t('für') : t('Reihenfolge des Kurses ·');
      fill(learnerSel, (meta.learners.length ? meta.learners : [{ id: r.learner, name: r.learner }]).map(u =>
        h('option', { value: u.id, selected: u.id === r.learner }, u.name + (u.role === 'editor' ? ' (editor)' : ''))));
      const lessons = meta.order.filter(l => items.some(it => it.lesson === l));
      const nOpen = l => items.filter(it => it.lesson === l && !isDone(it)).length, nUi = items.filter(it => isUi(it) && !isDone(it)).length;
      // aus der Coach-Box: genau die Lektionen, die dort gezählt wurden
      nextLs = fromBox && r.next ? r.next : meta.order.filter(l => (dist(l) ?? -1) >= 0 && nOpen(l)).slice(0, NEXT);
      if (lesson && lesson !== '@next' && lesson !== '@ui' && !lessons.includes(lesson)) lesson = '';
      fill(lessonSel, h('option', { value: '' }, meta.learner ? t('alle (zuerst {cur} = aktuelle Lektion von {who})', { cur: r.current ?? '–', who: learnerName() }) : t('alle (in der Reihenfolge des Kurses)')),
        h('option', { value: '@next' }, meta.learner ? t('nur die nächsten Lektionen von {who} ({span})', { who: learnerName(), span: span(nextLs) }) : t('nur die ersten offenen Lektionen ({span})', { span: span(nextLs) })),
        lessons.map(l => h('option', { value: l }, t('{l} ({n} offen)', { l, n: nOpen(l) }) + (dist(l) === 0 ? t(' ← aktuell') : ''))),
        nUi ? h('option', { value: '@ui' }, t('Oberfläche ({n} offen)', { n: nUi })) : null);
      lessonSel.value = lesson;
      build();
      auto();
    }).catch(e => { items = []; failed = e.message; render(); });
  }
  if (q.get('learner')) store('learner', q.get('learner'));
  load(store('learner'));
}
