import React from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import DashboardPage from './pages/DashboardPage';
import LedgerPage from './pages/LedgerPage';
import DepositsPage from './pages/DepositsPage';
import AccountsPage from './pages/AccountsPage';
import ToolsPage from './pages/ToolsPage';
import ReportsPage from './pages/ReportsPage';
import SettingsPage from './pages/SettingsPage';
import AdminPage from './pages/AdminPage';
import DeveloperPage from './pages/DeveloperPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import { seedInitialDataIfNeeded } from './db/seedHelper';
import './App.css';

// Seed initial historical data on startup
seedInitialDataIfNeeded();

function AppContent() {
  const { user, loading, isOnline, pendingSync } = useAuth();

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
          <img src="/app-logo.png" alt="Daily Ledger Logo" className="masthead-app-icon" />
          <div>
            <div className="masthead-subtag">PERSONAL FINANCE</div>
            <h1 className="masthead-title">
              Daily Ledger<span className="masthead-dot">.</span>
            </h1>
            <p className="masthead-desc">Track • Plan • Grow</p>
          </div>
        </div>

        <div className="masthead-right">
          <div className="offline-ready-badge">
            <span className={`status-indicator-dot ${isOnline ? 'online' : 'offline'}`} />
            {isOnline ? 'Cloud Synced' : 'Offline-ready · Saved on this device'}
            {pendingSync > 0 && <span className="sync-count">({pendingSync})</span>}
          </div>
          <NavLink to="/settings" className="settings-link-btn" title="Settings & Family Invites">
            ⚙️
          </NavLink>
        </div>
      </header>

      {/* Main Desktop & Tablet Navigation */}
      <nav className="desktop-nav" aria-label="Main navigation">
        <NavLink to="/" end className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          Today
        </NavLink>
        <NavLink to="/ledger" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          Expenses
        </NavLink>
        <NavLink to="/deposits" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          Tk in
        </NavLink>
        <NavLink to="/accounts" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          Banks
        </NavLink>
        <NavLink to="/tools" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          Debt / Loan
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => `nav-btn ${isActive ? 'active' : ''}`}>
          Reports & Insights
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
            🛡️ Admin
          </NavLink>
        )}
      </nav>

      {/* Main Routed Content Area */}
      <main className="main-content">
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/ledger" element={<LedgerPage />} />
          <Route path="/deposits" element={<DepositsPage />} />
          <Route path="/accounts" element={<AccountsPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/reports" element={<ReportsPage />} />
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
                color: '#ef4444',
                fontWeight: 700,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '4px 10px',
                borderRadius: '8px',
                background: 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
              }}
            >
              <span>👨‍💻 Developer: Ashikur Rahman</span>
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
          <span className="nav-icon">⌂</span>
          <span>Home</span>
        </NavLink>
        <NavLink to="/ledger" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon">↗</span>
          <span>Expenses</span>
        </NavLink>
        <NavLink to="/deposits" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon">＋</span>
          <span>Tk in</span>
        </NavLink>
        <NavLink to="/accounts" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon">▤</span>
          <span>Banks</span>
        </NavLink>
        <NavLink to="/tools" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon">৳</span>
          <span className="nav-label-debt">Debt</span>
        </NavLink>
        <NavLink to="/reports" className={({ isActive }) => (isActive ? 'active' : '')}>
          <span className="nav-icon">▥</span>
          <span>Reports</span>
        </NavLink>
      </nav>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <AppContent />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
