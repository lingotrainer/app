// Gemeinsam lernen: Coaches (Rolle editor, in users.json des Lernenden unter coaches freigegeben) sehen Statistik und
// Problemlaute ihrer Lernenden (#/stats/<id>, #/weak/<id>, nur lesen), filtern #/record/<id> nach deren Problemlauten
// und schicken Notizen (POST /api/notes?user=<id>), die beim Lernenden auf der Startseite erscheinen.
// Startseite oben: Box „Für <Lernende>“ mit Aufnehmen/Prüfen für deren nächste Lektionen (GET /api/coach/tasks?user=<id>)
// und neuen Aufnahmen der Lernenden zum Bewerten (#/listen-to/<id>, unten).
import { h, api, toast, url } from './util.js';
import { me } from './account.js';
import { isKa, D, vocabBy, letterBy, letterItem, translit, PARTNERS, gloss } from './data.js';
import { playBtn } from './audio.js';
import { speakText } from './asr.js';
import { t, tx, LOCALE } from './i18n.js';

export const learners = () => me?.learners ?? [];
export const learnerName = id => learners().find(l => l.id === id)?.name ?? id;
export const userQ = id => id ? '?user=' + encodeURIComponent(id) : '';
const when = ts => new Date(ts).toLocaleString(LOCALE, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Auswahl „Lernstand von: mir | <Lernende>“ → #/<route>[/<id>]; null, wenn niemand freigegeben hat
export function learnerPicker(route, cur) {
  if (!learners().length) return null;
  return h('label', { class: 'small' }, t('Lernstand von '),
    h('select', { onchange: e => location.hash = `#/${route}` + (e.target.value ? '/' + e.target.value : '') },
      h('option', { value: '' }, t('mir')), learners().map(l => h('option', { value: l.id, selected: l.id === cur }, l.name))));
}

// Notiz an Lernende(n) schreiben + eigene bisherige Notizen mit Gelesen-Status
export function noteForm(id) {
  const list = h('div', { class: 'small' });
  const text = h('textarea', { rows: 2, maxlength: 1000, placeholder: t('z. B. Hör dir ყ in ყავა an und sprich es langsam nach.'),
    style: 'width:100%;font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)' });
  const load = () => api('/api/notes' + userQ(id)).then(ns => list.replaceChildren(...(ns.error ? [ns.error] : ns.slice(0, 5).map(n =>
    h('div', {}, h('span', { class: 'muted' }, when(n.ts) + ' · '), n.text, ' ', h('span', { class: 'badge' + (n.read ? ' native' : '') }, n.read ? t('gelesen') : t('ungelesen'))))))).catch(e => list.replaceChildren(e.message));
  const sendNote = async () => {
    const r = await api('/api/notes' + userQ(id), { method: 'POST', body: JSON.stringify({ text: text.value }) }).catch(e => ({ error: e.message }));
    if (r.error) return toast(t('Nicht gesendet: ') + r.error);
    text.value = ''; toast(t('Notiz gesendet')); load();
  };
  load();
  return h('div', { class: 'card' }, h('b', {}, t('Notiz an {name}', { name: learnerName(id) })), text,
    h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: sendNote }, t('Senden')),
      h('span', { class: 'small muted' }, t('erscheint auf der Startseite'))), list);
}

