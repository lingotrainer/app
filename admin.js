// Konto und Benutzerverwaltung (P7 D2, Server app/admin.mjs + app/auth.mjs):
//   #/admin     nur Admins: Benutzer anlegen, Name/Rolle/Kurse/Admin ändern, Coaches freigeben, Einladungslink (Passwort-Modus)
//   #/password  Passwort ändern (nur Anmeldung mit Passwort)
// Gleiche Operationen wie scripts/users.mjs. Ohne Server (statische PWA) bzw. ohne Recht zeigt die Ansicht die Meldung des Servers.
import { h, $app, api, toast } from './util.js';
import { setLesson } from './opts.js';
import { t, tx } from './i18n.js';

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) }).catch(e => ({ error: e.message }));
const ROLE = { learner: () => t('Lernende(r)'), editor: () => t('Muttersprachler/Coach (editor)') };

export async function viewAdmin() {
  setLesson(null);
  $app.replaceChildren(h('h1', {}, t('Benutzer verwalten')), h('p', { class: 'muted' }, t('Lade …')));
  const d = await api('/api/admin/users').catch(e => ({ error: e.message }));
  if (d.error) return $app.replaceChildren(h('h1', {}, t('Benutzer verwalten')), h('p', { class: 'feedback bad' }, d.error));
  const editors = d.users.filter(u => u.role === 'editor');
  const reload = () => viewAdmin();
  const save = async (body, ok) => { const r = await post('/api/admin/user', body); if (r.error) { toast(r.error, 4000); reload(); } else if (ok) toast(ok); };

  // Kurse (P7 C5): Titel aus den Datentexten, dahinter die ID (de-ka = von Deutsch aus Georgisch); erster angehakter = Standard
  const courseBoxes = (sel, onchange) => h('span', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, d.courses.map(c =>
    h('label', { title: c.id }, h('input', { type: 'checkbox', value: c.id, checked: sel.includes(c.id), onchange }), ' ' + tx(c.title),
      h('span', { class: 'muted small' }, ` (${c.id})`))));
  const coursesIn = el => [...el.querySelectorAll('input:checked')].map(i => i.value);

  const card = u => {
    // Reihenfolge bleibt (bisheriger Standardkurs vorn), neu angehakte hinten
    const boxes = courseBoxes(u.courses, () => { const on = coursesIn(boxes), v = [...u.courses.filter(c => on.includes(c)), ...on.filter(c => !u.courses.includes(c))];
      if (v.length) save({ id: u.id, courses: v }, t('Kurse gespeichert')).then(() => { u.courses = v; }); else reload(); });
    const invite = h('div', { class: 'small' });
    const coaches = editors.filter(c => c.id !== u.id);
    return h('div', { class: 'card' },
      h('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:wrap' },
        h('b', {}, u.name, h('span', { class: 'muted small' }, ` (${u.id})`)),
        h('span', { class: 'small muted' }, [u.admin ? t('Admin') : null, d.mode === 'password' ? (u.hasPassword ? t('Passwort gesetzt') : t('noch kein Passwort')) : null].filter(Boolean).join(' · '))),
      h('label', { class: 'row' }, h('span', { class: 'small muted' }, t('Name')),
        h('input', { type: 'text', value: u.name, onchange: e => save({ id: u.id, name: e.target.value }, t('Name gespeichert')) })),
      h('label', { class: 'row' }, h('span', { class: 'small muted' }, t('Rolle')),
        h('select', { onchange: e => save({ id: u.id, role: e.target.value }, t('Rolle gespeichert')).then(reload) },
          d.roles.map(r => h('option', { value: r, selected: r === u.role }, ROLE[r]?.() ?? r)))),
      h('div', { class: 'row' }, h('span', { class: 'small muted' }, t('Kurse')), boxes),
      coaches.length ? h('div', { class: 'row' }, h('span', { class: 'small muted', title: t('Coaches sehen Statistik und Problemlaute, schicken Notizen und bewerten Aufnahmen') }, t('Coaches')),
        h('span', { class: 'row', style: 'gap:10px;flex-wrap:wrap' }, coaches.map(c => h('label', {}, h('input', { type: 'checkbox', checked: u.coaches.includes(c.id),
          onchange: async e => { const r = await post('/api/admin/coach', { learner: u.id, coach: c.id, on: e.target.checked }); if (r.error) { toast(r.error, 4000); e.target.checked = !e.target.checked; } } }), ' ' + c.name)))) : null,
      h('label', {}, h('input', { type: 'checkbox', checked: u.admin, onchange: e => save({ id: u.id, admin: e.target.checked }, e.target.checked ? t('Ist jetzt Admin') : t('Kein Admin mehr')) }), ' ' + t('darf Benutzer verwalten (Admin)')),
      d.mode === 'password' ? h('div', {},
        h('button', { class: 'btn', onclick: async () => {
          const r = await post('/api/admin/invite', { id: u.id });
          if (r.error) return toast(r.error, 4000);
          const link = new URL(r.link, location.href).href;
          invite.replaceChildren(h('div', { class: 'muted' }, t('Einladungslink ({days} Tage gültig, einmalig) – per Nachricht schicken:', { days: r.days })),
            h('input', { type: 'text', readonly: true, value: link, style: 'width:100%', onclick: e => e.target.select() }));
          navigator.clipboard?.writeText(link).then(() => toast(t('Link kopiert')), () => {});
        } }, u.hasPassword ? t('Link zum Passwort-Zurücksetzen') : t('Einladungslink erzeugen')), invite) : null);
  };

  const form = h('form', { class: 'card' },
    h('h2', { style: 'margin-top:0' }, t('Neuer Benutzer')),
    h('label', { class: 'row' }, h('span', { class: 'small muted' }, t('Kennung')), h('input', { name: 'id', required: true, pattern: '[a-z][a-z0-9_-]{0,31}', placeholder: t('z. B. anna'), autocapitalize: 'none' })),
    h('label', { class: 'row' }, h('span', { class: 'small muted' }, t('Name')), h('input', { name: 'name', required: true })),
    h('label', { class: 'row' }, h('span', { class: 'small muted' }, t('Rolle')), h('select', { name: 'role' }, d.roles.map(r => h('option', { value: r }, ROLE[r]?.() ?? r)))),
    h('div', { class: 'row' }, h('span', { class: 'small muted' }, t('Kurse')), courseBoxes([d.courses.find(c => c.id === 'de-ka')?.id ?? d.courses[0]?.id])),
    h('button', { class: 'btn primary', type: 'submit' }, t('Anlegen')));
  form.onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const r = await post('/api/admin/users', { id: v.id.trim().toLowerCase(), name: v.name, role: v.role, courses: coursesIn(form) });
    if (r.error) return toast(r.error, 4000);
    toast(d.mode === 'password' ? t('Angelegt – jetzt Einladungslink erzeugen') : t('Angelegt'));
    reload();
  };

  $app.replaceChildren(h('h1', {}, t('Benutzer verwalten')),
    h('p', { class: 'muted small' }, d.mode === 'password' ? t('Anmeldung mit Passwort: Neue Benutzer setzen ihr Passwort über einen Einladungslink.')
      : d.mode === 'pick' ? t('Anmeldung per Namenswahl ohne Passwort (nur im Heimnetz sinnvoll).') : t('Lokaler Betrieb ohne Anmeldung.')),
    ...d.users.map(card), form);
}

export function viewPassword() {
  setLesson(null);
  const msg = h('p', { class: 'feedback', role: 'status' });
  const field = (label, name, ac) => h('label', { style: 'display:grid;gap:4px' }, h('span', { class: 'small muted' }, label), h('input', { type: 'password', name, autocomplete: ac, required: true }));
  const form = h('form', { class: 'card', style: 'display:grid;gap:10px;max-width:360px' },
    field(t('Bisheriges Passwort'), 'old', 'current-password'), field(t('Neues Passwort'), 'password', 'new-password'), field(t('Neues Passwort wiederholen'), 'password2', 'new-password'),
    h('button', { class: 'btn primary', type: 'submit' }, t('Passwort ändern')), msg);
  form.onsubmit = async e => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    msg.className = 'feedback bad';
    if (v.password !== v.password2) return msg.textContent = t('Die Passwörter stimmen nicht überein.');
    const r = await post('/api/password', { old: v.old, password: v.password });
    if (r.error) return msg.textContent = r.error;
    form.reset();
    msg.className = 'feedback good';
    msg.textContent = t('Passwort geändert. Andere Geräte müssen sich neu anmelden.');
  };
  $app.replaceChildren(h('h1', {}, t('Passwort ändern')), form);
}
