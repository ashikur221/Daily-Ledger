import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App.jsx';

// Register PWA service worker for offline support with auto-reload on update
registerSW({
  immediate: true,
  onRegisteredSW(swUrl, r) {
    if (r) {
      // Check for updates every 15 minutes
      setInterval(() => {
        r.update();
      }, 15 * 60 * 1000);
    }
  },
  onNeedRefresh() {
    // Automatically activate new service worker and refresh
    window.location.reload();
  },
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
