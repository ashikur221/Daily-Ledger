import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function LoginPage() {
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const cleanEmail = email.trim();
    if (!cleanEmail) {
      setError('Please enter your email address');
      return;
    }
    if (!password) {
      setError('Please enter your password');
      return;
    }

    setLoading(true);
    try {
      await login(cleanEmail, password);
      toast.success('Welcome back! Logged in successfully.');
      navigate('/');
    } catch (err) {
      const msg =
        err.response?.status === 401
          ? "Credentials don't match! Please check your email and password."
          : err.response?.data?.message || 'Login failed. Please try again.';
      setError(msg);
      toast.error(msg);
    } finally {
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
