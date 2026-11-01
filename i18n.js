// Oberflächentexte im gettext-Stil: der deutsche Text ist der Schlüssel, t('Wiederholen'), mit Platzhaltern
// t('{n} von {m} Dateien', { n, m }). Deutsch braucht keine Datei; i18n/<lang>.json = { "deutscher Text": "Übersetzung" },
// fehlende Einträge bleiben deutsch. npm run i18n meldet fehlende/verwaiste Einträge und noch nicht umgestellte Texte.
// Oberflächensprache = Ausgangssprache (statische PWA: localStorage ui.lang; Server: Ausgangssprache des aktuellen Kurses aus dem
// Cookie geo_ui, das server.mjs bei /api/me und beim Kurswechsel setzt – account.js lädt neu, falls es nicht passt; sonst Deutsch).
// Im Server-Modus übersteuert ein gesetztes localStorage ui.lang den Kurs für dieses Gerät (UI_FORCED, wie vor P7 C5; z. B.
// georgischsprachiger Coach im Kurs de-ka, Rauchtest ui-ka).
// Top-level await: Module, die t importieren, laufen erst, wenn das Wörterbuch geladen ist (auch Konstanten auf Modulebene).
import { textOf } from './core/model.js';

const device = (() => { try { return localStorage.getItem('ui.lang'); } catch { return null; } })();
const doc = globalThis.document;   // fehlt in Node (scripts/test-numbers.mjs lädt dieses Modul)
const isStatic = doc?.documentElement.dataset.mode === 'static';
export const UI_FORCED = !isStatic && !!device;
export const LOCALE = (isStatic || device ? device : doc?.cookie.match(/(?:^|;\s*)geo_ui=([a-z]{2,3})(?:;|$)/)?.[1]) || 'de';
const dict = LOCALE === 'de' ? {} : await fetch(`i18n/${LOCALE}.json`).then(r => r.ok ? r.json() : {}).catch(() => ({}));
if (LOCALE !== 'de') document.documentElement.lang = LOCALE;

export const t = (s, p) => {
  const r = dict[s] || s;
  return p ? r.replace(/\{(\w+)\}/g, (m, k) => p[k] ?? m) : r;
};

// Datentexte (Sprachnamen, Stufen, Formbezeichnungen, Lautbeschreibungen aus lang.json, Kurstitel): Zeichenkette (Deutsch)
// oder {<sprache>: …} in der Oberflächensprache, Rückfall Englisch → Deutsch. Mit geladenem Kurs gleichwertig: txt() aus data.js.
export const tx = x => textOf(x, [LOCALE, 'en', 'de']);

// feste Texte in index.html: data-t (Textinhalt) bzw. data-t-title (Attribut title)
export function translateDom(root = document) {
  if (LOCALE === 'de') return;
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.textContent.trim());
  for (const el of root.querySelectorAll('[data-t-title]')) el.title = t(el.title);
}
