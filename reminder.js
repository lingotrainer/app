// Tägliche Erinnerung per Web-Push (Server: app/push.mjs): Karte auf der Startseite mit Uhrzeit, an/aus, Test-Push,
// dazu ein sanfter zweiter Hinweis am Abend (nur wenn heute noch nichts geübt), einstellbar. Coaches (state.coach = Namen der
// Lernenden): „Hinweise als Coach“ (coachOn, was in der Box „Für …“ offen ist) und die eigene Lern-Erinnerung (learnOn) getrennt.
// iPhone/iPad: Push nur in der App vom Home-Bildschirm (iOS ≥ 16.4), nicht im Safari-Tab.
import { h, api, STATIC } from './util.js';
import { t } from './i18n.js';

// Klick auf die Nachricht bei nicht gesteuertem Fenster: sw.js schickt NAVIGATE
navigator.serviceWorker?.addEventListener('message', e => { if (e.data?.type === 'NAVIGATE') location.href = e.data.url; });

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
const post = (method, body) => api('/api/push', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const keyBytes = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

async function subscribe(publicKey) {
  if (await Notification.requestPermission() !== 'granted') throw new Error(t('Benachrichtigungen sind im Browser blockiert – in den Website-Einstellungen erlauben.'));
  const reg = await navigator.serviceWorker.ready, key = keyBytes(publicKey);
  // altes Abo verwerfen (Server-Schlüssel neu oder beim Push-Dienst erloschen, Server hat es dann gelöscht) → frisch abonnieren
  await (await reg.pushManager.getSubscription())?.unsubscribe().catch(() => {});
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

export function reminderCard() {
  if (STATIC) return null;   // Push braucht den Server (statische PWA: caps.push = false)
  const status = h('span', { class: 'muted small' });
  const card = h('div', { class: 'card' }, h('div', { class: 'row' }, h('b', {}, t('🔔 Tägliche Erinnerung')), status));
  if (isIOS && !standalone) { status.textContent = t('Auf dem iPhone/iPad nur in der App vom Home-Bildschirm (Teilen → „Zum Home-Bildschirm“, iOS ≥ 16.4).'); return card; }
  if (!supported() || !isSecureContext) { status.textContent = t('Dieser Browser kann keine Benachrichtigungen (oder die Seite ist nicht über HTTPS geöffnet).'); return card; }

  const time = h('input', { type: 'time', value: '19:00', style: 'font:inherit' });
  const toggle = h('button', { class: 'btn' }, '…');
  const test = h('button', { class: 'btn', hidden: true }, t('Test-Push'));
  const evOn = h('input', { type: 'checkbox' }), evening = h('input', { type: 'time', value: '21:00', style: 'font:inherit' });
  const evRow = h('label', { class: 'row small', style: 'margin-top:6px;display:none' }, evOn, t('abends um'), evening, t('Uhr nochmal, falls heute noch nichts geübt'));
  const coachOn = h('input', { type: 'checkbox' }), coachText = h('span', { style: 'flex:1;min-width:0' }), learnOn = h('input', { type: 'checkbox' });
  const coachRow = h('label', { class: 'row small', style: 'margin-top:6px;display:none' }, coachOn, coachText);
  const learnRow = h('label', { class: 'row small', style: 'margin-top:6px;display:none' }, learnOn, t('eigene Lern-Erinnerung'));
  const msg = h('div', { class: 'small muted' });
  card.append(h('div', { class: 'row', style: 'margin-top:8px' }, t('um'), time, t('Uhr'), toggle, test), coachRow, learnRow, evRow, msg);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  let state = null, mine = null;

  const show = () => {
    const on = state.on && mine && state.endpoints.includes(mine.endpoint);
    toggle.textContent = on ? t('Ausschalten') : t('Einschalten');
    toggle.classList.toggle('primary', !on);
    const coach = state.coach?.length > 0, learn = !coach || state.learnOn, names = (state.coach ?? []).join(t(' und '));
    test.hidden = !on;    // .row setzt display:flex → hidden wirkt nicht
    evRow.style.display = on && learn ? '' : 'none'; coachRow.style.display = learnRow.style.display = on && coach ? '' : 'none';
    evOn.checked = state.eveningOn; evening.value = state.evening; evening.disabled = !state.eveningOn;
    coachOn.checked = state.coachOn; learnOn.checked = state.learnOn;
    coachText.textContent = t('Hinweise als Coach, wenn für {names} etwas offen ist (anhören, aufnehmen, prüfen)', { names });
    const ev = state.eveningOn && state.evening > state.time ? t(', abends um {time} nochmal', { time: state.evening }) : '';
    const parts = [learn ? t('Lern-Erinnerung') : '', coach && state.coachOn ? t('Hinweis für {names}', { names }) : ''].filter(Boolean);
    status.textContent = !on ? t('aus') : coach ? t('an – täglich um {time} Uhr: {parts}', { time: state.time, parts: parts.join(' + ') || t('nichts ausgewählt') }) : t('an – täglich um {time} Uhr{ev}, außer du hast schon gelernt', { time: state.time, ev });
    if (Notification.permission === 'denied') msg.textContent = t('Benachrichtigungen sind für diese Seite blockiert (Schloss-Symbol in der Adresszeile → Benachrichtigungen erlauben).');
  };
  const busy = async fn => {
    toggle.disabled = test.disabled = evOn.disabled = coachOn.disabled = learnOn.disabled = true; msg.textContent = '';
    try { await fn(); } catch (e) { msg.textContent = '⚠️ ' + (e.message ?? e); }
    toggle.disabled = test.disabled = evOn.disabled = coachOn.disabled = learnOn.disabled = false; show();
  };

  toggle.onclick = () => busy(async () => {
    if (state.on && mine && state.endpoints.includes(mine.endpoint)) {
      state = await post('DELETE', { endpoint: mine.endpoint });
      await mine.unsubscribe().catch(() => {}); mine = null;
    } else {
      mine = await subscribe(state.publicKey);
      state = await post('POST', { subscription: mine.toJSON(), time: time.value, tz, on: true });
      if (state.error) throw new Error(state.error);
    }
  });
  time.onchange = () => busy(async () => { state = await post('POST', { time: time.value, tz }); if (state.error) throw new Error(state.error); msg.textContent = t('Uhrzeit gespeichert.'); });
  const saveEvening = () => busy(async () => { state = await post('POST', { evening: evening.value, eveningOn: evOn.checked, tz }); if (state.error) { const e = state.error; state = await api('/api/push'); throw new Error(e); } msg.textContent = t('Abend-Hinweis gespeichert.'); });
  evOn.onchange = evening.onchange = saveEvening;
  coachOn.onchange = learnOn.onchange = () => busy(async () => { state = await post('POST', { coachOn: coachOn.checked, learnOn: learnOn.checked }); if (state.error) throw new Error(state.error); msg.textContent = t('Gespeichert.'); });
  test.onclick = () => busy(async () => {
    const r = await api('/api/push/test', { method: 'POST' });
    const ok = r.results?.filter(x => x.status >= 200 && x.status < 300).length ?? 0;
    msg.textContent = ok ? t(ok === 1 ? 'Test-Push an {n} Gerät geschickt – sollte gleich erscheinen.' : 'Test-Push an {n} Geräte geschickt – sollte gleich erscheinen.', { n: ok }) : t('⚠️ Test-Push fehlgeschlagen: {msg}', { msg: r.results?.map(x => `${x.status} ${x.text}`).join('; ') || t('kein Gerät angemeldet') });
    state = await api('/api/push');
  });

  busy(async () => {
    state = await api('/api/push');
    time.value = state.time;
    mine = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
  });
  return card;
}
