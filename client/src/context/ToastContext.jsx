import React, { createContext, useContext, useState, useCallback } from 'react';
import { CircleCheck, CircleAlert, AlertTriangle, Info } from 'lucide-react';
import { ICON_STROKE } from '../components/AppIcons';

const ToastContext = createContext(null);

const ToastIcon = ({ type }) => {
  switch (type) {
    case 'success':
      return <CircleCheck size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />;
    case 'error':
      return <CircleAlert size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />;
    case 'warning':
      return <AlertTriangle size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />;
    case 'info':
    default:
      return <Info size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />;
  }
};

const getCategoryLabel = (type) => {
  switch (type) {
    case 'success':
      return 'Success';
    case 'error':
      return 'Action Error';
    case 'warning':
      return 'Notice';
    case 'info':
    default:
      return 'Information';
  }
};

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info', duration = 4200) => {
    const id = Date.now() + Math.random().toString(36).substring(2, 9);
    const newToast = { id, message, type, duration };

    setToasts((prev) => [...prev, newToast]);

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }
    return id;
  }, [removeToast]);

  const toast = {
    success: (msg, duration) => showToast(msg, 'success', duration),
    error: (msg, duration) => showToast(msg, 'error', duration),
    info: (msg, duration) => showToast(msg, 'info', duration),
    warning: (msg, duration) => showToast(msg, 'warning', duration),
    remove: removeToast,
  };

  return (
    <ToastContext.Provider value={{ toast, showToast, removeToast }}>
      {children}
      <div className="toast-container" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-popup toast-${t.type}`}>
            <div className={`toast-icon-box toast-icon-${t.type}`}>
              <ToastIcon type={t.type} />
            </div>

            <div className="toast-body">
              <div className="toast-label">{getCategoryLabel(t.type)}</div>
              <div className="toast-content">{t.message}</div>
            </div>

            <button
              className="toast-close-btn"
              onClick={() => removeToast(t.id)}
              aria-label="Close notification"
              title="Close"
            >
              ✕
            </button>

            {t.duration > 0 && (
              <div
                className={`toast-progress toast-progress-${t.type}`}
                style={{ animationDuration: `${t.duration}ms` }}
              />
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context.toast;
};

export default ToastContext;
