// Aktive Lernzeit heute (Kopfzeile „⏱ 12/30“): zählt nur Sekunden, in denen die Seite sichtbar ist UND in den letzten
// IDLE Sekunden eine Eingabe kam (Klick, Taste, Wischen, Tippen) oder Audio läuft – eine offen liegende PWA zählt nicht.
// Pro Minute aktiver Zeit (und beim Verlassen) ein Log-Eintrag {ex:'time', sec}; der Server summiert sie pro Tag
// (/api/today → secToday, auch von anderen Geräten), lokal liegen nur noch nicht gesendete Sekunden.
// In „Heute“ trägt jeder Eintrag den laufenden Schritt (step, setStep()) → Schrittdauern (stepTimes in logstats.mjs).
import { h, api, log } from './util.js';
import { t } from './i18n.js';

export const GOAL = 30 * 60;            // Tagesziel in Sekunden (CLAUDE.md: ~30 min/Tag)
const IDLE = 45e3, FLUSH = 60;
const today = () => new Date().toLocaleDateString('sv');    // YYYY-MM-DD lokal
const KEY = 'learnTime';

let lastInput = 0, playing = 0, server = 0, day = today();
let unsent = 0, step = null;
try { const s = JSON.parse(localStorage.getItem(KEY)); if (s?.day === day) unsent = s.unsent ?? 0; } catch {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ day, unsent })); } catch {} };

for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel', 'input'])
  addEventListener(ev, () => { lastInput = Date.now(); }, { capture: true, passive: true });
// Audio/Video: play/pause bubbeln nicht, aber im Capture-Modus kommen sie am document an
document.addEventListener('play', () => { playing++; }, true);
for (const ev of ['pause', 'ended']) document.addEventListener(ev, () => { playing = Math.max(0, playing - 1); }, true);

export const isActive = () => document.visibilityState === 'visible' && (Date.now() - lastInput < IDLE || playing > 0);
export const secToday = () => server + unsent;

function flush() {
  if (unsent < 1) return;
  const sec = Math.round(unsent);
  log({ ex: 'time', sec, ...(step ? { step } : {}) });
  server += sec; unsent = 0; save();
}
addEventListener('pagehide', flush);
addEventListener('geo-lang', flush);    // vor dem Sprachwechsel (account.js), sonst landen die Sekunden in der neuen Sprache

// Schritt wechseln: bisherige Sekunden gehören noch zum alten Schritt. Verlässt man „Heute“, endet der Schritt.
export function setStep(s) { if (s === step) return; flush(); step = s; }
addEventListener('hashchange', () => { if (!location.hash.startsWith('#/today')) setStep(null); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

// Anzeige in der Kopfzeile, Klick → Wochenrückblick
const pill = h('a', { href: '#/week', class: 'timer' });
function render() {
  const s = secToday(), m = Math.round(s / 60), done = m >= GOAL / 60;   // gerundet wie weekStats/dayMinutes (logstats.mjs)
  pill.textContent = done ? t('✓ {m} min', { m }) : `⏱ ${m}/${GOAL / 60}`;
  pill.style.setProperty('--p', Math.min(1, s / GOAL));
  pill.classList.toggle('done', done);
  pill.classList.toggle('idle', !isActive());
  pill.title = t('Aktive Lernzeit heute: {m} min (Ziel {goal}). Zählt nur, solange du etwas tust oder Audio läuft', { m, goal: GOAL / 60 }) +
    (isActive() ? '.' : t(' – gerade pausiert.'));
}
document.getElementById('net-slot')?.before(pill);

setInterval(() => {
  if (today() !== day) { flush(); day = today(); server = 0; unsent = 0; save(); }
  if (isActive()) { unsent++; if (unsent >= FLUSH) flush(); else if (unsent % 10 === 0) save(); }
  render();
}, 1000);

// Stand des Servers (alle Geräte) holen – beim Start und wenn die Seite wieder sichtbar wird
export async function syncTime() {
  const td = await api('/api/today').catch(() => null);
  if (td && typeof td.secToday === 'number' && today() === day) server = td.secToday;
  render();
}
syncTime();
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncTime(); });
