// #/install „App installieren“ (P7 B6): Anleitung für Lernende – Android Chrome, iPhone Safari, Computer; was offline geht,
// wie man den Lernstand sichert. Statische PWA: Link in ⚙ und nach der Sprachwahl (pages-start.js); geht auch auf dem Server.
import { h, $app, STATIC } from '../util.js';
import { t } from '../i18n.js';
import { setLesson } from '../opts.js';
import { installHint, isIOS } from '../courses.js';
import { kaVoice } from '../audio.js';

const steps = (...xs) => h('ol', {}, xs.map(x => h('li', {}, x)));
const isAndroid = /Android/.test(navigator.userAgent);

// Wörter ohne mitgelieferte Aufnahme spricht das Gerät selbst (speechSynthesis, audio.js); ob und wie gut, hängt von den
// installierten Stimmen ab. Hier: Stand der Erkennung + wo man Stimmen nachlädt (Wortlaut der Systemmenüs variiert).
function voiceGuide() {
  const where = isIOS ? t('iPhone/iPad: Einstellungen → Bedienungshilfen → Gesprochene Inhalte → Stimmen → Sprache wählen und Stimme laden.')
    : isAndroid ? t('Android: Einstellungen → System → Sprachen → Sprachausgabe (Text-to-Speech) → Google Sprachdienste → Stimmdaten installieren.')
    : t('Computer: Windows: Einstellungen → Zeit und Sprache → Sprache → Sprachausgabe/Stimmen hinzufügen; Mac: Systemeinstellungen → Bedienungshilfen → Gesprochene Inhalte → Systemstimme → Stimmen verwalten.');
  return h('div', {},
    h('h2', {}, t('Sprachausgabe')),
    h('p', {}, t('Zu vielen Wörtern gibt es eine echte Aufnahme. Für den Rest spricht dein Gerät mit einer eigenen Stimme – es werden keine Audiodateien von uns geladen.')),
    h('p', { class: kaVoice ? '' : 'muted' }, kaVoice ? t('Für die Lernsprache wurde eine Stimme auf diesem Gerät gefunden ✓') : t('Für die Lernsprache wurde auf diesem Gerät keine Stimme gefunden.')),
    h('p', { class: 'muted' }, where),
    h('p', { class: 'small muted' }, t('Nicht für jede Sprache gibt es Stimmen (Georgisch fehlt auf vielen Geräten). Nach dem Installieren die Seite neu laden.')));
}

export function installGuide() {
  const platform = (open, title, ...body) => h('details', { class: 'card', open }, h('summary', {}, h('b', {}, title)), ...body);
  return [
    h('div', { class: 'card' }, installHint()),
    h('p', {}, t('Installiert startet die App wie jede andere vom Startbildschirm, ohne Browserleiste, und funktioniert auch ohne Internet.')),
    platform(isAndroid, t('Android (Chrome)'), steps(
      t('Diese Seite in Chrome öffnen.'),
      t('Oben rechts auf das Menü ⋮ tippen, dann „App installieren“ (oder „Zum Startbildschirm hinzufügen“).'),
      t('Bestätigen – das Symbol erscheint auf dem Startbildschirm.'))),
    platform(isIOS, t('iPhone/iPad (Safari)'), steps(
      t('Diese Seite in Safari öffnen.'),
      t('Auf „Teilen“ tippen (Quadrat mit Pfeil nach oben).'),
      t('„Zum Home-Bildschirm“ wählen, dann „Hinzufügen“.'))),
    platform(!isAndroid && !isIOS, t('Computer (Chrome, Edge, Safari)'), steps(
      t('Chrome/Edge: in der Adressleiste rechts auf das Symbol „App installieren“ klicken.'),
      t('Oder im Browsermenü: Chrome unter „Streamen, speichern und teilen“, Edge unter „Apps“.'),
      t('Safari auf dem Mac: Menü „Ablage“ → „Zum Dock hinzufügen“.'))),
    h('h2', {}, t('Was offline geht')),
    h('ul', {},
      h('li', {}, t('Nach dem ersten Laden gehen alle Übungen ohne Internet: Karteikarten, Quiz, Lesen, Hören, Statistik.')),
      h('li', {}, t('Audio wird beim Üben gespeichert; ohne Internet fehlt nur, was noch nicht geladen ist. Alles auf einmal: ⚙ → „🧳 Offline & unterwegs“.')),
      STATIC ? h('li', {}, t('Die automatische Ausspracheprüfung gibt es nur auf einem eigenen Server; Aufnehmen und mit dem Original vergleichen geht immer.')) : null),
    STATIC ? voiceGuide() : null,
    h('h2', {}, t('Lernstand sichern')),
    STATIC ? h('ul', {},
      h('li', {}, t('Dein Lernstand liegt nur in diesem Browser auf diesem Gerät – es gibt kein Konto und keinen Server.')),
      h('li', {}, t('Sichern: ⚙ → „🌍 Sprachen & Lernstand“ → „⬇️ Lernstand exportieren“. Die Datei gut aufbewahren (z. B. in deiner Cloud).')),
      h('li', {}, t('Neues Gerät oder Browserdaten gelöscht: dort „⬆️ Lernstand importieren“ wählen.')),
      h('li', {}, t('Browserdaten löschen oder die App deinstallieren löscht auch den Lernstand – vorher exportieren.')))
      : h('p', {}, t('Dein Lernstand liegt auf dem Server: Auf jedem Gerät, auf dem du angemeldet bist, ist er derselbe.')),
  ];
}

export function viewInstall() {
  setLesson(null);
  $app.replaceChildren(h('h1', {}, t('App installieren')), ...installGuide());
}
