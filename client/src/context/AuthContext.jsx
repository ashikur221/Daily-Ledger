import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setAccessToken, setOnTokenRefreshed } from '../services/api';
import { syncTwoWay, initNetworkSync, getPendingCount } from '../services/syncService';
import { useToast } from './ToastContext';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const toast = useToast();

  // Initialize user synchronously from localStorage if available so offline loads render immediately
  const [user, setUser] = useState(() => {
    try {
      const stored = localStorage.getItem('daily_ledger_auth');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.user) return parsed.user;
      }
    } catch {}
    return null;
  });

  const [loading, setLoading] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  // Try to restore session via refresh token (cookie or stored token if remember me was checked)
  const restoreSession = useCallback(async () => {
    let storedUser = null;
    let refreshBody = {};
    const storedAuth = localStorage.getItem('daily_ledger_auth');
    if (storedAuth) {
      try {
        const parsed = JSON.parse(storedAuth);
        if (parsed.user) {
          storedUser = parsed.user;
          setUser(storedUser);
        }
        if (parsed.refreshToken) refreshBody.refreshToken = parsed.refreshToken;
      } catch {}
    }

    // If completely offline, keep storedUser and don't make network calls
    if (!navigator.onLine) {
      if (storedUser) setUser(storedUser);
      setLoading(false);
      return;
    }

    try {
      const { data } = await api.post('/auth/refresh', refreshBody);
      setAccessToken(data.accessToken);
      setUser(data.user);

      if (data.refreshToken && localStorage.getItem('daily_ledger_remember_me') === 'true') {
        localStorage.setItem('daily_ledger_auth', JSON.stringify({ refreshToken: data.refreshToken, user: data.user }));
      } else if (localStorage.getItem('daily_ledger_remember_me') === 'true' && storedUser) {
        localStorage.setItem('daily_ledger_auth', JSON.stringify({ ...JSON.parse(storedAuth || '{}'), user: data.user }));
      }

      // Run two-way delta sync on session restore (pull updates from other devices)
      syncTwoWay()
        .then(({ pulled }) => {
          refreshPendingCount();
          if (pulled > 0) {
            toast.info(`Updated with ${pulled} change(s) from cloud.`);
          }
        })
        .catch(() => {});
    } catch (err) {
      const isNetworkError = !err.response || err.code === 'ERR_NETWORK' || !navigator.onLine;
      if (isNetworkError && storedUser) {
        // Network unreachable: retain cached offline session!
        setUser(storedUser);
      } else if (err.response?.status === 401 || err.response?.status === 403) {
        // Token was explicitly rejected by backend
        localStorage.removeItem('daily_ledger_auth');
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const refreshPendingCount = async () => {
    try {
      const count = await getPendingCount();
      setPendingSync(count);
    } catch {}
  };

  useEffect(() => {
    // On token refresh, update user state
    setOnTokenRefreshed((data) => setUser(data.user));

    // Listen for forced logout (e.g., refresh token expired)
    const handleLogout = () => {
      setUser(null);
      setAccessToken(null);
    };
    window.addEventListener('auth:logout', handleLogout);

    // Network status
    const handleOnline = () => {
      setIsOnline(true);
      toast.success('Back online! Syncing data with cloud...');
      restoreSession();
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
  }, [restoreSession, toast]);

  const login = async (email, password, rememberMe = true) => {
    if (!navigator.onLine) {
      const storedAuth = localStorage.getItem('daily_ledger_auth');
      if (storedAuth) {
        try {
          const parsed = JSON.parse(storedAuth);
          if (parsed.user && parsed.user.email?.toLowerCase() === email.trim().toLowerCase()) {
            setUser(parsed.user);
            toast.warning('Offline Mode: Signed in with cached credentials on this device.');
            return parsed.user;
          }
        } catch {}
      }
      throw new Error('You are currently offline. Connect to the internet or sign in with your remembered account.');
    }

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
    syncTwoWay()
      .then(({ pulled }) => {
        refreshPendingCount();
        if (pulled > 0) {
          toast.info(`Synced ${pulled} record(s) from cloud.`);
        }
      })
      .catch(() => {});

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
      if (navigator.onLine) {
        await api.post('/auth/logout', refreshBody);
      }
    } catch {}
    localStorage.removeItem('daily_ledger_auth');
    setAccessToken(null);
    setUser(null);
    toast.info('Signed out successfully');
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        pendingSync,
        setPendingSync,
        refreshPendingCount,
        isOnline,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
};
