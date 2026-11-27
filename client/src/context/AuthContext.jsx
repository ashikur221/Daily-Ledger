import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api, { setAccessToken, setOnTokenRefreshed, requestTokenRefresh } from '../services/api';
import { syncTwoWay, initNetworkSync, getPendingCount, clearLocalUserData, flushSyncQueue } from '../services/syncService';
import { useToast } from './ToastContext';

const ACTIVE_USER_KEY = 'daily_ledger_active_user_id';
const getUserKey = (u) => String(u?._id || u?.id || u?.email || '').toLowerCase();

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

  // Try to restore session via unified token refresh
  const restoreSession = useCallback(async () => {
    let storedUser = null;
    const storedAuth = localStorage.getItem('daily_ledger_auth');
    if (storedAuth) {
      try {
        const parsed = JSON.parse(storedAuth);
        if (parsed.user) {
          storedUser = parsed.user;
          setUser(storedUser);
        }
      } catch {}
    }

    // If completely offline, keep storedUser and don't make network calls
    if (!navigator.onLine) {
      if (storedUser) setUser(storedUser);
      setLoading(false);
      return;
    }

    try {
      const data = await requestTokenRefresh();
      setUser(data.user);

      const newKey = getUserKey(data.user);
      const prevKey = localStorage.getItem(ACTIVE_USER_KEY);
      let needsFullPull = false;
      if (newKey && (!prevKey || prevKey !== newKey)) {
        await clearLocalUserData();
        localStorage.setItem(ACTIVE_USER_KEY, newKey);
        needsFullPull = true;
      }

      // Run two-way sync on session restore (full pull if user switched or first isolation check)
      syncTwoWay(needsFullPull)
        .then(({ pulled }) => {
          refreshPendingCount();
          if (pulled > 0) {
            toast.info(`Updated with ${pulled} change(s) from cloud.`);
          }
        })
        .catch(() => {});
    } catch (err) {
      // On any background refresh failure, retain cached offline user session!
      // NEVER kick the user to login while they are using the app
      if (storedUser) {
        setUser(storedUser);
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
    window.addEventListener('daily_ledger:sync_completed', refreshPendingCount);

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
      window.removeEventListener('daily_ledger:sync_completed', refreshPendingCount);
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

    const newKey = getUserKey(data.user);
    const prevKey = localStorage.getItem(ACTIVE_USER_KEY);
    let needsFullPull = false;
    if (newKey && (!prevKey || prevKey !== newKey)) {
      await clearLocalUserData();
      localStorage.setItem(ACTIVE_USER_KEY, newKey);
      needsFullPull = true;
    }

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

    // Two-way sync on login (force full pull if switching accounts)
    syncTwoWay(needsFullPull)
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
    await clearLocalUserData();
    const newKey = getUserKey(data.user);
    if (newKey) {
      localStorage.setItem(ACTIVE_USER_KEY, newKey);
    }
    syncTwoWay(true).then(() => refreshPendingCount()).catch(() => {});
    return data.user;
  };

  const logout = async () => {
    try {
      if (navigator.onLine) {
        await flushSyncQueue().catch(() => {});
      }
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
    await clearLocalUserData().catch(() => {});
    localStorage.removeItem(ACTIVE_USER_KEY);
    localStorage.removeItem('daily_ledger_auth');
    setPendingSync(0);
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
