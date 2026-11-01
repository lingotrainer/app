// Einstieg der statischen PWA (scripts/pages.mjs setzt ihn statt app.js in index.html): beim ersten Start Sprachen
// wählen (eine Ausgangssprache = Oberfläche, mehrere Zielsprachen), Hinweis „Installieren“, dann die App (app.js).
// In ⚙ kommen die Links „Sprachen & Lernstand“ (#/courses, views/courses.js) und „App installieren“ (#/install) dazu.
import { h, $app } from './util.js';
import { t } from './i18n.js';
import { catalog, selectedIds, setSelected, persist, sourcePicker, courseChecks, installHint, standalone } from './courses.js';

function welcome(cat) {
  return new Promise(done => {
    const nav = document.querySelector('header nav'), tools = document.querySelector('header .tools');
    for (const el of [nav, tools]) el?.style.setProperty('display', 'none');   // hidden überstimmt das CSS nicht
    let ids = selectedIds();
    const go = h('button', { class: 'btn primary', disabled: !ids.length, onclick: async () => {
      setSelected(ids);
      persist();   // Lernstand nicht nach Wochen vom Browser löschen lassen
      const start = hash => () => { for (const el of [nav, tools]) el?.style.removeProperty('display'); location.hash = hash; done(); };
      $app.replaceChildren(h('h1', {}, t('Fertig!')), h('div', { class: 'card' }, installHint()),
        h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: start('#/') }, t('Los geht’s')),
          h('button', { class: 'btn', onclick: start('#/install') }, t('📖 Anleitung: installieren, offline, sichern'))));
    } }, t('Weiter'));
    $app.replaceChildren(
      h('h1', {}, t('Sprachen wählen')),
      h('div', { class: 'card' }, h('label', { class: 'row' }, h('b', {}, t('Ich spreche')), ' ', sourcePicker(cat))),
      h('h2', {}, t('Ich lerne')),
      h('p', { class: 'muted small' }, t('Mehrere möglich; später in ⚙ änderbar.')),
      courseChecks(cat, ids, x => { ids = x; go.disabled = !ids.length; }),
      go);
  });
}

const cat = await catalog().catch(() => null);
if (!cat) $app.replaceChildren(h('p', {}, t('Kursliste nicht erreichbar – bitte mit Internetverbindung neu laden.')));
else {
  // Service Worker schon während der Sprachwahl (offline.js registriert ihn sonst erst mit app.js): Shell offline,
  // Chrome bietet „Installieren“ (beforeinstallprompt) erst mit Worker an
  navigator.serviceWorker?.register('sw.js', { scope: './' }).catch(() => {});
  if (!selectedIds().length) await welcome(cat);
  document.querySelector('.prefs-links')?.prepend(h('a', { href: '#/courses' }, t('🌍 Sprachen & Lernstand')), h('a', { href: '#/install' }, t('📲 App installieren')));
  installBanner();
  await import('./app.js');
}

// Dauerhafter Hinweis, solange die App nur im Browser-Tab läuft (nicht installiert): Installieren schützt auf dem iPhone
// vor dem Löschen des Speichers nach 7 Tagen ohne Besuch und macht die App offline nutzbar. „Später“ blendet ihn aus
// (localStorage, danach nur noch ⚙ → App installieren); ein Knopf erscheint, wo der Browser das Installieren anbietet.
function installBanner() {
  const KEY = 'pages.installHint';
  try { if (standalone() || localStorage.getItem(KEY)) return; } catch { if (standalone()) return; }
  const bar = h('div', { class: 'card install-banner' },
    h('p', {}, h('b', {}, t('Noch nicht als App installiert.')), ' ',
      t('Installiert bleibt dein Lernstand zuverlässig erhalten und die App funktioniert offline.')),
    installHint(),
    h('div', { class: 'row' },
      h('a', { class: 'btn', href: '#/install' }, t('📖 Anleitung: installieren, offline, sichern')),
      h('button', { class: 'btn', onclick: () => { try { localStorage.setItem(KEY, '1'); } catch {} bar.remove(); } }, t('Später'))));
  $app.before(bar);
}
