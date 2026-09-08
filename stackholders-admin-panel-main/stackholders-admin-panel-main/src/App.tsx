import { useState, useEffect, useCallback, Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import logoUrl from './assets/logo.png';
import {
  getCurrentStaffRole,
  getStaffRole,
  adminLogout,
  forceSignOut,
  onAuthStateChange,
  type StaffRole,
} from './services/authService';
import { useSessionPolicy } from './hooks/useSessionPolicy';

const Login = lazy(() => import('./components/Login'));
const Dashboard = lazy(() => import('./components/Dashboard'));
const Stockholders = lazy(() => import('./components/Stockholders'));
const Transactions = lazy(() => import('./components/Transactions'));
const DividendsManager = lazy(() => import('./components/DividendsManager'));
const ContactSubmissions = lazy(() => import('./components/ContactSubmissions'));
const FeedbackView = lazy(() => import('./components/FeedbackView'));
const ApprovalDocuments = lazy(() => import('./components/ApprovalDocuments'));
const Users = lazy(() => import('./components/Users'));
const AuditLog = lazy(() => import('./components/AuditLog'));
const Announcements = lazy(() => import('./components/Announcements'));
const TawaniNews = lazy(() => import('./components/TawaniNews'));
const TawaniReports = lazy(() => import('./components/TawaniReports'));
const ChangePasswordModal = lazy(() => import('./components/ChangePasswordModal'));
const SessionWarningModal = lazy(() => import('./components/SessionWarningModal'));
import LanguageSwitcher from './components/LanguageSwitcher';
import { LoadingScreen } from './components/ui/LoadingScreen';
import './App.css';

type View = 'dashboard' | 'stockholders' | 'transactions' | 'dividends' | 'announcements' | 'contact' | 'feedback' | 'approval-docs' | 'tawani-news' | 'tawani-reports' | 'users' | 'audit-log';

const VIEWS: View[] = ['dashboard', 'stockholders', 'transactions', 'dividends', 'announcements', 'contact', 'feedback', 'approval-docs', 'tawani-news', 'tawani-reports', 'users', 'audit-log'];

/**
 * What an editor may reach. They produce content and must not see shareholder
 * data, so everything financial and every directory is absent. This is the UI
 * half of the rule; the database half is that editors never receive
 * `portal_admin`, so `is_portal_admin()` policies refuse them regardless.
 */
const EDITOR_VIEWS: View[] = ['tawani-news', 'tawani-reports', 'announcements'];

const viewsForRole = (role: StaffRole): View[] =>
  role === 'editor' ? EDITOR_VIEWS : VIEWS;

/**
 * Opens straight onto the view named by `?view=`, so the links in the admin
 * notification emails (`/?view=contact`, `/?view=feedback`) land where they
 * promise. Validated against what this role may actually see, so a crafted (or
 * simply stale) value can only ever fall back to a permitted view.
 */
function initialView(role: StaffRole): View {
  const allowed = viewsForRole(role);
  const requested = new URLSearchParams(window.location.search).get('view');
  if (allowed.includes(requested as View)) return requested as View;
  return allowed[0] === 'dashboard' ? 'dashboard' : allowed[0];
}

const IconDashboard = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
    <rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>
  </svg>
);
const IconStockholders = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
    <circle cx="9" cy="7" r="4"/>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
  </svg>
);
const IconTransactions = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 7H6a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-3"/>
    <path d="M18 2h4v4"/><path d="M22 2 12 12"/>
  </svg>
);
const IconDividends = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
    <polyline points="16 7 22 7 22 13"/>
  </svg>
);
const IconMail = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
    <polyline points="22,6 12,13 2,6"/>
  </svg>
);
const IconFeedback = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);
const IconLogout = () => (
  <svg className="admin-logout-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
    <polyline points="16 17 21 12 16 7"/>
    <line x1="21" y1="12" x2="9" y2="12"/>
  </svg>
);
const IconKey = () => (
  <svg className="admin-account-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6"/><path d="m15.5 7.5 3 3L22 7l-3-3"/>
  </svg>
);
const IconMenu = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="12" x2="21" y2="12"/>
    <line x1="3" y1="6" x2="21" y2="6"/>
    <line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const IconClose = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/>
    <line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);