// Startseite oben (Coaches): je Lernende(r) eine Karte „Für <Name>“ – Aufnehmen (~20 s/Eintrag) und Prüfen (~30 s/Eintrag)
// für deren aktuelle + nächste zwei Lektionen (Prüf-Vorlauf R10: ungeprüfte Sätze/Dialogzeilen vor Erreichen der Lektion
// sehen), mit einem Klick zur gefilterten Aufnahme- bzw. Prüfseite
const span = ls => ls.length ? ls[0] + (ls.length > 1 ? '…' + ls.at(-1) : '') : '–';
const mins = (n, sec) => t('~{n} min', { n: Math.max(1, Math.round(n * sec / 60)) });
export function coachTasks() {
  const review = reviewTasks();
  if (!learners().length) return review;
  return h('div', {}, learners().map(l => {
    const body = h('div', { class: 'small muted' }, t('lade …'));
    const task = (icon, text, of, href, label) => h('div', { class: 'row coach-task' },
      h('span', { style: 'flex:1;min-width:12em' }, icon, ' ', h('b', {}, text), h('br'), h('span', { class: 'small muted' }, of)),
      h('button', { class: 'btn primary', onclick: () => location.hash = href }, label));
    api('/api/coach/tasks' + userQ(l.id)).then(tk => {
      if (tk.error) return body.replaceChildren(tk.error);
      const r = tk.record ?? { open: 0, total: 0 }, c = tk.check, ls = span(tk.lessons);   // record: null = keine Aufnahme-Seite (nur ka)
      const what = [r.letters ? t(r.letters === 1 ? '{n} Buchstabe' : '{n} Buchstaben', { n: r.letters }) : '', r.words ? t(r.words === 1 ? '{n} Wort' : '{n} Wörter', { n: r.words }) : ''].filter(Boolean).join(' + ');
      body.replaceChildren(...[
        h('div', { class: 'small muted' }, t('{name} steht bei {cur}', { name: l.name, cur: tk.current })),
        r.open ? task('🎙️', t('{what} für {ls} aufnehmen ({min})', { what, ls, min: mins(r.open, 20) }), t('{n} von {m} aufgenommen', { n: r.total - r.open, m: r.total }), `#/record/${l.id}?next=1`, t('Aufnehmen')) : null,
        c.open ? task('✓', t('{what} für {ls} prüfen ({min})', { what: t(c.open === 1 ? '{n} Eintrag' : '{n} Einträge', { n: c.open }), ls, min: mins(c.open, 30) }), (c.lines ? t('davon {what} – die braucht {name} zuerst · ', { what: t(c.lines === 1 ? '{n} Satz/Dialogzeile' : '{n} Sätze/Dialogzeilen', { n: c.lines }), name: l.name }) : '') + t('{n} von {m} geprüft', { n: c.total - c.open, m: c.total }), `#/check?learner=${l.id}&next=1`, t('Prüfen')) : null,
        tk.listen ? task('🎧', t('{what} von {name} anhören ({min})', { what: t(tk.listen === 1 ? '{n} neue Aufnahme' : '{n} neue Aufnahmen', { n: tk.listen }), name: l.name, min: mins(tk.listen, 15) }),
          t('gut · fast · falsch – zählt mehr als die automatische Prüfung'), `#/listen-to/${l.id}`, t('Anhören')) : null,
        // I7/R12: seit ≥ 6 Tagen keine Chat-Lektion (lastChat in app/logstats.mjs) → gemeinsame vorschlagen
        tk.chat?.due ? h('div', { class: 'small' }, '💬 ', tk.chat.last ? t('Letzte Chat-Lektion vor {n} Tagen', { n: tk.chat.days }) : t('Noch keine Chat-Lektion'),
          t(' – diese Woche gemeinsam? In Claude '), h('code', {}, `/lektion ${l.id} ${me?.id ?? ''}${isKa() ? '' : ' ' + D.lang.code}`.replace(/\s+/g, ' ').trim())) : null,
        !r.open && !c.open ? h('p', {}, h('b', {}, t('Fertig für diese Lektionen ✓')), h('span', { class: 'small muted' }, t(' ({ls}) – danke!', { ls }))) : null,
        h('div', { class: 'small' }, h('a', { href: `#/stats/${l.id}` }, t('Statistik')), ...(isKa() ? [' · ', h('a', { href: `#/weak/${l.id}` }, t('Problemlaute')),
          ' · ', h('a', { href: `#/record/${l.id}` }, t('Aufnehmen nach Problemlauten'))] : []))].filter(Boolean));
    }).catch(e => body.replaceChildren(t('Fehler: {msg}', { msg: e.message })));
    return h('div', { class: 'card coach-box' }, h('h2', { style: 'margin:0 0 4px' }, t('Für {name}', { name: l.name })), body);
  }), review);
}

