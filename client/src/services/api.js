import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

let _accessToken = null;
let _onTokenRefreshed = null;

export const setAccessToken = (token) => { _accessToken = token; };
export const getAccessToken = () => _accessToken;
export const setOnTokenRefreshed = (fn) => { _onTokenRefreshed = fn; };

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true, // send httpOnly refresh cookie
});

// Attach access token to every request
api.interceptors.request.use((config) => {
  if (_accessToken) {
    config.headers.Authorization = `Bearer ${_accessToken}`;
  }
  return config;
});

// Auto-refresh on 401 TOKEN_EXPIRED
let isRefreshing = false;
let refreshSubscribers = [];

const subscribeTokenRefresh = (cb) => refreshSubscribers.push(cb);
const onRefreshed = (token) => { refreshSubscribers.forEach(cb => cb(token)); refreshSubscribers = []; };

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;

    if (error.response?.status === 401 && error.response?.data?.code === 'TOKEN_EXPIRED' && !original._retry) {
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
        const { data } = await axios.post(`${BASE_URL}/auth/refresh`, {}, { withCredentials: true });
        _accessToken = data.accessToken;
        if (_onTokenRefreshed) _onTokenRefreshed(data);
        onRefreshed(data.accessToken);
        isRefreshing = false;
        original.headers.Authorization = `Bearer ${data.accessToken}`;
        return api(original);
      } catch (refreshErr) {
        isRefreshing = false;
        _accessToken = null;
        window.dispatchEvent(new Event('auth:logout'));
        return Promise.reject(refreshErr);
      }
    }

    return Promise.reject(error);
  }
);

export default api;
