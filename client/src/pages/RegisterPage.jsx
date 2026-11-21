import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

export default function RegisterPage() {
  const { register } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [name, setName] = useState('');
  const [email, setEmail] = useState(searchParams.get('email') || '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [inviteToken, setInviteToken] = useState(searchParams.get('token') || '');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Please enter your full name');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email address');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters long');
      toast.error('Password must be at least 8 characters');
      return;
    }
    if (!inviteToken.trim()) {
      setError('Invite token is required');
      toast.error('Invite token is required');
      return;
    }

    setLoading(true);
    try {
      await register(name.trim(), email.trim(), password, inviteToken.trim());
      toast.success('Account created successfully! Welcome to Daily Ledger!');
      navigate('/');
    } catch (err) {
      const msg = err.response?.data?.message || 'Registration failed';
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
            Join Ledger<span className="masthead-dot">.</span>
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
            <label htmlFor="reg-name" className="auth-label">
              Full Name
            </label>
            <div className="auth-input-wrap">
              <input
                id="reg-name"
                type="text"
                className="auth-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Ashikur Rahman"
                required
                autoFocus
              />
            </div>
          </div>

          <div className="auth-form-group">
            <label htmlFor="reg-email" className="auth-label">
              Email Address
            </label>
            <div className="auth-input-wrap">
              <input
                id="reg-email"
                type="email"
                className="auth-input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                autoComplete="email"
              />
            </div>
          </div>

          <div className="auth-form-row">
            <div className="auth-form-group">
              <label htmlFor="reg-password" className="auth-label">
                Password
              </label>
              <div className="auth-input-wrap">
                <input
                  id="reg-password"
                  type={showPassword ? 'text' : 'password'}
                  className="auth-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 chars"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div className="auth-form-group">
              <label htmlFor="reg-confirm" className="auth-label">
                Confirm
              </label>
              <div className="auth-input-wrap">
                <input
                  id="reg-confirm"
                  type={showPassword ? 'text' : 'password'}
                  className="auth-input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Repeat"
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>
          </div>

          <div className="auth-show-pass-check">
            <button
              type="button"
              className="auth-toggle-inline-btn"
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? 'Hide Passwords' : 'Show Passwords'}
            </button>
          </div>

          <div className="auth-form-group">
            <label htmlFor="reg-token" className="auth-label">
              Invite Token
            </label>
            <div className="auth-input-wrap">
              <input
                id="reg-token"
                type="text"
                className="auth-input auth-token-input"
                value={inviteToken}
                onChange={(e) => setInviteToken(e.target.value)}
                placeholder="Paste token provided by admin"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            className="auth-submit-btn"
            disabled={loading}
            id="register-submit"
          >
            {loading ? (
              <span className="auth-spinner-wrap">
                <span className="spinner-sm" /> Creating account...
              </span>
            ) : (
              'Create Account →'
            )}
          </button>
        </form>

        <div className="auth-footer-block">
          <p className="auth-footer-text">
            Already have an account?{' '}
            <Link to="/login" className="auth-link">
              Sign in instead
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
