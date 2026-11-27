import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  Menu,
  Settings,
  LayoutDashboard,
  Receipt,
  TrendingUp,
  Wallet,
  CreditCard,
  Lock,
  ChartNoAxesCombined,
  Sparkles,
  Shield,
  X,
  ListOrdered,
  Code2,
  ChevronRight,
} from 'lucide-react';
import { ICON_STROKE } from './components/AppIcons';
import ScrollToTop from './components/ScrollToTop';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { ConfirmProvider } from './context/ConfirmContext';
import { syncTwoWay } from './services/syncService';
import DashboardPage from './pages/DashboardPage';
import LedgerPage from './pages/LedgerPage';
import TransactionsPage from './pages/TransactionsPage';
import DepositsPage from './pages/DepositsPage';
import AccountsPage from './pages/AccountsPage';
import ToolsPage from './pages/ToolsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import DeveloperPage from './pages/DeveloperPage';
import ProductivityPage from './pages/ProductivityPage';
import AiPage from './pages/AiPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import { seedInitialDataIfNeeded } from './db/seedHelper';
import './App.css';

// Seed initial historical data on startup
seedInitialDataIfNeeded();

// Pre-warm the backend server on startup
try {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
  fetch(`${apiUrl}/health`).catch(() => {});
} catch {}

