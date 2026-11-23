import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

let _accessToken = null;
try {
  _accessToken = sessionStorage.getItem('daily_ledger_access_token');
} catch {}

let _onTokenRefreshed = null;

export const setAccessToken = (token) => {
  _accessToken = token;
  try {
    if (token) {
      sessionStorage.setItem('daily_ledger_access_token', token);
    } else {
      sessionStorage.removeItem('daily_ledger_access_token');
    }
  } catch {}
};

export const getAccessToken = () => {
  if (!_accessToken) {
    try {
      _accessToken = sessionStorage.getItem('daily_ledger_access_token');
    } catch {}
  }
  return _accessToken;
};

export const setOnTokenRefreshed = (fn) => { _onTokenRefreshed = fn; };

let _refreshPromise = null;

/**
 * Unified singleton for token refreshing across the entire app.
 * Prevents race conditions and multiple conflicting refresh calls.
 */
export const requestTokenRefresh = async () => {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    try {
      let refreshBody = {};
      const storedAuth = localStorage.getItem('daily_ledger_auth');
      if (storedAuth) {
        try {
          const parsed = JSON.parse(storedAuth);
          if (parsed.refreshToken) refreshBody.refreshToken = parsed.refreshToken;
        } catch {}
      }

      const { data } = await axios.post(`${BASE_URL}/auth/refresh`, refreshBody, { withCredentials: true });
      setAccessToken(data.accessToken);

      if (data.refreshToken) {
        try {
          const currentAuth = JSON.parse(localStorage.getItem('daily_ledger_auth') || '{}');
          localStorage.setItem(
            'daily_ledger_auth',
            JSON.stringify({ ...currentAuth, refreshToken: data.refreshToken, user: data.user })
          );
        } catch {}
      }

      if (_onTokenRefreshed) _onTokenRefreshed(data);
      return data;
    } finally {
      _refreshPromise = null;
    }
  })();

  return _refreshPromise;
};

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // send httpOnly refresh cookie
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-refresh on 401 for any authenticated endpoint using unified singleton
api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    const isAuthEndpoint =
      original?.url?.includes('/auth/login') ||
      original?.url?.includes('/auth/register') ||
      original?.url?.includes('/auth/refresh');

    if (error.response?.status === 401 && !original?._retry && !isAuthEndpoint) {
      original._retry = true;

      try {
        const data = await requestTokenRefresh();
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