// Prüferin für Kurse anderer Ausgangssprachen (users.json → review, z. B. ka-de): je Kurs eine Zeile mit den offenen
// Prüfungen (GET /api/check/summary, reviews.mjs → courseCheck) und Link #/check?tgt=…&src=…; ohne review nichts
function reviewTasks() {
  if (me?.role !== 'editor') return '';
  const box = h('div');
  api('/api/check/summary').then(cs => {
    if (!Array.isArray(cs) || !cs.length) return;
    box.replaceChildren(h('div', { class: 'card coach-box' }, h('h2', { style: 'margin:0 0 4px' }, t('Prüfen')), ...cs.map(c =>
      h('div', { class: 'row coach-task' },
        h('span', { style: 'flex:1;min-width:12em' }, '✓ ', h('b', {}, t('Kurs {id}: {what}', { id: c.course, what: c.open ? t(c.open === 1 ? '{n} Eintrag offen' : '{n} Einträge offen', { n: c.open }) : t('alles geprüft') })),
          h('br'), h('span', { class: 'small muted' }, tx(c.title) + (c.open ? t(' · zuerst {ls} ({min})', { ls: span(c.next), min: mins(Math.min(c.open, 40), 30) }) : ''))),
        c.open ? h('button', { class: 'btn primary', onclick: () => location.hash = `#/check?tgt=${c.lang}&src=${c.src}` }, t('Prüfen')) : null))));
  }).catch(() => {});
  return box;
}

// Startseite (Lernende): neue eigene Aufnahmen (#/record) für die aktuelle Lektion, bis „✓“ (gesehene IDs in localStorage)
function newAudioLine(box) {
  if (!isKa()) return;
  const key = 'audioSeen.' + (me?.id ?? ''), store = v => { try { if (v === undefined) return JSON.parse(localStorage.getItem(key) ?? '[]'); localStorage.setItem(key, JSON.stringify(v)); } catch { return []; } };
  api('/api/audio/new').then(r => {
    const seen = new Set(store() ?? []), fresh = (r.items ?? []).filter(it => !seen.has(it.id) && it.author !== me?.name);
    if (!fresh.length) return;
    const by = Object.entries(fresh.reduce((g, it) => ((g[it.author ?? t('Jemand')] ??= []).push(it), g), {})).map(([a, xs]) => t('{name} hat {what}', { name: a, what: t(xs.length === 1 ? '{n} Aufnahme' : '{n} Aufnahmen', { n: xs.length }) })).join(', ');
    const line = h('div', { class: 'card row small' }, h('span', { style: 'flex:1' }, t('🎧 {by} für {lesson} gemacht – jetzt echte Stimmen statt Sprachsynthese. ', { by, lesson: r.lesson }),
      h('a', { href: `#/lesson/${r.lesson}` }, t('Anhören'))),
      h('button', { class: 'btn', onclick: () => { store([...seen, ...fresh.map(it => it.id)]); line.remove(); } }, '✓'));
    box.prepend(line);
  }).catch(() => {});
}

// Startseite: ungelesene Notizen an mich (mit „Gelesen“) und neue Aufnahmen für meine Lektion
export function homeBox() {
  const box = h('div'), audio = h('div');
  newAudioLine(audio);
  const render = notes => box.replaceChildren(...[audio, ...notes.filter(n => !n.read).map(n => h('div', { class: 'card' },
    h('div', { class: 'small muted' }, t('Notiz von {name} · {when}', { name: n.fromName, when: when(n.ts) })), h('p', {}, n.text),
    h('button', { class: 'btn', onclick: async () => { await api('/api/notes/read', { method: 'POST', body: JSON.stringify({ id: n.id }) }); n.read = true; render(notes); } }, t('✓ Gelesen'))))].filter(Boolean));
  render([]);
  api('/api/notes').then(ns => Array.isArray(ns) && render(ns)).catch(() => {});
  return box;
}

