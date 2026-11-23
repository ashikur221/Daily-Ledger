import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function LoginPage() {
  const { login, isOnline } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState(searchParams.get('email') || localStorage.getItem('daily_ledger_remembered_email') || '');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [isServerWaking, setIsServerWaking] = useState(false);

  // Background ping to warm up backend on Render free tier immediately
  useEffect(() => {
    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    fetch(`${apiUrl}/health`).catch(() => {});
  }, []);

  const cachedUser = (() => {
    try {
      const stored = localStorage.getItem('daily_ledger_auth');
      return stored ? JSON.parse(stored).user : null;
    } catch {
      return null;
    }
  })();

  const handleOfflineEnter = async () => {
    if (!cachedUser) return;
    try {
      setLoading(true);
      await login(cachedUser.email, '', true);
      navigate('/');
    } catch (err) {
      toast.error(err.message || 'Could not resume offline session.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return; // prevent multiple simultaneous attempts
    setError('');

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please enter your email address');
      return;
    }
    if (!password && isOnline) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    setIsServerWaking(false);

    // If server takes longer than 2.5s, it is likely waking up from cold sleep
    const wakeTimer = setTimeout(() => {
      setIsServerWaking(true);
    }, 2500);

    try {
      await login(cleanEmail, password, rememberMe);
      clearTimeout(wakeTimer);
      toast.success('Welcome back! Logged in successfully.');
      navigate('/');
    } catch (err) {
      clearTimeout(wakeTimer);
      setIsServerWaking(false);
      const msg =
        err.response?.status === 401
          ? "Credentials don't match! Please check your email and password."
          : err.response?.data?.message || err.message || 'Login failed. Please try again.';
      setError(msg);
      toast.error(msg);
    } finally {
      clearTimeout(wakeTimer);
      setIsServerWaking(false);
      setLoading(false);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        {/* Glowing Brand Icon */}
        <div className="auth-brand-wrap">
          <div className="auth-brand-ring">
            <img src="/app-logo.png" alt="Daily Ledger" className="auth-brand-img" />
          </div>
          <h1 className="auth-title">
            Daily Ledger<span className="masthead-dot">.</span>
          </h1>
          <p className="auth-subtitle">Track • Plan • Grow</p>
        </div>

        {!isOnline && (
          <div
            style={{
              background: 'rgba(234, 179, 8, 0.12)',
              border: '1px solid rgba(234, 179, 8, 0.35)',
              borderRadius: '8px',
              padding: '10px 14px',
              marginBottom: '16px',
              fontSize: '0.84rem',
              color: '#fef08a',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}>
              <span>⚡</span>
              <span>Device is currently offline</span>
            </div>
            <p style={{ margin: 0, fontSize: '0.8rem', opacity: 0.9 }}>
              You can still access your ledger and recorded data offline on this device.
            </p>
            {cachedUser && (
              <button
                type="button"
                onClick={handleOfflineEnter}
                style={{
                  marginTop: '6px',
                  background: '#f59e0b',
                  color: '#000',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '7px 12px',
                  fontSize: '0.82rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                Continue as {cachedUser.name || cachedUser.email} (Offline)
              </button>
            )}
          </div>
        )}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {error && (
            <div className="auth-error-banner" role="alert">
              <span className="auth-error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <div className="auth-form-group">
            <label htmlFor="login-email" className="auth-label">
              Email Address
            </label>
            <div className="auth-input-wrap">
              <input
                id="login-email"
                type="email"
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                autoComplete="email"
                autoFocus
              />
            </div>
          </div>

          <div className="auth-form-group">
            <div className="auth-label-row">
              <label htmlFor="login-password" className="auth-label">
                Password
              </label>
            </div>
            <div className="auth-input-wrap">
              <input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                className="auth-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                autoComplete="current-password"
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 0 16px', userSelect: 'none' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.86rem', color: '#cbd5e1' }}>
              <input
                type="checkbox"
                id="login-remember-me"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                style={{ width: '16px', height: '16px', accentColor: '#38bdf8', cursor: 'pointer' }}
              />
              <span>Remember me on this device</span>
            </label>
          </div>

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
            id="login-submit"
          >
            {loading ? (
              <span className="auth-spinner-wrap">
                <span className="spinner-sm" /> Signing in...
              </span>
            ) : (
              'Sign In →'
            )}
          </button>

          {isServerWaking && (
            <div
              style={{
                marginTop: '12px',
                padding: '10px 14px',
                background: 'rgba(56, 189, 248, 0.08)',
                border: '1px solid rgba(56, 189, 248, 0.25)',
                borderRadius: '8px',
                fontSize: '0.78rem',
                color: '#7dd3fc',
                textAlign: 'center',
                lineHeight: 1.4,
              }}
            >
              ⏳ Connecting to cloud server... Waking up cloud backend, please wait a moment.
            </div>
          )}
        </form>

        <div className="auth-footer-block">
          <p className="auth-footer-text">
            Invited by a family member?{' '}
            <Link to="/register" className="auth-link">
              Create your account
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
