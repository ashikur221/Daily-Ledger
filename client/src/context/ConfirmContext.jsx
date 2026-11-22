import React, { createContext, useContext, useState, useRef, useCallback, useEffect } from 'react';

const ConfirmContext = createContext(null);

export const ConfirmProvider = ({ children }) => {
  const [dialogState, setDialogState] = useState({
    isOpen: false,
    title: 'Confirm Action',
    message: 'Are you sure you want to proceed?',
    confirmText: 'Delete',
    cancelText: 'Cancel',
    danger: true,
  });

  const resolverRef = useRef(null);

  const confirm = useCallback(({
    title = 'Confirm Action',
    message = 'Are you sure you want to proceed?',
    confirmText = 'Delete',
    cancelText = 'Cancel',
    danger = true,
  } = {}) => {
    setDialogState({
      isOpen: true,
      title,
      message,
      confirmText,
      cancelText,
      danger,
    });

    return new Promise((resolve) => {
      resolverRef.current = resolve;
    });
  }, []);

  const handleConfirm = () => {
    setDialogState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(true);
      resolverRef.current = null;
    }
  };

  const handleCancel = () => {
    setDialogState((prev) => ({ ...prev, isOpen: false }));
    if (resolverRef.current) {
      resolverRef.current(false);
      resolverRef.current = null;
    }
  };

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && dialogState.isOpen) {
        handleCancel();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [dialogState.isOpen]);

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {dialogState.isOpen && (
        <div
          className="modal-overlay"
          onClick={handleCancel}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px',
            background: 'rgba(0, 0, 0, 0.78)',
            backdropFilter: 'blur(8px)',
            animation: 'fadeIn 0.15s ease-out',
          }}
        >
          <div
            className="modal"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '440px',
              width: '100%',
              background: '#090d16',
              border: dialogState.danger ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid #232a3b',
              borderRadius: '16px',
              padding: '24px',
              boxShadow: dialogState.danger
                ? '0 10px 40px rgba(0, 0, 0, 0.9), 0 0 25px rgba(239, 68, 68, 0.15)'
                : '0 10px 40px rgba(0, 0, 0, 0.9)',
              animation: 'slideUp 0.18s ease-out',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' }}>
              <div
                style={{
                  width: '42px',
                  height: '42px',
                  borderRadius: '12px',
                  background: dialogState.danger ? 'rgba(239, 68, 68, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                  border: dialogState.danger ? '1px solid rgba(239, 68, 68, 0.35)' : '1px solid rgba(56, 189, 248, 0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.25rem',
                  flexShrink: 0,
                }}
              >
                {dialogState.danger ? '⚠️' : '❓'}
              </div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 750, color: '#f8fafc', margin: 0, letterSpacing: '-0.01em' }}>
                {dialogState.title}
              </h3>
            </div>

            <p style={{ fontSize: '0.88rem', color: '#94a3b8', lineHeight: 1.55, margin: '0 0 22px' }}>
              {dialogState.message}
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  height: '40px',
                  padding: '0 18px',
                  borderRadius: '10px',
                  background: '#151b26',
                  border: '1px solid #232d3f',
                  color: '#cbd5e1',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                onMouseOver={(e) => (e.currentTarget.style.background = '#1a2230')}
                onMouseOut={(e) => (e.currentTarget.style.background = '#151b26')}
              >
                {dialogState.cancelText}
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                autoFocus
                style={{
                  height: '40px',
                  padding: '0 20px',
                  borderRadius: '10px',
                  background: dialogState.danger
                    ? 'linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)'
                    : 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
                  border: 'none',
                  color: '#ffffff',
                  fontWeight: 700,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                  boxShadow: dialogState.danger ? '0 0 16px rgba(239, 68, 68, 0.4)' : 'none',
                  transition: 'all 0.15s ease',
                }}
                onMouseOver={(e) => (e.currentTarget.style.filter = 'brightness(1.15)')}
                onMouseOut={(e) => (e.currentTarget.style.filter = 'none')}
              >
                {dialogState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside a ConfirmProvider');
  return ctx;
};
