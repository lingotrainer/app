// Georgisch-Trainer – Frontend ohne Build-Schritt (ES-Module). Hier nur Router und Start.
import { loadData } from './data.js';
import { setKeyHandler } from './keyboard.js';
import { viewHome } from './views/home.js';
import { viewIpa } from './views/ipa.js';
import { viewLesson } from './views/lesson.js';
import { viewReview } from './views/review.js';
import { viewListen } from './views/listen.js';
import { viewToday } from './views/today.js';
import { viewWeak } from './views/weak.js';
import { $app, h, hashQuery } from './util.js';
import { setLesson } from './opts.js';
import { ctx } from './ctx.js';
import { viewStats } from './stats.js';
import { viewWeek } from './week.js';
import { viewRecord } from './record.js';
import { viewFlashRead } from './flashread.js';
import './account.js';
import './timer.js';
import { viewOffline } from './views/offline.js';
import { initOffline } from './offline.js';
import { autoPrefetch } from './prefetch.js';
import { viewForms } from './views/forms.js';
import { viewNumbers } from './views/numbers.js';
import { viewRead } from './views/read.js';
import { viewMistakes } from './views/mistakes.js';
import { viewCheck } from './check.js';
import { learnerPicker, learnerName, viewRateRecordings } from './coach.js';
import { t, translateDom } from './i18n.js';
import { viewCourses } from './views/courses.js';
import { viewAdmin, viewPassword } from './admin.js';
import { viewAbout } from './views/about.js';
import { viewInstall } from './views/install.js';

// '#/<view>/…' → Funktion(id, tab); neue Ansichten hier eintragen
const ROUTES = {
  lesson: viewLesson,
  review: viewReview,
  ipa: viewIpa,
  listen: viewListen,
  today: viewToday,
  weak: viewWeak,
  forms: viewForms,
  numbers: viewNumbers,
  read: viewRead,
  stats: id => { setLesson(null); viewStats($app, { ...ctx(), learner: id, head: [h('h1', {}, id ? t('Statistik') + ' – ' + learnerName(id) : t('Statistik')), learnerPicker('stats', id)].filter(Boolean) }); },
  week: id => { setLesson(null); viewWeek($app, ctx(), Math.max(0, parseInt(id) || 0)); },
  record: id => { setLesson(null); viewRecord($app, { ...ctx(), learner: id, picker: learnerPicker('record', id), next: hashQuery().has('next') }); },
  'flash-read': () => { setLesson(null); viewFlashRead($app, ctx()); },
  check: viewCheck,
  'listen-to': id => { setLesson(null); viewRateRecordings(id, $app); },
  offline: viewOffline,
  mistakes: viewMistakes,
  courses: viewCourses,   // statische PWA: Sprachen & Lernstand (P7 B3/B4)
  admin: viewAdmin,       // Benutzerverwaltung (P7 D2, nur Admins)
  password: viewPassword,
  about: viewAbout,       // Quellen & Lizenzen (P7 B7)
  install: viewInstall,   // Anleitung Installieren, offline, Lernstand sichern (P7 B6)
};

function route() {
  setKeyHandler(null);
  const [, view, id, tab] = location.hash.split('?')[0].split('/');   // #/record/<id>?next=1 → Parameter: hashQuery()
  (ROUTES[view] ?? viewHome)(id, tab);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);

translateDom();
initOffline();
await loadData();
route();
autoPrefetch();   // „Für unterwegs“: im Heimnetz-WLAN Daten + Audio der nächsten Lektionen nachladen
