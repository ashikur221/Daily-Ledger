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

// Auto-refresh on 401 for any authenticated endpoint
let isRefreshing = false;
let refreshSubscribers = [];

const subscribeTokenRefresh = (cb) => refreshSubscribers.push(cb);
const onRefreshed = (token) => { refreshSubscribers.forEach(cb => cb(token)); refreshSubscribers = []; };

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

      if (isRefreshing) {
        return new Promise((resolve) => {
          subscribeTokenRefresh((token) => {
            original.headers.Authorization = `Bearer ${token}`;
            resolve(api(original));
          });
        });
      }

      isRefreshing = true;
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

        if (data.refreshToken && localStorage.getItem('daily_ledger_remember_me') === 'true') {
          localStorage.setItem('daily_ledger_auth', JSON.stringify({ refreshToken: data.refreshToken, user: data.user }));
        }
        if (_onTokenRefreshed) _onTokenRefreshed(data);
        onRefreshed(data.accessToken);
        isRefreshing = false;
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        isRefreshing = false;
        setAccessToken(null);

        // Only force logout if the server explicitly returned an auth rejection (401 or 403)
        // If offline / network failure, DO NOT destroy user session
        if (refreshErr.response?.status === 401 || refreshErr.response?.status === 403) {
          localStorage.removeItem('daily_ledger_auth');
          window.dispatchEvent(new Event('auth:logout'));
        }
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