// ---------- Aufnahmen bewerten (B4): #/listen-to/<id> ----------
// Coach hört je Aufnahme Original 🔊 und Lernende ▶ und urteilt ✓ gut · ~ fast · ✗ falsch (Tasten 1/2/3); bei ✗ den Laut
// antippen (optional „klang wie“) und einen Satz schreiben → POST /api/ratings?user=<id> (app/ratings.mjs, ratings.jsonl).
export const VERDICT = { ok: t('✓ gut'), close: t('~ fast'), wrong: t('✗ falsch') };
const itemOf = id => vocabBy(id) ?? D.alphabet.map(l => letterItem(l)).find(l => l.id === id) ?? { id, t: id };
// Text eines Urteils für Lernende („<Coach>: ე klang wie ი – …“)
export function ratingText(r) {
  const what = r.verdict === 'ok' ? '✓' : r.sound ? (r.heardAs ? t('{s} klang wie {as}', { s: r.sound, as: r.heardAs }) : t('{s} nicht richtig', { s: r.sound })) : VERDICT[r.verdict];
  return `${r.byName ?? r.by}: ${what}${r.comment ? ' – ' + r.comment : ''}`;
}
export const ratingBadge = r => r && h('span', { class: 'badge rating ' + r.verdict, title: when(r.ts) }, ratingText(r));

