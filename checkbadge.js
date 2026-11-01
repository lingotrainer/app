// Herkunfts-Badge für von Claude erzeugte Inhalte: „geprüft“ (Prüfseite #/check, Feld reviewed vom Server) bzw. „ungeprüft“
import { h } from './util.js';
import { t } from './i18n.js';

export const verifiedBadge = (x, title = t('von Claude erstellt, noch nicht gegen eine Quelle geprüft')) => x.reviewed
  ? h('span', { class: 'badge native', title: t(x.reviewed.fix ? 'korrigiert von {user} am {date}' : 'bestätigt von {user} am {date}', { user: x.reviewed.user, date: x.reviewed.date}) }, t('geprüft'))
  : x.verified === false ? h('span', { class: 'badge', title }, t('ungeprüft')) : null;
