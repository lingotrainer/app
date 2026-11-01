// Allgemeine Hilfen: DOM-Bau, Zufall, Toast, API, Mini-Markdown.
import { t } from './i18n.js';

export const MIN = 60e3, DAY = 864e5;
export const $app = document.getElementById('app');

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}
export const shuffle = a => { a = [...a]; for (let i = a.length - 1; i > 0; i--) { const j = Math.random() * (i + 1) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const pick = a => a[Math.random() * a.length | 0];
export function toast(msg, ms = 2200) { const el = document.getElementById('toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), ms); }
// 401 = kein Benutzer gewählt → Auswahlseite (bei AUTH=off nie)
// Parameter hinter dem Hash-Pfad, z. B. #/check?learner=<id>&next=1
export const hashQuery = () => new URLSearchParams(location.hash.split('?')[1] ?? '');
// Offline und nicht im Cache (sw.js → X-Offline) = Fehler, damit Aufrufer ihren .catch-Ersatz nehmen statt {error} zu verarbeiten
// Pfade relativ zur Seite: auf dem eigenen Server liegt die App unter /, auf GitHub Pages unter /<repo>/.
// Aufrufer schreiben weiter '/api/…' (zugleich Routenname); erst beim Abruf wird der führende / entfernt.
export const url = p => p.startsWith('/') ? p.slice(1) : p;
// Alle /api-Abrufe laufen hierüber. Schalter BACKEND:
//   'remote' = Server über fetch; Basis-URL REMOTE_BASE (Standard: gleiche Herkunft wie die Seite, localStorage backend.url
//              für später „PWA mit beliebigem Server verbinden“, P7 D3 – fremde Herkunft braucht dort noch CORS/Cookies)
//   'local'  = statische PWA ohne Server (scripts/pages.mjs setzt <html data-mode="static">): dieselben Routen im
//              Browser (backend-local.js, Response-Objekte wie fetch, Lernstand in IndexedDB)
export const BACKEND = document.documentElement.dataset.mode === 'static' ? 'local' : 'remote';
export const STATIC = BACKEND === 'local';
export const REMOTE_BASE = (() => { try { return localStorage.getItem('backend.url') || ''; } catch { return ''; } })();
const remote = (p, o) => fetch(REMOTE_BASE ? new URL(url(p), REMOTE_BASE.replace(/\/?$/, '/')) : url(p), o);
let fetcher = STATIC ? (p, o) => import('./backend-local.js').then(m => m.handle(p, o)) : remote;
export const setFetcher = f => { fetcher = f; };
export const apiFetch = (p, o) => fetcher(p, o);
export const api = (p, o) => apiFetch(p, o).then(r => {
  if (r.status === 401) location.href = url('/login');
  if (r.headers.get('X-Offline')) throw new Error(t('offline – noch nicht für unterwegs geladen'));
  return r.json();
}).then(j => p === '/api/today' ? withPendingLog(j) : j);
// eigener /api/today-Stand (nicht ?user=): gepufferte Quiz-/Schreib-Einträge einrechnen (todaypending.js, offline Lektionswechsel)
const withPendingLog = j => Promise.all([import('./offline.js'), import('./data.js'), import('./todaypending.js')])
  .then(([o, d, m]) => o.pendingLog().then(es => m.withPending(j, d.D?.lessons.map(l => l.id), es))).catch(() => j);
// Protokoll: Zeitstempel im Browser setzen, damit offline gepufferte Einträge (offline.js) ihre echte Zeit behalten
export const log = entry => import('./offline.js').then(o => o.send('/api/log', { method: 'POST', body: JSON.stringify({ ts: new Date().toISOString(), ...entry }) })).catch(() => {});

// Mkhedruli + Transliteration + IPA nebeneinander
export const tri = (ka, tr, ipa, cls = 'big') => h('span', {}, h('span', { class: 'ka ' + cls }, ka), ' ', h('span', { class: 'tr', 'data-ka': ka }, tr), ' ', h('span', { class: 'ipa', 'data-ka': ka }, ipa));

// Mini-Markdown für Lektionstexte
export function md(src) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  // Code-Spans zuerst herausnehmen, damit * und _ darin unberührt bleiben; kursiv nur an Wortgrenzen (a_b_c, 2*3*4 bleiben)
  const inline = s => {
    const codes = [];
    return esc(s).replace(/`(.+?)`/g, (_, c) => `\u0000${codes.push(c) - 1}\u0000`)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s(„"»])\*(?=\S)(.+?)(?<=\S)\*(?![\p{L}\p{N}*])/gu, '$1<em>$2</em>')
      .replace(/(^|[\s(„"»])_(?=\S)(.+?)(?<=\S)_(?![\p{L}\p{N}_])/gu, '$1<em>$2</em>')
      .replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
  };
  const out = []; let list = null, table = null;
  const flush = () => { if (list) out.push(`<${list.t}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.t}>`); if (table) out.push(`<table>${table.join('')}</table>`); list = table = null; };
  for (const line of src.split(/\r?\n/)) {
    let m;
    if (/^\s*\|/.test(line)) {
      if (/^\s*\|[\s|:-]+\|\s*$/.test(line)) continue;
      if (!table) { flush(); table = []; }
      table.push('<tr>' + line.trim().slice(1, -1).split('|').map(c => `<td>${inline(c.trim())}</td>`).join('') + '</tr>');
    } else if ((m = line.match(/^(#{2,3}) (.*)/))) { flush(); out.push(`<h${m[1].length + 1}>${inline(m[2])}</h${m[1].length + 1}>`); }
    else if ((m = line.match(/^\s*(?:[-*]|(\d+)\.) (.*)/))) {
      const kind = m[1] ? 'ol' : 'ul';
      if (!list || list.t !== kind) { flush(); list = { t: kind, items: [] }; }
      list.items.push(inline(m[2]));
    } else if (line.trim()) { flush(); out.push(`<p>${inline(line)}</p>`); }
    else flush();
  }
  flush();
  // georgische Zeichen in passender Schrift
  return out.join('').replace(/([ა-ჿ]+)/g, '<span class="ka">$1</span>');
}
