import React, { useEffect, useState, Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';
import logoUrl from '../assets/logo.png';
import { useAuth } from '../context/AuthContext';
import { StockholderInfo } from './StockholderInfo';
import { TransactionHistory } from './TransactionHistory';
import { YearlyDividendsView } from './YearlyDividends';
import { StockCertificate } from './StockCertificate';
import {
  getTransactionHistory,
  getAllTransactionHistory,
  calculateTotalSharesFromTransactions,
  calculateTotalValueFromTransactions,
  Transaction
} from '../services/stockholderService';
import { logger } from '../utils/logger';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutDashboard, User, ReceiptText, LogOut, RefreshCw, AlertCircle, TrendingUp, Award, Mail, MessageSquare, Megaphone, Newspaper, Rss, Menu, X } from 'lucide-react';
import { ContactForm } from './ContactForm';
import { Feedback } from './Feedback';
import { PrivacyNoticeModal } from './PrivacyNoticeModal';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingScreen } from './ui/LoadingScreen';
import { LanguageSwitcher } from './LanguageSwitcher';
import { translateError } from '../utils/errorUtils';

const Announcements = lazy(() => import('./Announcements'));
const TourismReports = lazy(() => import('./TourismReports'));
const TourismNews = lazy(() => import('./TourismNews'));

type View = 'overview' | 'info' | 'transactions' | 'dividends' | 'certificate' | 'announcements' | 'reports' | 'news' | 'contact' | 'feedback';

/**
 * What a subscriber may see: published content and their own notes, and nothing
 * touching a shareholding they do not have. Everything else in `View` is
 * shareholder-only.
 */
const SUBSCRIBER_VIEWS: View[] = ['announcements', 'news', 'reports', 'feedback', 'contact'];

