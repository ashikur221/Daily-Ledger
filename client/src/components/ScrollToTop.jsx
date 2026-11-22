import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Automatically scrolls window and scrollable app containers to top
 * whenever the route/page changes.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    // 1. Immediate reset of window scroll
    try {
      window.scrollTo({
        top: 0,
        left: 0,
        behavior: 'instant',
      });
    } catch {
      window.scrollTo(0, 0);
    }

    // 2. Reset documentElement and body (critical for mobile WebViews / PWA / iOS)
    if (document.documentElement) {
      document.documentElement.scrollTop = 0;
    }
    if (document.body) {
      document.body.scrollTop = 0;
    }

    // 3. Reset scroll position on common content wrappers
    const containers = document.querySelectorAll('.app-shell, .main-content, .pitch-dashboard, main');
    containers.forEach((el) => {
      if (el && el.scrollTop > 0) {
        el.scrollTop = 0;
      }
    });
  }, [pathname]);

  return null;
}
