// #/about „Quellen & Lizenzen“ (P7 B7): GET /api/licenses (Server: app/licenses.mjs, statisch: courses/<id>/licenses.json).
// Zeigt nur, was data/sources.md und credits.json sagen: Quellen der Inhalte, jede echte Aufnahme mit Autor/Lizenz/Dateiseite,
// synthetische Audios (TTS) als Summe je Stimme, Schriften. Keine eigene Bewertung der Lizenzen.
import { h, $app, api, url } from '../util.js';
import { setLesson } from '../opts.js';
import { D, txt } from '../data.js';
import { t } from '../i18n.js';

// Markdown-Zelle aus sources.md: `code`, **fett**, [Text](https://…) – alles andere als Text
function cell(s) {
  const out = [];
  for (const m of s.matchAll(/`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\((https?:[^)\s]+)\)|([^`*[]+|[`*[])/g)) {
    if (m[1]) out.push(h('code', {}, m[1]));
    else if (m[2]) out.push(h('b', {}, m[2]));
    else if (m[3]) out.push(h('a', { href: m[4], target: '_blank', rel: 'noopener' }, m[3]));
    else out.push(m[5]);
  }
  return out;
}
const link = (href, text) => href ? h('a', { href, target: '_blank', rel: 'noopener' }, text) : text;

export async function viewAbout() {
  setLesson(null);
  $app.replaceChildren(h('h1', {}, t('Quellen & Lizenzen')), h('p', { class: 'muted' }, t('Lade …')));
  let x;
  try { x = await api('/api/licenses'); } catch (e) { x = null; }
  if (!x?.sources) return $app.replaceChildren(h('h1', {}, t('Quellen & Lizenzen')), h('p', { class: 'muted' }, t('Nicht abrufbar – bitte online öffnen.')));
  const word = f => { const id = f.replace(/^.*\//, '').replace(/\.\w+$/, ''); return D?.vocab?.find(v => v.id === id)?.ka ?? id; };
  const { recordings, tts, unknown } = x.audio, nTts = tts.reduce((a, b) => a + b.n, 0);

  $app.replaceChildren(
    h('h1', {}, t('Quellen & Lizenzen')),
    h('p', { class: 'muted' }, t('Wortschatz, Sätze und Aufnahmen stammen zum großen Teil aus freien Quellen. Hier steht für die aktuelle Sprache ({lang}), woher sie kommen und unter welcher Lizenz.', { lang: D?.lang?.name ? txt(D.lang.name) : x.lang })),

    h('h2', {}, t('Inhalte')),
    h('div', { class: 'card', style: 'overflow-x:auto' }, h('table', { class: 'small' },
      h('tr', {}, h('th', {}, t('Bereich')), h('th', {}, t('Quelle')), h('th', {}, t('Lizenz'))),
      x.sources.map(r => h('tr', {}, h('td', {}, cell(r.area)), h('td', {}, cell(r.source)), h('td', {}, cell(r.license)))))),

    h('h2', {}, t('Audio')),
    h('div', { class: 'card' },
      h('p', { style: 'margin-top:0' }, t('{n} echte Aufnahmen, {m} synthetische (Text-to-Speech).', { n: recordings.length, m: nTts })),
      tts.length ? h('div', {}, h('b', {}, t('Synthetisch')), h('ul', { class: 'small' }, tts.map(s => h('li', {},
        s.voice ? t('{source}, Stimme {voice}: {n} Dateien', { source: s.source, voice: s.voice, n: s.n }) : t('{source}: {n} Dateien', { source: s.source, n: s.n })))),
        h('p', { class: 'small muted' }, t('Computerstimme, keine Aufnahme eines Menschen; in der App mit „TTS“ gekennzeichnet.'))) : null,
      unknown ? h('p', { class: 'small muted' }, t('{n} Dateien ohne Herkunftsangabe.', { n: unknown })) : null,
      recordings.length ? h('details', {}, h('summary', {}, h('b', {}, t('Echte Aufnahmen ({n}) – je Datei Autor und Lizenz', { n: recordings.length }))),
        h('div', { style: 'overflow-x:auto' }, h('table', { class: 'small' },
          h('tr', {}, h('th', {}, t('Wort')), h('th', {}, t('Quelle')), h('th', {}, t('Autor')), h('th', {}, t('Lizenz'))),
          recordings.map(r => h('tr', {},
            h('td', {}, h('span', { class: 'ka' }, word(r.f))),
            h('td', {}, link(r.page, r.file?.replace(/^File:/, '') ?? r.source ?? '–'), r.source ? h('div', { class: 'muted' }, r.source) : null),
            h('td', { style: 'white-space:pre-line' }, r.author ?? '–'),
            h('td', {}, (r.license && r.licenseUrl ? link(r.licenseUrl, r.license) : r.license) ?? (r.page ? link(r.page, t('siehe Dateiseite')) : '–'))))))) : null),

    h('h2', {}, t('Schriften')),
    h('div', { class: 'card' }, x.fonts.map(f => h('p', { style: 'margin:0' }, `${f.name} – © ${f.by}, `, link(url(f.file), f.license)))),
  );
}