export const Dashboard: React.FC = () => {
  const { t } = useTranslation();
  const { role, stockholder, logout, refreshStockholder, isLoading, isActionLoading, error } = useAuth();
  const isSubscriber = role === 'subscriber';
  const [currentView, setCurrentView] = useState<View>(() =>
    role === 'subscriber' ? 'news' : 'overview'
  );
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState<boolean>(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [calculatedShares, setCalculatedShares] = useState<number | null>(null);
  const [calculatedValue, setCalculatedValue] = useState<number | null>(null);
  const [sharesCalculated, setSharesCalculated] = useState<boolean>(false);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [totalTransactionsPages, setTotalTransactionsPages] = useState(1);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 1024);
  const [isPrivacyOpen, setIsPrivacyOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1024;
      setIsDesktop(desktop);
      if (desktop) setIsSidebarOpen(false);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loadTransactionHistory = React.useCallback(async () => {
    try {
      setTransactionsLoading(true);
      setTransactionsError(null);

      if (!sharesCalculated) {
        setSharesCalculated(false);
        const [recentData, allData] = await Promise.all([
          getTransactionHistory(transactionsPage, 20),
          getAllTransactionHistory()
        ]);

        setTransactions(recentData.data);
        setTotalTransactionsPages(Math.ceil(recentData.count / 20));

        const totalShares = calculateTotalSharesFromTransactions(allData);
        setCalculatedShares(totalShares);
        setCalculatedValue(calculateTotalValueFromTransactions(allData));
        setSharesCalculated(true);
      } else {
        const recentData = await getTransactionHistory(transactionsPage, 20);
        setTransactions(recentData.data);
      }
    } catch (err) {
      logger.error('Failed to load transaction history:', err);
      const isDevelopment = import.meta.env.DEV;
      const errorMessage = err instanceof Error
        ? (isDevelopment ? err.message : t('errors.failedToFetchHistory'))
        : t('errors.failedToFetchHistory');
      setTransactionsError(translateError(errorMessage, t));
      setSharesCalculated(true);
    } finally {
      setTransactionsLoading(false);
    }
  }, [sharesCalculated, transactionsPage, t]);

  useEffect(() => {
    if (stockholder) {
      loadTransactionHistory();
    }
  }, [stockholder, loadTransactionHistory]);

  if ((isLoading || isActionLoading) && !stockholder && !isSubscriber) {
    return <LoadingScreen />;
  }

  // A subscriber legitimately has no stockholder record, so the "we could not
  // load your data" screen below must not apply to them.
  if (!stockholder && !isSubscriber) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-primary/20 blur-[100px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-secondary/10 blur-[100px] pointer-events-none" />

        <Card className="max-w-md w-full p-8 border-slate-200 bg-white/70 backdrop-blur-xl shadow-2xl flex flex-col items-center text-center space-y-4 z-10">
          <AlertCircle className="w-16 h-16 text-rose-500 mb-2 drop-shadow-sm" />
          <h2 className="text-2xl font-semibold text-slate-800">{t('dashboard.noDataTitle')}</h2>
          <p className="text-slate-500">{t('dashboard.noDataDesc')}</p>
          {error && <p className="text-rose-600 text-sm p-3 bg-rose-50 border border-rose-100 rounded-md w-full">{error}</p>}
          <Button onClick={refreshStockholder} className="w-full mt-4 bg-primary hover:bg-primary/90 text-white shadow-md shadow-primary/20">
            <RefreshCw className="mr-2 w-4 h-4" /> {t('dashboard.tryAgain')}
          </Button>
        </Card>
      </div>
    );
  }

  const navItems = ([
    { id: 'overview', label: t('nav.overview'), icon: LayoutDashboard },
    { id: 'info', label: t('nav.myDetails'), icon: User },
    { id: 'certificate', label: t('nav.certificate'), icon: Award },
    { id: 'dividends', label: t('nav.yearlyDividends'), icon: TrendingUp },
    { id: 'transactions', label: t('nav.transactions'), icon: ReceiptText },
    { id: 'contact', label: t('nav.getInTouch'), icon: Mail },
    { id: 'feedback', label: t('nav.feedback'), icon: MessageSquare },
    { id: 'announcements', label: t('nav.announcements'), icon: Megaphone },
    { id: 'reports', label: t('nav.tourismReports', 'Tourism Reports'), icon: Newspaper },
    { id: 'news', label: t('nav.tourismNews', 'Tourism News'), icon: Rss },
  ] as const).filter((item) => !isSubscriber || SUBSCRIBER_VIEWS.includes(item.id));

  /** Views are gated here as well as in the nav, so a stale `currentView`
   *  cannot render a shareholding panel for a subscriber. */
  const canSee = (view: View): boolean =>
    currentView === view && (!isSubscriber || SUBSCRIBER_VIEWS.includes(view));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col lg:flex-row relative overflow-hidden font-sans selection:bg-primary/10 selection:text-primary">
      <div className="fixed top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/10 blur-[120px] pointer-events-none" />
      <div className="fixed bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-secondary/10 blur-[120px] pointer-events-none" />
      <div className="fixed top-[40%] right-[-5%] w-[30%] h-[50%] rounded-full bg-primary/10 blur-[100px] pointer-events-none" />

      {/* Mobile Header */}
      <div className="lg:hidden flex items-center justify-between p-4 bg-white border-b border-slate-200/60 z-30">
        <div className="flex items-center space-x-2">
          <img src={logoUrl} alt="Logo" className="h-8 object-contain" />
        </div>
        <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(true)}>
          <Menu className="w-6 h-6 text-slate-600" />
        </Button>
      </div>

      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={`
          ${isDesktop ? 'relative translate-x-0' : 'fixed inset-y-0 start-0 z-50'}
          w-72 flex-shrink-0 border-e border-slate-200/60 bg-white flex flex-col
          shadow-[4px_0_24px_-12px_rgba(0,0,0,0.1)] transition-transform duration-300 ease-in-out
          ${!isDesktop && !isSidebarOpen ? '-translate-x-full rtl:translate-x-full' : 'translate-x-0'}
        `}
      >
        {!isDesktop && (
          <div className="absolute top-4 end-4">
            <Button variant="ghost" size="icon" onClick={() => setIsSidebarOpen(false)}>
              <X className="w-6 h-6 text-slate-600" />
            </Button>
          </div>
        )}
        <div className="py-4 border-b border-slate-200/60">
          <div className="flex flex-col items-center text-center">
            <img src={logoUrl} alt="Logo" className="h-20 mb-6 object-contain" />
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setCurrentView(item.id);
                setIsSidebarOpen(false);
              }}
              className={`sidebar-nav-item w-full flex items-center gap-3 py-3 ps-6 pe-4 rounded-lg transition-all duration-300 relative group
                ${currentView === item.id
                  ? 'text-secondary bg-secondary/10 font-semibold'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/80 font-medium'}`}
            >
              <item.icon className="sidebar-nav-item-icon w-5 h-5 flex-shrink-0 z-10" />
              <span className="tracking-wide z-10 flex-1 min-w-0 text-start">{item.label}</span>
              {currentView === item.id && (
                <motion.div
                  layoutId="active-pill"
                  className="sidebar-active-pill absolute top-2 bottom-2 w-1 bg-secondary rounded-e-full z-20"
                />
              )}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-200/60 space-y-2">
          <LanguageSwitcher />
          <Button
            variant="ghost"
            onClick={logout}
            className="w-full justify-start text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors font-medium"
          >
            <LogOut className="me-3 w-5 h-5" />
            {t('nav.logout')}
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main id="main-content" className="relative z-10 flex h-screen min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col p-8">

          <header className="mb-8 flex justify-between items-end">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              <h1 className="text-4xl font-semibold text-slate-800 tracking-tight flex items-center drop-shadow-sm">
                {navItems.find(n => n.id === currentView)?.label}
              </h1>
              <p className="text-slate-500 mt-2 text-lg">{t('dashboard.subtitle')}</p>
            </motion.div>
          </header>

          {error && (
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-6 p-4 rounded-xl bg-orange-50 border border-orange-200 flex items-start justify-between backdrop-blur-sm shadow-sm"
            >
              <div className="flex items-center text-orange-800">
                <AlertCircle className="w-5 h-5 me-3 flex-shrink-0" />
                <span className="font-medium">{error}</span>
              </div>
              <Button size="sm" variant="ghost" className="text-orange-700 hover:text-orange-800 hover:bg-orange-100" onClick={refreshStockholder}>
                {t('common.refresh')}
              </Button>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.25 }}
              className="flex-1 space-y-8"
            >
              {(canSee('overview') || canSee('info')) && stockholder && (
                <Card className="p-0 border-slate-200/60 bg-white/70 backdrop-blur-xl shadow-xl shadow-slate-200/40 overflow-hidden rounded-2xl ring-1 ring-slate-900/5">
                  <StockholderInfo
                    stockholder={stockholder}
                    calculatedShares={sharesCalculated ? calculatedShares : null}
                    calculatedValue={sharesCalculated ? calculatedValue : null}
                    isCalculatingShares={!sharesCalculated && !transactionsError}
                  />
                </Card>
              )}

              {(canSee('overview') || canSee('transactions')) && (
                <div className="space-y-4">
                  {transactionsError && (
                    <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-center justify-between text-rose-800 shadow-sm">
                      <span className="flex items-center font-medium"><AlertCircle className="w-4 h-4 me-2" /> {transactionsError}</span>
                      <Button size="sm" variant="ghost" onClick={loadTransactionHistory} className="hover:bg-rose-100 text-rose-700">{t('common.retry')}</Button>
                    </div>
                  )}
                  <Card className="p-0 border-slate-200/60 bg-white/70 backdrop-blur-xl shadow-xl shadow-slate-200/40 overflow-hidden rounded-2xl ring-1 ring-slate-900/5">
                    <TransactionHistory
                      transactions={transactions}
                      isLoading={transactionsLoading}
                      page={transactionsPage}
                      totalPages={totalTransactionsPages}
                      onPageChange={setTransactionsPage}
                    />
                  </Card>
                </div>
              )}

              {(canSee('overview') || canSee('dividends')) && (
                <Card className="p-0 border-slate-200/60 bg-white/70 backdrop-blur-xl shadow-xl shadow-slate-200/40 overflow-hidden rounded-2xl ring-1 ring-slate-900/5">
                  <YearlyDividendsView />
                </Card>
              )}

              {canSee('certificate') && (
                <Card className="p-0 border-slate-200/60 bg-white/70 backdrop-blur-xl shadow-xl shadow-slate-200/40 overflow-hidden rounded-2xl ring-1 ring-slate-900/5">
                  <StockCertificate />
                </Card>
              )}

              {currentView === 'announcements' && (
                <Suspense fallback={<div className="py-16 text-center text-slate-400">{t('announcements.loading')}</div>}>
                  <Announcements />
                </Suspense>
              )}

              {currentView === 'reports' && (
                <Suspense fallback={<div className="py-16 text-center text-slate-400">{t('tourismReports.loading', 'Loading reports…')}</div>}>
                  <Card className="p-0 border-slate-200/60 bg-white/70 backdrop-blur-xl shadow-xl shadow-slate-200/40 overflow-hidden rounded-2xl ring-1 ring-slate-900/5">
                    <TourismReports />
                  </Card>
                </Suspense>
              )}

              {currentView === 'news' && (
                <Suspense fallback={<div className="py-16 text-center text-slate-400">{t('tourismNews.loading', 'Gathering the latest news…')}</div>}>
                  <Card className="p-0 border-slate-200/60 bg-white/70 backdrop-blur-xl shadow-xl shadow-slate-200/40 overflow-hidden rounded-2xl ring-1 ring-slate-900/5">
                    <TourismNews />
                  </Card>
                </Suspense>
              )}

              {currentView === 'contact' && (
                <Card className="p-8 border-none bg-white/70 backdrop-blur-xl shadow-xl shadow-slate-200/40 overflow-hidden rounded-2xl shadow-none ring-0">
                  <ContactForm />
                </Card>
              )}

              {currentView === 'feedback' && (
                <Card className="p-8 border-none bg-white/70 backdrop-blur-xl shadow-xl shadow-slate-200/40 overflow-hidden rounded-2xl shadow-none ring-0">
                  <Feedback />
                </Card>
              )}
            </motion.div>
          </AnimatePresence>

          <footer
            className="mt-auto pt-10 pb-2 border-t border-slate-200/80 text-center text-sm text-slate-500"
            role="contentinfo"
          >
            <p>{t('common.footer', { year: new Date().getFullYear() })}</p>
            <button
              type="button"
              onClick={() => setIsPrivacyOpen(true)}
              className="mt-3 text-primary underline underline-offset-4"
            >
              {t('privacy.open')}
            </button>
          </footer>

        </div>
      </main>
      <PrivacyNoticeModal isOpen={isPrivacyOpen} onClose={() => setIsPrivacyOpen(false)} />
    </div>
  );
};
