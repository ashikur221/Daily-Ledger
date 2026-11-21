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

  // Try to restore session via refresh token (httpOnly cookie)
  const restoreSession = useCallback(async () => {
    try {
      const { data } = await api.post('/auth/refresh');
      setAccessToken(data.accessToken);
      setUser(data.user);
      // Run two-way delta sync on session restore (pull updates from other devices)
      syncTwoWay().then(({ pulled, synced }) => {
        refreshPendingCount();
        if (pulled > 0) {
          toast.info(`Updated with ${pulled} change(s) from cloud.`);
        }
      });
    } catch {
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

  const login = async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    setAccessToken(data.accessToken);
    setUser(data.user);
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
    try { await api.post('/auth/logout'); } catch {}
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