const IconDocuments = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
  </svg>
);
const IconAdmins = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    <path d="M9 12l2 2 4-4"/>
  </svg>
);
const IconAuditLog = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
  </svg>
);
const IconTawaniNews = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9h4"/>
    <path d="M18 14h-8m8 4h-8m8-8h-4"/>
  </svg>
);
const IconTawaniReports = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
    <polyline points="14 2 14 8 20 8"/>
    <path d="M9 15h6M9 11h2"/>
  </svg>
);
const IconAnnouncements = () => (
  <svg className="admin-nav-item-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 11 18-5v12L3 14v-3z"/>
    <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>
  </svg>
);

function App() {
  const { t } = useTranslation();
  const [authenticated, setAuthState] = useState(false);
  const [role, setRole] = useState<StaffRole>('admin');
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  /** Set when the session policy ended the session, so Login can explain why. */
  const [sessionExpiredNotice, setSessionExpiredNotice] = useState(false);

  const allowedViews = viewsForRole(role);

  const navItems = [
    { id: 'dashboard' as View, label: t('nav.dashboard'), Icon: IconDashboard },
    // All user management sits together, directly under the dashboard. Users was
    // previously last and fell below the fold of a scrolling sidebar, which made
    // it look as though only the two directories existed.
    { id: 'users' as View, label: t('nav.users', 'Users'), Icon: IconAdmins },
    { id: 'stockholders' as View, label: t('nav.stockholders'), Icon: IconStockholders },
    { id: 'transactions' as View, label: t('nav.transactions'), Icon: IconTransactions },
    { id: 'dividends' as View, label: t('nav.dividends'), Icon: IconDividends },
    { id: 'announcements' as View, label: t('nav.announcements'), Icon: IconAnnouncements },
    { id: 'approval-docs' as View, label: t('nav.approvalDocs'), Icon: IconDocuments },
    { id: 'tawani-news' as View, label: t('nav.tawaniNews', 'Tourism News'), Icon: IconTawaniNews },
    { id: 'tawani-reports' as View, label: t('nav.tawaniReports', 'Tourism Reports'), Icon: IconTawaniReports },
    { id: 'contact' as View, label: t('nav.contact'), Icon: IconMail },
    { id: 'feedback' as View, label: t('nav.feedback'), Icon: IconFeedback },
    { id: 'audit-log' as View, label: t('nav.auditLog', 'Audit Log'), Icon: IconAuditLog },
  ].filter((item) => allowedViews.includes(item.id));

  /**
   * Apply a freshly-resolved role: remember it, and land on a view that role is
   * actually allowed to see (honouring `?view=` when it points somewhere legal).
   */
  const applyRole = useCallback((nextRole: StaffRole) => {
    setRole(nextRole);
    setCurrentView(initialView(nextRole));
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        // Server-validated: a stale session in localStorage is no longer enough,
        // and the caller must actually be staff.
        const currentRole = await getCurrentStaffRole();
        setAuthState(currentRole !== null);
        if (currentRole) applyRole(currentRole);
      } catch (error) {
        console.error('Error checking auth:', error);
        setAuthState(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    const { data: { subscription } } = onAuthStateChange(async (currentUser) => {
      if (!currentUser) {
        setAuthState(false);
        return;
      }
      // A refresh can hand back a session whose claims have changed (rights
      // revoked, or demoted to editor) -- re-read rather than trusting "a user
      // exists", and re-narrow the visible views to match.
      const nextRole = getStaffRole(currentUser);
      setAuthState(nextRole !== null);
      if (nextRole) applyRole(nextRole);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [applyRole]);

  const handleLogin = async () => {
    const currentRole = await getCurrentStaffRole();
    if (currentRole) applyRole(currentRole);
    setAuthState(true);
  };

  const handleLogout = async () => {
    try {
      await adminLogout();
    } catch (error) {
      console.error('Error on logout:', error);
    } finally {
      setAuthState(false);
      setCurrentView('dashboard');
      setShowChangePassword(false);
    }
  };

  const handleSessionExpired = useCallback(async () => {
    await forceSignOut();
    setAuthState(false);
    setCurrentView('dashboard');
    setShowChangePassword(false);
    setSessionExpiredNotice(true);
  }, []);

  const { status: sessionStatus, secondsRemaining, absoluteExpiryImminent, extend } =
    useSessionPolicy({
      enabled: authenticated,
      onExpire: handleSessionExpired,
    });

  const navigate = (view: View) => {
    setCurrentView(view);
    setIsSidebarOpen(false);
  };

  if (loading) {
    return <LoadingScreen />;
  }

  if (!authenticated) {
    return (
      <Suspense fallback={<LoadingScreen />}>
        <Login
          onLogin={handleLogin}
          sessionExpired={sessionExpiredNotice}
          onDismissSessionNotice={() => setSessionExpiredNotice(false)}
        />
      </Suspense>
    );
  }

  return (
    <div className="admin-app">
      <div className="admin-blob-1" />
      <div className="admin-blob-2" />
      <div className="admin-blob-3" />

      {/* Mobile top header */}
      <div className="admin-mobile-header">
        <div className="admin-mobile-header-logo">
          <img src={logoUrl} alt="Logo" />
          <span>{t('app.adminPanel')}</span>
        </div>
        <button className="admin-mobile-menu-btn" onClick={() => setIsSidebarOpen(true)}>
          <IconMenu />
        </button>
      </div>

      {isSidebarOpen && (
        <div className="admin-sidebar-backdrop visible" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`admin-sidebar${isSidebarOpen ? ' open' : ''}`}>
        <button className="admin-sidebar-close" onClick={() => setIsSidebarOpen(false)}>
          <IconClose />
        </button>

        <div className="admin-sidebar-logo">
          <img src={logoUrl} alt="Logo" />
          <div>
            <p className="admin-sidebar-logo-title">{t('app.brandTitle')}</p>
            <p className="admin-sidebar-logo-subtitle">{t('app.brandSubtitle')}</p>
          </div>
        </div>

        <nav className="admin-sidebar-nav">
          {navItems.map(({ id, label, Icon }) => (
            <button
              key={id}
              className={`admin-nav-item${currentView === id ? ' active' : ''}`}
              onClick={() => navigate(id)}
            >
              <Icon />
              <span className="admin-nav-item-label">{label}</span>
            </button>
          ))}
        </nav>

        <div className="admin-sidebar-footer">
          <LanguageSwitcher />
          <button
            className="admin-account-btn"
            onClick={() => { setShowChangePassword(true); setIsSidebarOpen(false); }}
          >
            <IconKey />
            <span>{t('nav.changePassword')}</span>
          </button>
          <button className="admin-logout-btn" onClick={handleLogout}>
            <IconLogout />
            <span>{t('nav.signOut')}</span>
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="admin-main-content">
        <div className="admin-main-inner">
          <div className="admin-main-views">
            {/* Rendering is gated on `allowedViews`, not only on the nav, so a
                stale `currentView` can never render a tab this role lost. */}
            <Suspense fallback={<LoadingScreen />}>
              {allowedViews.includes(currentView) && <>
              {currentView === 'dashboard' && <Dashboard />}
              {currentView === 'stockholders' && <Stockholders />}
              {currentView === 'transactions' && <Transactions />}
              {currentView === 'dividends' && <DividendsManager />}
              {currentView === 'announcements' && <Announcements />}
              {currentView === 'contact' && <ContactSubmissions />}
              {currentView === 'feedback' && <FeedbackView />}
              {currentView === 'approval-docs' && <ApprovalDocuments />}
              {currentView === 'tawani-news' && <TawaniNews />}
              {currentView === 'tawani-reports' && <TawaniReports />}
              {currentView === 'users' && <Users />}
              {currentView === 'audit-log' && <AuditLog />}
              </>}
            </Suspense>
          </div>

          <footer className="admin-site-footer" role="contentinfo">
            <p>{t('common.footer', { year: new Date().getFullYear() })}</p>
          </footer>
        </div>
      </main>

      {showChangePassword && (
        <Suspense fallback={null}>
          <ChangePasswordModal isOpen onClose={() => setShowChangePassword(false)} />
        </Suspense>
      )}

      {sessionStatus === 'warning' && (
        <Suspense fallback={null}>
          <SessionWarningModal
            secondsRemaining={secondsRemaining}
            absolute={absoluteExpiryImminent}
            onStaySignedIn={extend}
            onSignOutNow={handleLogout}
          />
        </Suspense>
      )}
    </div>
  );
}

export default App;
