// #/courses (statische PWA, P7 B3/B4): Ausgangssprache, Zielsprachen wählen/wechseln/entfernen, Lernstand
// exportieren/importieren/löschen, Speicher dauerhaft, Installieren. Auf dem eigenen Server nur ein Hinweis.
import { h, $app, toast, STATIC } from '../util.js';
import { t, tx, LOCALE } from '../i18n.js';
import { setLesson } from '../opts.js';
import { catalog, selectedIds, setSelected, currentId, setCurrent, dropCache, persist, persisted, sourcePicker, courseChecks, installHint } from '../courses.js';

export async function viewCourses() {
  setLesson(null);
  if (!STATIC) return $app.replaceChildren(h('h1', {}, t('Sprachen & Lernstand')),
    h('p', { class: 'muted' }, t('Nur in der App ohne Server; hier wählst du die Sprache in der Kopfzeile.')));
  const local = await import('../backend-local.js');
  const cat = await catalog();
  const cur = currentId(), nameOf = id => tx(cat.courses.find(c => c.id === id)?.lang.name) || id;
  const reload = () => { location.hash = '#/'; location.reload(); };

  // ---- Zielsprachen: hinzufügen sofort, entfernen mit Rückfrage (Cache weg, Lernstand bleibt) ----
  const list = () => courseChecks(cat, selectedIds(), async ids => {
    const before = selectedIds(), gone = before.filter(id => !ids.includes(id));
    if (!ids.length) { toast(t('Mindestens eine Sprache bleibt gewählt')); return view(); }
    if (gone.length && !confirm(t('{names} entfernen? Heruntergeladene Daten und Audio werden gelöscht, der Lernstand bleibt.', { names: gone.map(nameOf).join(', ') }))) return view();
    setSelected(ids);
    for (const id of gone) await dropCache(id).catch(() => {});
    if (!ids.includes(cur)) return reload();
    view();
  });
  const switcher = () => selectedIds().length > 1 ? h('div', { class: 'row' }, selectedIds().map(id =>
    id === cur ? h('button', { class: 'btn primary', disabled: true, 'aria-current': 'true' }, nameOf(id))
      : h('button', { class: 'btn', onclick: () => { dispatchEvent(new Event('geo-lang')); setCurrent(id); reload(); } }, nameOf(id)))) : null;

  // ---- Lernstand ----
  const file = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: async e => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const done = await local.importAll(JSON.parse(await f.text()));
      if (!done.length) return toast(t('Keine passenden Kurse in der Datei'));
      setSelected([...new Set([...selectedIds(), ...done.map(d => d.id).filter(id => id.startsWith(LOCALE + '-'))])]);
      toast(t('Lernstand übernommen: {list}', { list: done.map(d => `${nameOf(d.id)} (${t('{n} Karten', { n: d.cards })})`).join(', ') }), 4000);
      setTimeout(reload, 1500);
    } catch (err) { toast(t('Import fehlgeschlagen: {msg}', { msg: err.message }), 4000); }
  } });
  const exportBtn = h('button', { class: 'btn', onclick: async () => {
    const x = await local.exportAll(), a = h('a', { href: URL.createObjectURL(new Blob([JSON.stringify(x)], { type: 'application/json' })),
      download: `lernstand-${new Date().toISOString().slice(0, 10)}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } }, t('⬇️ Lernstand exportieren'));
  const clearBtn = h('button', { class: 'btn', onclick: async () => {
    if (!confirm(t('Lernstand für {name} wirklich löschen? Das lässt sich nicht rückgängig machen (vorher exportieren).', { name: nameOf(cur) }))) return;
    await local.clearProgress(cur);
    try { localStorage.removeItem('today.plan'); } catch {}
    reload();
  } }, t('Lernstand {name} löschen', { name: nameOf(cur) }));

  // ---- Speicher ----
  const store = h('p', { class: 'small muted' }, '…');
  const showStore = async () => {
    const [p, est] = await Promise.all([persisted(), navigator.storage?.estimate?.().catch(() => null)]);
    store.replaceChildren(p ? t('Speicher dauerhaft ✓') : p === null ? t('Dieser Browser kennt keinen dauerhaften Speicher – Lernstand regelmäßig exportieren.')
      : h('span', {}, t('Der Browser darf den Speicher bei Platzmangel löschen.'), ' ',
        h('button', { class: 'btn', onclick: async () => { await persist(); showStore(); } }, t('Dauerhaft anfragen'))),
      est ? ' · ' + t('belegt: {mb} MB', { mb: (est.usage / 1048576).toFixed(1) }) : '');
  };

  function view() {
    $app.replaceChildren(h('h1', {}, t('Sprachen & Lernstand')),
      h('div', { class: 'card' }, h('label', { class: 'row' }, h('b', {}, t('Ich spreche')), ' ', sourcePicker(cat)),
        h('p', { class: 'small muted' }, t('= Sprache der Oberfläche; die Seite lädt danach neu.'))),
      h('h2', {}, t('Ich lerne')),
      selectedIds().length > 1 ? h('div', { class: 'card' }, h('p', { class: 'small muted', style: 'margin-top:0' }, t('Aktuelle Sprache:')), switcher()) : '',
      list(),
      h('h2', {}, t('Lernstand')),
      h('div', { class: 'card' },
        h('p', { class: 'small muted', style: 'margin-top:0' }, t('Der Lernstand liegt nur in diesem Browser. Als Datei sichern oder auf ein anderes Gerät übertragen (gleiches Format wie der eigene Server).')),
        h('div', { class: 'row' }, exportBtn, h('button', { class: 'btn', onclick: () => file.click() }, t('⬆️ Lernstand importieren')), file),
        h('div', { class: 'row', style: 'margin-top:.5em' }, clearBtn), store),
      h('h2', {}, t('Installieren')),
      h('div', { class: 'card' }, installHint()));
    showStore();
  }
  view();
}
