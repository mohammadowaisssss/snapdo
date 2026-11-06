/* =====================================================================
   ENTRY: styles, then every module in dependency order (several register
   global listeners or add handlers to the action table when they load), then boot.
   ===================================================================== */
import './styles/index.css';
import './core/utils.js';
import './core/icons.js';
import './core/constants.js';
import './data/seed.js';
import './core/store.js';
import './ui/helpers.js';
import './core/theme.js';
import './ui/toast.js';
import './ui/select.js';
import './shell/render.js';
import './shell/layout.js';
import './shell/skeletons.js';
import './shell/view-engine.js';
import './components/task-list.js';
import './pages/home.js';
import './pages/overview.js';
import './pages/my-tasks.js';
import './pages/tasks.js';
import './pages/inbox.js';
import './pages/notifications.js';
import './pages/favorites.js';
import './pages/projects.js';
import './pages/members.js';
import './pages/activity.js';
import './pages/search.js';
import './pages/errors.js';
import './pages/project.js';
import './views/project-overview.js';
import './views/board.js';
import './views/table.js';
import './views/calendar.js';
import './views/timeline.js';
import './views/files.js';
import './overlays/drawer.js';
import './overlays/modals.js';
import './overlays/popovers.js';
import './overlays/context-menu.js';
import './overlays/palette.js';
import './pages/settings.js';
import './pages/auth.js';
import './pages/design-system.js';
import './actions/actions.js';
import './actions/events.js';
import './actions/keyboard.js';
import './actions/drag-drop.js';
import './features/teams.js';
import './features/subtasks.js';
import './features/archive.js';
import './actions/teams.js';
import './actions/subtasks.js';
import './actions/archive.js';
import { api } from './core/api.js';
import { clearAuthSession, getStoredAuthToken, isAuthenticated, PUBLIC_AUTH_ROUTES, saveAuthSession } from './core/auth.js';
import { onFirebaseUserChanged } from './core/firebase.js';
import { S, D, applyAuthenticatedUser, save, hydrateFromBackend } from './core/store.js';
import { toast } from './ui/toast.js';
import { A } from './actions/actions.js';
import { ROUTE_NAMES, render, go } from './shell/render.js';

(function init() {
  document.documentElement.lang = 'en';
  if (!document.getElementById('sr-live')) {
    const l = document.createElement('div');
    l.id = 'sr-live';
    l.className = 'sr';
    l.setAttribute('aria-live', 'polite');
    document.body.appendChild(l);
  }

  // Frontend route security check
  const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
  const resetTokenParam = qs.get('reset');
  const verifyTokenParam = qs.get('verify');
  const emailParam = qs.get('email');

  const h = (location.hash || '').slice(1);
  if (resetTokenParam || h === 'reset') {
    S.ui.auth = 'reset';
    if (resetTokenParam) S.ui.af.resetToken = resetTokenParam;
    if (emailParam) S.ui.af.email = emailParam;
  } else if (verifyTokenParam || h === 'verify') {
    S.ui.auth = 'verify';
    if (emailParam) S.ui.af.email = emailParam;
  } else if (PUBLIC_AUTH_ROUTES.has(h)) {
    S.ui.auth = h;
  } else if (!isAuthenticated()) {
    // Unauthenticated user attempting to access workspace pages: redirect to login
    clearAuthSession();
    S.ui.auth = 'login';
    try {
      location.hash = 'login';
    } catch {
      /* ignore */
    }
  } else {
    S.ui.auth = null;
    if (h && (ROUTE_NAMES[h] || h === 'project' || h === 'member' || h === 'team')) {
      S.ui.route = h;
    } else {
      S.ui.route = S.prefs.home || 'home';
    }
  }

  // Listen to address bar and history hash transitions to prevent unauthorized URL access
  window.addEventListener('hashchange', () => {
    const raw = (location.hash || '').slice(1);
    if (PUBLIC_AUTH_ROUTES.has(raw)) {
      S.ui.auth = raw;
      render();
    } else if (!isAuthenticated()) {
      clearAuthSession();
      S.ui.auth = 'login';
      try {
        location.hash = 'login';
      } catch {
        /* ignore */
      }
      render();
    } else {
      S.ui.auth = null;
      if (raw && (ROUTE_NAMES[raw] || raw === 'project' || raw === 'member' || raw === 'team')) {
        go(raw);
      } else {
        go(S.prefs.home || 'home');
      }
    }
  });

  render();

  // If token is present, verify session validity with backend /api/auth/me
  if (isAuthenticated()) {
    api
      .checkSession()
      .then(res => {
        if (res?.user) {
          applyAuthenticatedUser(res.user);
          render();
        }
      })
      .catch(err => {
        if (err?.status === 401) {
          clearAuthSession();
          S.ui.auth = 'login';
          try {
            location.hash = 'login';
          } catch {
            /* ignore */
          }
          render();
        }
      });
  }

  hydrateFromBackend(() => {
    const params = new URLSearchParams(location.search);
    const inviteToken = params.get('invite');
    const inviteEmail = params.get('email');
    const verifyToken = params.get('verify');
    if (verifyToken) {
      api
        .verifyEmail(verifyToken, inviteEmail || undefined)
        .then(res => {
          if (res?.member) {
            applyAuthenticatedUser({ name: res.member.name, email: res.member.email });
            if (res.token) {
              saveAuthSession(res.token, res.member, res.expiresAt);
            }
            S.ui.auth = null;
            try {
              history.replaceState({}, '', location.pathname + '#home');
            } catch {
              /* ignore */
            }
            go(S.prefs.home || 'home');
            toast(`Account verified — welcome to Snapsec, ${res.member.name}!`);
          }
        })
        .catch(err => {
          toast(err?.message || 'Invalid or expired OTP code', 'error');
        });
    } else if (inviteToken || inviteEmail) {
      api
        .acceptInvite({ token: inviteToken, email: inviteEmail })
        .then(res => {
          if (res?.member) {
            applyAuthenticatedUser({ name: res.member.name, email: res.member.email });
            S.ui.auth = null;
            try {
              history.replaceState({}, '', location.pathname + (location.hash || ''));
            } catch {
              /* ignore */
            }
            render();
            toast(`Invitation accepted — welcome to ${D().ws.name}, ${res.member.name}!`);
          }
        })
        .catch(() => {});
    }
    render();
  });

  onFirebaseUserChanged(profile => {
    if (profile && profile.email) {
      applyAuthenticatedUser({ ...profile, provider: 'Google' });
      api.googleAuth(profile).catch(() => {});
      render();
    }
  });
})();

// Handle for debugging and verification tooling.
window.__snapsec = {
  S,
  D,
  A,
  go,
  render,
  save,
  api,
  applyAuthenticatedUser,
  isAuthenticated,
  clearAuthSession,
  saveAuthSession,
  getStoredAuthToken,
};