export function viewRateRecordings(id, el) {
  if (!id || !learners().some(l => l.id === id)) return el.replaceChildren(h('h1', {}, t('Aufnahmen bewerten')),
    h('p', {}, learners().length ? t('Von wem? ') : t('Niemand hat dir Aufnahmen freigegeben.')),
    ...learners().map(l => h('a', { class: 'btn', href: `#/listen-to/${l.id}` }, l.name)));
  const name = learnerName(id), box = h('div'), counter = h('div', { class: 'small muted' });
  el.replaceChildren(h('h1', {}, t('Aufnahmen von {name}', { name })),
    h('p', { class: 'small muted' }, t('Original 🔊 und {name} ▶ anhören, dann urteilen: 1 = ✓ gut, 2 = ~ fast, 3 = ✗ falsch (dann Laut antippen). ', { name }),
      t('Dein Urteil zählt mehr als die automatische Prüfung und erscheint bei {name} im Tab Sprechen.', { name })), counter, box);
  let list = [], i = 0, detail = null, player = null, again = false;   // again: „Von vorn“ – auch bewertete durchgehen
  const comment = h('textarea', { rows: 2, maxlength: 500, placeholder: t('Ein Satz dazu (optional)'),
    style: 'width:100%;font:inherit;padding:6px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--fg)' });
  const onKey = e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('textarea,input')) { if (e.key === 'Enter' && !e.shiftKey && detail) { e.preventDefault(); detail.save(); } return; }
    if (e.key === '1') rate('ok'); else if (e.key === '2') rate('close'); else if (e.key === '3') rate('wrong');
    else if (e.key === ' ') { e.preventDefault(); player?.play().catch(() => {}); }
    else if (e.key === 'Enter' && detail) detail.save();
  };
  document.addEventListener('keydown', onKey);
  addEventListener('hashchange', () => { document.removeEventListener('keydown', onKey); player?.pause(); }, { once: true });

  async function save(r, body) {
    const res = await api('/api/ratings' + userQ(id), { method: 'POST', body: JSON.stringify({ file: r.file, ...body }) }).catch(e => ({ error: e.message }));
    if (res.error) return toast(t('Nicht gespeichert: ') + res.error);
    // weiter zur nächsten unbewerteten (bewertete stehen hinten), beim zweiten Durchgang zur nächsten
    r.rating = res.rating; i++;
    if (!again) { const j = list.findIndex((x, k) => k >= i && !x.rating); i = j < 0 ? list.length : j; }
    show(true);
  }
  function rate(verdict) {
    const r = list[i];
    if (!r || detail) return;
    if (verdict !== 'wrong') return save(r, { verdict, comment: comment.value });
    // ✗: Laut des Worts antippen, optional „klang wie“ (Verwechslungspartner wie in der Ausspracheprüfung), dann Speichern
    const word = [...new Set([...speakText(itemOf(r.item))].filter(c => letterBy(c)))];
    let sound = word.length === 1 ? word[0] : null, heardAs = null;
    const letters = h('div', { class: 'row' }), alts = h('div', { class: 'row' });
    const chip = (c, on, fn) => h('button', { class: 'btn ka rate-chip' + (on ? ' primary' : ''), onclick: fn }, c);
    const draw = () => {
      letters.replaceChildren(h('span', { class: 'small' }, t('Welcher Laut?')), ...word.map(c => chip(c, c === sound, () => { sound = c; heardAs = null; draw(); })));
      const ps = [...(PARTNERS[sound] ?? '')].filter(c => letterBy(c));
      alts.replaceChildren(...(ps.length ? [h('span', { class: 'small' }, t('klang wie (optional):')), ...ps.map(c => chip(c, c === heardAs, () => { heardAs = heardAs === c ? null : c; draw(); }))] : []));
    };
    draw();
    const el = h('div', { class: 'card', style: 'margin:8px 0' }, letters, alts,
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: () => detail?.save() }, t('Speichern (Enter)')),
        h('button', { class: 'btn', onclick: () => { el.remove(); detail = null; } }, t('Abbrechen'))));
    detail = { save: () => { detail = null; el.remove(); save(r, { verdict, sound, heardAs, comment: comment.value }); } };
    comment.before(el);
  }

  function show(autoplay) {
    detail = null; comment.value = ''; player?.pause();
    const open = list.filter(r => !r.rating).length;
    counter.textContent = list.length ? t('{i} von {n} · {open} noch ohne Urteil', { i: Math.min(i + 1, list.length), n: list.length, open }) : '';
    const r = list[i];
    if (!r) return box.replaceChildren(h('div', { class: 'card' }, h('p', {}, h('b', {}, list.length ? t('Alle angehört – danke! ✓') : t('Noch keine Aufnahmen von {name}.', { name }))),
      h('p', { class: 'small muted' }, t('{name} nimmt im Tab Sprechen auf (🎙️); neue Aufnahmen erscheinen hier und auf deiner Startseite.', { name })),
      h('div', { class: 'row' }, list.length ? h('button', { class: 'btn', onclick: () => { i = 0; again = true; show(); } }, t('Von vorn (Urteile ändern)')) : null,
        h('a', { class: 'btn', href: '#/' }, t('Startseite')))));
    const it = itemOf(r.item), text = speakText(it);
    player = new Audio(url(`/rec/${encodeURIComponent(r.file)}${userQ(id)}`));
    const asr = r.score == null ? t('ohne automatische Prüfung') : t('automatisch {p} %', { p: Math.round(r.score * 100) }) + (r.weak?.length ? ' (' + r.weak.join(', ') + ')' : '');
    const big = (label, v, key) => h('button', { class: 'btn rate-btn ' + v, onclick: () => rate(v), title: t('Taste {k}', { k: key }) }, label);
    box.replaceChildren(h('div', { class: 'card rate-card' },
      h('div', { class: 'row' }, h('span', { class: 'ka big' }, text), h('span', { class: 'tr' }, translit(text)),
        gloss(it).length ? h('span', { class: 'small muted' }, gloss(it).slice(0, 2).join(', ')) : null),
      h('div', { class: 'small muted' }, when(r.ts), ' · ', asr, r.rating ? h('span', {}, t(' · bisher '), ratingBadge(r.rating)) : null),
      h('div', { class: 'row', style: 'margin:10px 0' }, playBtn(it), h('span', { class: 'small' }, t('Original')),
        h('button', { class: 'btn primary', onclick: () => player.play().catch(e => toast(t('Wiedergabe fehlgeschlagen: ') + e.message)), title: t('Leertaste') }, `▶ ${name}`)),
      h('div', { class: 'rate-row' }, big(VERDICT.ok, 'ok', 1), big(VERDICT.close, 'close', 2), big(VERDICT.wrong, 'wrong', 3)),
      comment,
      h('div', { class: 'row small' }, i > 0 ? h('button', { class: 'btn', onclick: () => { i--; show(); } }, t('← zurück')) : null,
        h('button', { class: 'btn', onclick: () => { i++; show(); } }, t('überspringen →')))));
    if (autoplay) player.play().catch(() => {});
  }
  box.replaceChildren(h('p', { class: 'small muted' }, t('lade …')));
  api('/api/recordings' + userQ(id)).then(l => {
    if (l.error) return box.replaceChildren(h('p', {}, l.error));
    list = l; i = 0; again = !l.some(r => !r.rating); show();
  }).catch(e => box.replaceChildren(t('Fehler: {msg}', { msg: e.message })));
}
