import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setAccessToken, setOnTokenRefreshed } from '../services/api';
import { syncTwoWay, initNetworkSync } from '../services/syncService';
import { useToast } from './ToastContext';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const toast = useToast();
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  // Try to restore session via refresh token (cookie or stored token if remember me was checked)
  const restoreSession = useCallback(async () => {
    try {
      let refreshBody = {};
      const storedAuth = localStorage.getItem('daily_ledger_auth');
      if (storedAuth) {
        try {
          const parsed = JSON.parse(storedAuth);
          if (parsed.refreshToken) refreshBody.refreshToken = parsed.refreshToken;
        } catch {}
      }

      const { data } = await api.post('/auth/refresh', refreshBody);
      setAccessToken(data.accessToken);
      setUser(data.user);

      if (data.refreshToken && localStorage.getItem('daily_ledger_remember_me') === 'true') {
        localStorage.setItem('daily_ledger_auth', JSON.stringify({ refreshToken: data.refreshToken, user: data.user }));
      }

      // Run two-way delta sync on session restore (pull updates from other devices)
      syncTwoWay().then(({ pulled, synced }) => {
        refreshPendingCount();
        if (pulled > 0) {
          toast.info(`Updated with ${pulled} change(s) from cloud.`);
        }
      });
    } catch {
      localStorage.removeItem('daily_ledger_auth');
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshPendingCount = async () => {
    const { getPendingCount } = await import('../services/syncService');
    const count = await getPendingCount();
    setPendingSync(count);
  };

  useEffect(() => {
    // On token refresh, update user state
    setOnTokenRefreshed((data) => setUser(data.user));

    // Listen for forced logout (e.g., refresh token expired)
    const handleLogout = () => { setUser(null); setAccessToken(null); };
    window.addEventListener('auth:logout', handleLogout);

    // Network status
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online! Syncing data with cloud...');
    };
    const handleOffline = () => {
      setIsOnline(false);
      toast.warning('You are offline. Changes will save locally and sync when reconnected.');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Init auto-sync on reconnect or focus
    const cleanup = initNetworkSync(({ synced, pulled }) => {
      refreshPendingCount();
      if (synced > 0 || pulled > 0) {
        toast.info(
          `Sync complete: ${synced ? `${synced} uploaded` : ''}${
            synced && pulled ? ', ' : ''
          }${pulled ? `${pulled} updated from cloud` : ''}`
        );
      }
    });

    restoreSession();

    return () => {
      window.removeEventListener('auth:logout', handleLogout);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      cleanup();
    };
  }, [restoreSession]);

  const login = async (email, password, rememberMe = true) => {
    const { data } = await api.post('/auth/login', { email, password, rememberMe });
    setAccessToken(data.accessToken);
    setUser(data.user);

    if (rememberMe) {
      localStorage.setItem('daily_ledger_remember_me', 'true');
      localStorage.setItem('daily_ledger_remembered_email', email);
      if (data.refreshToken) {
        localStorage.setItem('daily_ledger_auth', JSON.stringify({ refreshToken: data.refreshToken, user: data.user }));
      }
    } else {
      localStorage.removeItem('daily_ledger_remember_me');
      localStorage.removeItem('daily_ledger_remembered_email');
      localStorage.removeItem('daily_ledger_auth');
    }

    // Two-way sync on login
    syncTwoWay().then(({ pulled }) => {
      refreshPendingCount();
      if (pulled > 0) {
        toast.info(`Synced ${pulled} record(s) from cloud.`);
      }
    });
    return data.user;
  };

  const register = async (name, email, password, inviteToken) => {
    const { data } = await api.post('/auth/register', { name, email, password, inviteToken });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try {
      let refreshBody = {};
      const storedAuth = localStorage.getItem('daily_ledger_auth');
      if (storedAuth) {
        try {
          const parsed = JSON.parse(storedAuth);
          if (parsed.refreshToken) refreshBody.refreshToken = parsed.refreshToken;
        } catch {}
      }
      await api.post('/auth/logout', refreshBody);
    } catch {}
    localStorage.removeItem('daily_ledger_auth');
    setAccessToken(null);
    setUser(null);
    toast.info('Signed out successfully');
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, pendingSync, setPendingSync, refreshPendingCount, isOnline }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