function AppContent() {
  const { user, loading, isOnline, pendingSync, refreshPendingCount } = useAuth();
  const toast = useToast();
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

  if (loading) {
    return (
      <div className="app-loader">
        <img src="/app-logo.png" alt="Daily Ledger" className="app-loader-icon" />
        <div className="spinner-lg" />
        <p>Loading Daily Ledger...</p>
      </div>
    );
  }

  // If not logged in, allow them to log in or register
  if (!user) {
    return (
      <div className="auth-shell">
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-screen">
      {/* Top Masthead Header matching Screenshot */}
      <header className="masthead-header">
        <div className="masthead-left">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
            <img src="/app-logo.png" alt="Daily Ledger Logo" className="masthead-app-icon" />
            {/* Mobile Sidebar Trigger Button under Logo */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="mobile-side-toggle-btn"
              title="Open Navigation Menu"
              aria-label="Open Navigation Menu"
            >
              <Menu size={13} strokeWidth={ICON_STROKE} aria-hidden="true" style={{ marginRight: '4px' }} />
              <span>Menu</span>
            </button>
          </div>
          <div>
            <div className="masthead-subtag">PERSONAL FINANCE</div>
            <h1 className="masthead-title">
              Daily Ledger<span className="masthead-dot">.</span>
            </h1>
            <p className="masthead-desc">Track • Plan • Grow</p>
          </div>
        </div>

        <div className="masthead-right">
          <div
            className="offline-ready-badge"
            style={{ cursor: isOnline ? 'pointer' : 'default', userSelect: 'none' }}
            title={isOnline ? 'Click to force full sync with cloud' : 'Offline mode · Saved locally'}
            onClick={async () => {
              if (isOnline) {
                toast.info('Syncing all data with MongoDB Atlas...');
                try {
                  const res = await syncTwoWay(true);
                  if (refreshPendingCount) refreshPendingCount();
                  toast.success(`Cloud sync completed! (${res.pulled} downloaded, ${res.synced} uploaded)`);
                } catch (e) {
                  toast.error('Sync failed: ' + (e.response?.data?.message || e.message));
                }
              }
            }}
          >
            <span className={`status-indicator-dot ${isOnline ? 'online' : 'offline'}`} />
            {isOnline
              ? pendingSync > 0
                ? 'Syncing'
                : 'Cloud Synced'
              : 'Offline-ready · Saved on this device'}
            {pendingSync > 0 && <span className="sync-count">({pendingSync})</span>}
          </div>
          <NavLink to="/settings" className="settings-link-btn" title="Settings & Family Invites" aria-label="Settings">
            <Settings size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </NavLink>
        </div>
      </header>

      {/* Main Desktop & Tablet Navigation */}
      <nav className="desktop-nav" aria-label="Main navigation">
        <NavLink to="/" end className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          <LayoutDashboard size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>Overview</span>
        </NavLink>
        <NavLink to="/ledger" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          <Receipt size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>Expenses</span>
        </NavLink>
        <NavLink to="/deposits" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          <TrendingUp size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>Income</span>
        </NavLink>
        <NavLink to="/accounts" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          <Wallet size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>Banks & Assets</span>
        </NavLink>
        <NavLink to="/tools" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          <CreditCard size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>Debts & Loans</span>
        </NavLink>
        <NavLink to="/tasks" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          <Lock size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>Vault & Tasks</span>
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          <ChartNoAxesCombined size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>Reports & Insights</span>
        </NavLink>
        <NavLink
          to="/ai"
          className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}
          style={({ isActive }) => ({
            background: isActive ? 'linear-gradient(105deg, #5145e5 0%, #278bfa 100%)' : 'rgba(56, 189, 248, 0.08)',
            color: isActive ? '#ffffff' : '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.35)',
            fontWeight: 700,
          })}
        >
          <Sparkles size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
          <span>Ledger AI</span>
        </NavLink>
        {user?.role === 'admin' && (
          <NavLink
            to="/admin"
            className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}
            style={({ isActive }) => ({
              color: isActive ? '#38bdf8' : '#f87171',
              fontWeight: 700,
            })}
          >
            <Shield size={16} strokeWidth={ICON_STROKE} aria-hidden="true" />
            <span>Admin</span>
          </NavLink>
        )}
      </nav>

      {/* Main Routed Content Area */}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/deposits" element={<DepositsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/tasks" element={<ProductivityPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/ai" element={<AiPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/developer" element={<DeveloperPage />} />
          {user?.role === 'admin' && <Route path="/admin" element={<AdminPage />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {/* Global App Footer */}
      <footer
        style={{
          borderTop: '1px solid #141a27',
          padding: '24px 16px 80px',
          marginTop: 'auto',
          textAlign: 'center',
          fontSize: '0.82rem',
          color: '#64748b',
        }}
      >
        <div style={{ maxWidth: '980px', margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <span>Daily Ledger · Private in this browser · Cloud Synced</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <NavLink
              to="/developer"
              style={{
                color: '#ffffff',
                fontWeight: 600,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 0',
              }}
            >
              <Code2 size={15} strokeWidth={ICON_STROKE} aria-hidden="true" />
              <span>Developer: Ashikur Rahman</span>
            </NavLink>

            <NavLink to="/settings" style={{ color: '#94a3b8', textDecoration: 'none' }}>
              Settings
            </NavLink>
          </div>
        </div>
      </footer>

      {/* Mobile Bottom Navigation */}
      <nav className="mobile-bottom-nav" aria-label="Quick navigation">
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          <LayoutDashboard size={19} strokeWidth={ICON_STROKE} className="nav-icon" aria-hidden="true" />
          <span>Overview</span>
        </NavLink>
        <NavLink to="/ledger" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Receipt size={19} strokeWidth={ICON_STROKE} className="nav-icon" aria-hidden="true" />
          <span>Expenses</span>
        </NavLink>
        <NavLink to="/deposits" className={({ isActive }) => (isActive ? 'active' : '')}>
          <TrendingUp size={19} strokeWidth={ICON_STROKE} className="nav-icon" aria-hidden="true" />
          <span>Income</span>
        </NavLink>
        <NavLink to="/accounts" className={({ isActive }) => (isActive ? 'active' : '')}>
          <Wallet size={19} strokeWidth={ICON_STROKE} className="nav-icon" aria-hidden="true" />
          <span>Banks</span>
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => (isActive ? 'active' : '')}>
          <ChartNoAxesCombined size={19} strokeWidth={ICON_STROKE} className="nav-icon" aria-hidden="true" />
          <span>Reports</span>
        </NavLink>
      </nav>

      {/* Mobile Drawer / Side Panel Modal */}
      {mobileMenuOpen && (
        <div className="mobile-drawer-overlay" onClick={() => setMobileMenuOpen(false)}>
          <div className="mobile-drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="mobile-drawer-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <img src="/app-logo.png" alt="Daily Ledger Logo" style={{ width: '32px', height: '32px', borderRadius: '8px' }} />
                <div>
                  <div style={{ fontSize: '0.95rem', fontWeight: 800, color: '#f8fafc' }}>Daily Ledger</div>
                  <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Quick Access Panel</div>
                </div>
              </div>
              <button
                type="button"
                className="mobile-drawer-close"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close Navigation Menu"
              >
                <X size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </button>
            </div>

            <div className="mobile-drawer-body">
              <div className="mobile-drawer-section-title">Finance & Tools</div>

              <NavLink
                to="/transactions"
                className={({ isActive }) => `mobile-drawer-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <ListOrdered size={20} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>Transaction List</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Date-grouped expense history</div>
                  </div>
                </div>
                <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </NavLink>

              <NavLink
                to="/tools"
                className={({ isActive }) => `mobile-drawer-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <CreditCard size={20} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>Debts & Loans</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Lending, borrowing & repayments</div>
                  </div>
                </div>
                <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </NavLink>

              <div className="mobile-drawer-section-title" style={{ marginTop: '16px' }}>AI Intelligence</div>
              <NavLink
                to="/ai"
                className={({ isActive }) => `mobile-drawer-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Sparkles size={20} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#38bdf8' }}>Ledger AI Advisor</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Read-only insights, goals & reports</div>
                  </div>
                </div>
                <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </NavLink>

              <div className="mobile-drawer-section-title" style={{ marginTop: '16px' }}>Productivity & Security</div>
              
              <NavLink
                to="/tasks"
                className={({ isActive }) => `mobile-drawer-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Lock size={20} strokeWidth={ICON_STROKE} color="#94a3b8" aria-hidden="true" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>Tasks & Secure Vault</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>To-Do list & Bank/bKash password vault</div>
                  </div>
                </div>
                <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </NavLink>

              {user?.role === 'admin' && (
                <>
                  <div className="mobile-drawer-section-title" style={{ marginTop: '16px' }}>Administration</div>
                  <NavLink
                    to="/admin"
                    className={({ isActive }) => `mobile-drawer-link admin-link ${isActive ? 'active' : ''}`}
                    onClick={() => setMobileMenuOpen(false)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <Shield size={20} strokeWidth={ICON_STROKE} color="#f87171" aria-hidden="true" />
                      <div>
                        <div style={{ fontWeight: 700, fontSize: '0.92rem', color: '#f87171' }}>Admin Control Center</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Users overview & live ledger summaries</div>
                      </div>
                    </div>
                    <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  </NavLink>
                </>
              )}

              <div className="mobile-drawer-section-title" style={{ marginTop: '16px' }}>More Navigation</div>

              <NavLink
                to="/developer"
                className={({ isActive }) => `mobile-drawer-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Code2 size={20} strokeWidth={ICON_STROKE} color="#94a3b8" aria-hidden="true" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>About Developer</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Ashikur Rahman Profile</div>
                  </div>
                </div>
                <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </NavLink>

              <NavLink
                to="/settings"
                className={({ isActive }) => `mobile-drawer-link ${isActive ? 'active' : ''}`}
                onClick={() => setMobileMenuOpen(false)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <Settings size={20} strokeWidth={ICON_STROKE} color="#94a3b8" aria-hidden="true" />
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>Settings & Backup</div>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Profile, invite & full cloud restore</div>
                  </div>
                </div>
                <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </NavLink>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <ToastProvider>
        <ConfirmProvider>
          <AuthProvider>
            <AppContent />
          </AuthProvider>
        </ConfirmProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
