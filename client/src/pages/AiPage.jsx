import React, { useState, useEffect, useRef } from 'react';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import MarkdownRenderer from '../components/MarkdownRenderer';
import db from '../db/localDb';

export default function AiPage() {
  const { user } = useAuth();
  const toast = useToast();

  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [financialReport, setFinancialReport] = useState(null);
  const [reportLoading, setReportLoading] = useState(false);

  // Goal Calculator Form State
  const [goalForm, setGoalForm] = useState({
    goalName: 'Emergency Fund',
    targetAmount: '50000',
    targetMonths: '6',
    allocatedSavings: '0',
  });
  const [goalResult, setGoalResult] = useState(null);
  const [goalCalculating, setGoalCalculating] = useState(false);

  const messagesEndRef = useRef(null);

  // Suggested prompt chips
  const quickPrompts = [
    { label: '📊 Analyze My Spending', query: 'Can you analyze my top spending categories and tell me where I can cut costs?' },
    { label: '🛡️ Emergency Fund Plan', query: 'How much should I set aside for an emergency fund based on my actual expenses?' },
    { label: '💡 Boost Savings Rate', query: 'What is my current savings rate, and what practical steps will help increase it?' },
    { label: '🎯 Plan Financial Goal', query: 'I want to plan a savings goal. How much can I comfortably save each month without debt risk?' },
    { label: '📑 Monthly Briefing', query: 'Please give me an executive summary of my financial health, net worth, and cash flow.' },
  ];

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const loadConversations = async () => {
    try {
      const { data } = await api.get('/ai/conversations');
      if (data && data.conversations) {
        setConversations(data.conversations);
      }
    } catch (err) {
      console.warn('Could not load AI conversations:', err);
    }
  };

  const handleSelectConversation = async (id) => {
    try {
      setLoading(true);
      const { data } = await api.get(`/ai/conversations/${id}`);
      if (data && data.conversation) {
        setConversationId(data.conversation._id);
        setMessages(data.conversation.messages || []);
        setShowHistoryDrawer(false);
      }
    } catch (err) {
      toast.error('Failed to load conversation');
    } finally {
      setLoading(false);
    }
  };

  const handleStartNewChat = () => {
    setConversationId(null);
    setMessages([]);
    setPrompt('');
    setShowHistoryDrawer(false);
  };

  const handleDeleteConversation = async (e, id) => {
    e.stopPropagation();
    try {
      await api.delete(`/ai/conversations/${id}`);
      setConversations((prev) => prev.filter((c) => c._id !== id));
      if (conversationId === id) {
        handleStartNewChat();
      }
      toast.info('Conversation removed');
    } catch (err) {
      toast.error('Failed to delete conversation');
    }
  };

  const handleSendMessage = async (textToSend = null) => {
    const text = (textToSend || prompt).trim();
    if (!text || loading) return;

    // Optimistically push user message
    const tempUserMsg = {
      role: 'user',
      content: text,
      timestamp: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    setPrompt('');
    setLoading(true);

    try {
      const { data } = await api.post('/ai/chat', {
        prompt: text,
        conversationId,
      });

      if (data) {
        setConversationId(data.conversationId);
        setMessages((prev) => [
          ...prev,
          {
            role: 'assistant',
            content: data.reply,
            timestamp: new Date().toISOString(),
            metadata: { provider: data.provider },
          },
        ]);
        loadConversations();
      }
    } catch (err) {
      console.warn('AI request failed or offline:', err);
      let offlineSummary = '';
      try {
        const txs = (await db.transactions?.toArray()) || [];
        const activeTxs = txs.filter((t) => !t.isDeleted);
        const totalExpense = activeTxs
          .filter((t) => t.type === 'expense')
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const totalIncome = activeTxs
          .filter((t) => t.type === 'income' || t.type === 'deposit')
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
        const netCash = totalIncome - totalExpense;

        offlineSummary =
          `📱 **Phone Offline Mode (No Wi-Fi / Data)**\n\n` +
          `You are currently offline. Conversational responses with Google Gemini require an internet connection, but your phone's stored ledger data remains 100% accessible:\n\n` +
          `* **Local Offline Income:** ৳${totalIncome.toLocaleString('en-US')}\n` +
          `* **Local Offline Outflow:** ৳${totalExpense.toLocaleString('en-US')}\n` +
          `* **Net Balance:** ৳${netCash.toLocaleString('en-US')}\n` +
          `* **Local Records on Phone:** ${activeTxs.length} transactions stored\n\n` +
          `*Tip: Connect your phone to Wi-Fi to chat freely with Gemini and sync your pending transactions with the cloud!*`;
      } catch (dbErr) {
        offlineSummary =
          `📱 **Phone Offline Mode (No Wi-Fi / Data)**\n\n` +
          `Your phone is not connected to Wi-Fi or mobile data. Google Gemini requires an internet connection to generate conversational answers.\n\n` +
          `Your recorded expenses and income remain safely stored on this phone and will automatically sync when you reconnect.`;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: offlineSummary,
          timestamp: new Date().toISOString(),
          metadata: { provider: 'client-offline-storage' },
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleEvaluateGoal = async (e) => {
    e.preventDefault();
    setGoalCalculating(true);
    try {
      const { data } = await api.post('/ai/goals', goalForm);
      if (data && data.plan) {
        setGoalResult(data.plan);
      }
    } catch (err) {
      // Offline fallback calculation for Goal Planner on phone
      const target = parseFloat(goalForm.targetAmount) || 0;
      const months = Math.max(1, parseInt(goalForm.targetMonths, 10) || 1);
      const allocated = parseFloat(goalForm.allocatedSavings) || 0;
      const remaining = Math.max(0, target - allocated);
      const monthly = Math.ceil(remaining / months);

      setGoalResult({
        goalName: goalForm.goalName || 'Financial Goal',
        targetAmount: target,
        allocatedSavings: allocated,
        remainingAmount: remaining,
        targetMonths: months,
        monthlySavingsRequired: monthly,
        isFeasible: true,
        projectedCompletionDate: new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000).toISOString(),
        feasibilityNote: '📱 Calculated directly on your phone using local offline arithmetic (no Wi-Fi needed).',
      });
      toast.info('Goal calculated locally on device');
    } finally {
      setGoalCalculating(false);
    }
  };

  const handleGenerateReport = async () => {
    setReportLoading(true);
    setShowReportModal(true);
    try {
      const { data } = await api.get('/ai/report');
      if (data && data.report) {
        setFinancialReport(data.report);
      }
    } catch (err) {
      toast.error('Failed to generate report');
      setShowReportModal(false);
    } finally {
      setReportLoading(false);
    }
  };

  const fmt = (n) => `৳${Number(n || 0).toLocaleString('en-US')}`;

  return (
    <div className="pitch-dashboard" style={{ maxWidth: '940px', margin: '0 auto', display: 'flex', flexDirection: 'column', minHeight: 'calc(100vh - 140px)' }}>
      {/* 1. Masthead Header */}
      <div
        style={{
          background: 'radial-gradient(circle at 0% 0%, #0d121c 0%, #050608 85%)',
          border: '1px solid #1a2233',
          borderRadius: '18px',
          padding: '20px 22px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.7)',
          marginBottom: '20px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '14px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <div
                style={{
                  width: '38px',
                  height: '38px',
                  borderRadius: '12px',
                  background: 'linear-gradient(135deg, #5145E5 0%, #278BFA 50%, #06B6D4 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '1.25rem',
                  boxShadow: '0 4px 16px rgba(39, 139, 250, 0.35)',
                }}
              >
                ✨
              </div>
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#f8fafc', margin: 0, letterSpacing: '-0.01em' }}>
                  Ledger AI <span style={{ fontSize: '0.78rem', color: '#06b6d4', fontWeight: 600, padding: '2px 8px', borderRadius: '6px', background: 'rgba(6, 182, 212, 0.12)', border: '1px solid rgba(6, 182, 212, 0.3)' }}>Read-Only Verified</span>
                </h2>
                <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: '3px 0 0' }}>
                  Deterministic financial advisory powered by your verified ledger records
                </p>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setShowGoalModal(true)}
              className="secondary"
              style={{ padding: '7px 14px', fontSize: '0.8rem', fontWeight: 650, borderRadius: '9px', borderColor: 'rgba(56, 189, 248, 0.3)', color: '#38bdf8' }}
            >
              🎯 Goal Planner
            </button>
            <button
              type="button"
              onClick={handleGenerateReport}
              className="secondary"
              style={{ padding: '7px 14px', fontSize: '0.8rem', fontWeight: 650, borderRadius: '9px', borderColor: 'rgba(16, 185, 129, 0.3)', color: '#34d399' }}
            >
              📑 Executive Report
            </button>
            <button
              type="button"
              onClick={() => setShowHistoryDrawer(!showHistoryDrawer)}
              className="secondary"
              style={{ padding: '7px 14px', fontSize: '0.8rem', fontWeight: 650, borderRadius: '9px' }}
            >
              💬 History ({conversations.length})
            </button>
            <button
              type="button"
              onClick={handleStartNewChat}
              className="primary"
              style={{ padding: '7px 16px', fontSize: '0.8rem', fontWeight: 700, borderRadius: '9px' }}
            >
              + New Chat
            </button>
          </div>
        </div>
      </div>

      {/* 2. Main Chat Workspace */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          background: '#090d16',
          border: '1px solid #1a2233',
          borderRadius: '18px',
          padding: '20px',
          boxShadow: '0 10px 30px rgba(0, 0, 0, 0.6)',
          position: 'relative',
          overflow: 'hidden',
          minHeight: '440px',
        }}
      >
        {/* Messages Stream */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '16px', paddingRight: '4px' }}>
          {/* Welcome Card if no messages */}
          {messages.length === 0 && (
            <div
              style={{
                background: 'radial-gradient(circle at 50% 0%, rgba(39, 139, 250, 0.08) 0%, rgba(5, 6, 9, 0.8) 75%)',
                border: '1px solid #1e283d',
                borderRadius: '16px',
                padding: '24px 20px',
                textAlign: 'center',
                margin: 'auto 0',
              }}
            >
              <div style={{ fontSize: '2.4rem', marginBottom: '8px' }}>🤖</div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', marginBottom: '6px' }}>
                Welcome to Ledger AI
              </h3>
              <p style={{ fontSize: '0.84rem', color: '#94a3b8', maxWidth: '580px', margin: '0 auto 18px', lineHeight: 1.5 }}>
                I am your personal finance analyst. All financial figures are deterministically calculated by the backend engine from your verified accounts, expenses, income, and debts.
              </p>

              {/* Quick Prompt Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '640px', margin: '0 auto' }}>
                {quickPrompts.map((qp, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSendMessage(qp.query)}
                    style={{
                      background: 'rgba(15, 23, 42, 0.7)',
                      border: '1px solid #243046',
                      borderRadius: '999px',
                      padding: '7px 14px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: '#cbd5e1',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#38bdf8';
                      e.currentTarget.style.color = '#f8fafc';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#243046';
                      e.currentTarget.style.color = '#cbd5e1';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    {qp.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation Messages */}
          {messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={index}
                style={{
                  display: 'flex',
                  justifyContent: isUser ? 'flex-end' : 'flex-start',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    maxWidth: '82%',
                    background: isUser
                      ? 'linear-gradient(135deg, #5145E5 0%, #278BFA 100%)'
                      : '#050608',
                    border: isUser ? 'none' : '1px solid #1a2233',
                    borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    padding: '14px 18px',
                    color: isUser ? '#ffffff' : '#f1f5f9',
                    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.4)',
                    lineHeight: 1.6,
                    fontSize: '0.9rem',
                    wordBreak: 'break-word',
                  }}
                >
                  {!isUser && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px', paddingBottom: '6px', borderBottom: '1px solid #141a27' }}>
                      <span style={{ fontSize: '0.85rem' }}>✨</span>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#38bdf8', letterSpacing: '0.02em', textTransform: 'uppercase' }}>
                        Ledger AI
                      </span>
                    </div>
                  )}
                  {isUser ? (
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                  ) : (
                    <MarkdownRenderer content={msg.content} />
                  )}
                </div>
              </div>
            );
          })}

          {/* Thinking / Loading Indicator */}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start', width: '100%' }}>
              <div
                style={{
                  background: '#050608',
                  border: '1px solid #1a2233',
                  borderRadius: '16px 16px 16px 4px',
                  padding: '12px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  color: '#94a3b8',
                  fontSize: '0.85rem',
                }}
              >
                <span className="spinner-sm" style={{ width: '16px', height: '16px' }} />
                <span>Analyzing ledger metrics with Gemini AI...</span>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Bar */}
        <div style={{ marginTop: '16px', paddingTop: '14px', borderTop: '1px solid #141a27' }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            style={{ display: 'flex', gap: '10px', alignItems: 'center' }}
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask about your finances, savings goals, or net worth..."
              className="field"
              style={{
                flex: 1,
                height: '46px',
                borderRadius: '12px',
                background: '#04060a',
                border: '1px solid #20283a',
                padding: '0 16px',
                fontSize: '0.9rem',
              }}
              disabled={loading}
              autoFocus
            />
            <button
              type="submit"
              className="primary"
              disabled={loading || !prompt.trim()}
              style={{
                height: '46px',
                padding: '0 20px',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '0.9rem',
                flexShrink: 0,
              }}
            >
              {loading ? '...' : 'Send ›'}
            </button>
          </form>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '0.72rem', color: '#64748b' }}>
            <span>🔒 Read-only security · Cannot alter database</span>
            <span>Free Tier Gemini Powered</span>
          </div>
        </div>
      </div>

      {/* 3. Conversation History Drawer Modal */}
      {showHistoryDrawer && (
        <div className="modal-overlay" onClick={() => setShowHistoryDrawer(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <h3 className="modal-title">💬 Consultation History</h3>
              <button type="button" className="modal-close-btn" onClick={() => setShowHistoryDrawer(false)}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px 0' }}>
              {conversations.length === 0 ? (
                <p style={{ textAlign: 'center', color: '#64748b', padding: '24px 0', fontSize: '0.85rem' }}>No saved conversations yet.</p>
              ) : (
                conversations.map((c) => (
                  <div
                    key={c._id}
                    onClick={() => handleSelectConversation(c._id)}
                    style={{
                      background: c._id === conversationId ? 'rgba(56, 189, 248, 0.12)' : '#090d16',
                      border: c._id === conversationId ? '1px solid rgba(56, 189, 248, 0.35)' : '1px solid #1a2233',
                      borderRadius: '10px',
                      padding: '12px 14px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1, paddingRight: '8px' }}>
                      <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.88rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.title}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '2px' }}>
                        {new Date(c.updatedAt).toLocaleDateString()} · {c.messageCount} messages
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteConversation(e, c._id)}
                      className="debt-action-btn btn-delete"
                      style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                      title="Delete conversation"
                    >
                      🗑️
                    </button>
                  </div>
                ))
              )}
            </div>

            <div style={{ marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #141a27', display: 'flex', justifyContent: 'flex-end' }}>
              <button type="button" onClick={() => setShowHistoryDrawer(false)} className="secondary" style={{ padding: '6px 14px', fontSize: '0.8rem' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Goal Planner Modal */}
      {showGoalModal && (
        <div className="modal-overlay" onClick={() => setShowGoalModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h2 className="modal-title">🎯 Goal Feasibility Planner</h2>
              <button type="button" className="modal-close-btn" onClick={() => setShowGoalModal(false)}>✕</button>
            </div>

            <form onSubmit={handleEvaluateGoal} className="modal-form">
              <div className="form-item">
                <label className="form-label" htmlFor="goal-name">Goal Purpose</label>
                <input
                  id="goal-name"
                  type="text"
                  placeholder="e.g. Emergency Fund, Car, Hajj, Land Booking"
                  className="field"
                  value={goalForm.goalName}
                  onChange={(e) => setGoalForm({ ...goalForm, goalName: e.target.value })}
                  required
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                <div className="form-item">
                  <label className="form-label" htmlFor="goal-amount">Target Amount (৳)</label>
                  <input
                    id="goal-amount"
                    type="number"
                    min="1000"
                    step="any"
                    className="field"
                    value={goalForm.targetAmount}
                    onChange={(e) => setGoalForm({ ...goalForm, targetAmount: e.target.value })}
                    required
                  />
                </div>

                <div className="form-item">
                  <label className="form-label" htmlFor="goal-months">Target Timeline (Months)</label>
                  <input
                    id="goal-months"
                    type="number"
                    min="1"
                    max="120"
                    className="field"
                    value={goalForm.targetMonths}
                    onChange={(e) => setGoalForm({ ...goalForm, targetMonths: e.target.value })}
                    required
                  />
                </div>
              </div>

              <div className="form-item">
                <label className="form-label" htmlFor="goal-current">Already Allocated Savings (৳, optional)</label>
                <input
                  id="goal-current"
                  type="number"
                  min="0"
                  step="any"
                  className="field"
                  value={goalForm.allocatedSavings}
                  onChange={(e) => setGoalForm({ ...goalForm, allocatedSavings: e.target.value })}
                />
              </div>

              <button
                type="submit"
                className="primary"
                disabled={goalCalculating}
                style={{ width: '100%', height: '42px', marginTop: '6px', fontWeight: 700 }}
              >
                {goalCalculating ? 'Calculating Feasibility...' : 'Evaluate Goal Feasibility'}
              </button>
            </form>

            {/* Calculated Plan Result */}
            {goalResult && (
              <div
                style={{
                  marginTop: '18px',
                  padding: '16px',
                  background: '#04060a',
                  border: '1px solid #1a2233',
                  borderRadius: '12px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '10px',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f8fafc' }}>
                    {goalResult.goalName}
                  </span>
                  <span
                    style={{
                      fontSize: '0.72rem',
                      fontWeight: 750,
                      padding: '3px 8px',
                      borderRadius: '6px',
                      background: goalResult.feasibility.includes('Comfortable') || goalResult.feasibility.includes('Achievable')
                        ? 'rgba(16, 185, 129, 0.15)'
                        : 'rgba(244, 63, 94, 0.15)',
                      color: goalResult.feasibility.includes('Comfortable') || goalResult.feasibility.includes('Achievable')
                        ? '#34d399'
                        : '#fb7185',
                      border: `1px solid ${goalResult.feasibility.includes('Comfortable') ? 'rgba(16, 185, 129, 0.3)' : 'rgba(244, 63, 94, 0.3)'}`,
                    }}
                  >
                    {goalResult.feasibility}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '0.8rem', color: '#cbd5e1' }}>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Target:</span> {fmt(goalResult.targetAmount)}
                  </div>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Remaining:</span> {fmt(goalResult.remainingTarget)}
                  </div>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Monthly Req:</span> <strong style={{ color: '#38bdf8' }}>{fmt(goalResult.requiredMonthlySavings)}/mo</strong>
                  </div>
                  <div>
                    <span style={{ color: '#94a3b8' }}>Est. Finish:</span> {goalResult.estimatedCompletionDate}
                  </div>
                </div>

                <div style={{ fontSize: '0.78rem', color: '#94a3b8', lineHeight: 1.4, borderTop: '1px solid #141a27', paddingTop: '8px' }}>
                  💡 {goalResult.advice}
                </div>

                <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                  🛡️ Emergency reserve of {fmt(goalResult.emergencyBufferPreserved)} preserved untouched.
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowGoalModal(false);
                    handleSendMessage(`Can you give me a personalized roadmap to achieve my goal of saving ৳${goalResult.targetAmount.toLocaleString()} for "${goalResult.goalName}" in ${goalResult.targetMonths} months (requiring ~৳${goalResult.requiredMonthlySavings.toLocaleString()}/mo)?`);
                  }}
                  className="secondary"
                  style={{ width: '100%', padding: '8px', fontSize: '0.8rem', color: '#38bdf8', borderColor: 'rgba(56, 189, 248, 0.3)' }}
                >
                  Ask AI for Roadmap on this Goal ›
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. Executive Report Modal */}
      {showReportModal && (
        <div className="modal-overlay" onClick={() => setShowReportModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <h2 className="modal-title">📑 Executive Financial Briefing</h2>
              <button type="button" className="modal-close-btn" onClick={() => setShowReportModal(false)}>✕</button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
              {reportLoading ? (
                <div style={{ textAlign: 'center', padding: '36px 0', color: '#94a3b8' }}>
                  <div className="spinner-sm" style={{ margin: '0 auto 10px' }} />
                  <p>Synthesizing verified ledger records...</p>
                </div>
              ) : financialReport ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {/* Metric Cards Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                    <div style={{ background: '#04060a', border: '1px solid #1a2233', borderRadius: '10px', padding: '12px' }}>
                      <div style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700 }}>NET WORTH</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 850, color: '#f8fafc', marginTop: '2px' }}>
                        {fmt(financialReport.summary.netWorth)}
                      </div>
                    </div>
                    <div style={{ background: '#04060a', border: '1px solid #1a2233', borderRadius: '10px', padding: '12px' }}>
                      <div style={{ fontSize: '0.72rem', color: '#34d399', fontWeight: 700 }}>NET CASH FLOW</div>
                      <div style={{ fontSize: '1.2rem', fontWeight: 850, color: '#34d399', marginTop: '2px' }}>
                        {fmt(financialReport.summary.netCashFlow)}
                      </div>
                    </div>
                    <div style={{ background: '#04060a', border: '1px solid #1a2233', borderRadius: '10px', padding: '12px' }}>
                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700 }}>TOTAL ASSETS</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 750, color: '#f8fafc', marginTop: '2px' }}>
                        {fmt(financialReport.summary.totalAssets)}
                      </div>
                    </div>
                    <div style={{ background: '#04060a', border: '1px solid #1a2233', borderRadius: '10px', padding: '12px' }}>
                      <div style={{ fontSize: '0.72rem', color: '#fb7185', fontWeight: 700 }}>TOTAL LIABILITIES</div>
                      <div style={{ fontSize: '1.1rem', fontWeight: 750, color: '#fb7185', marginTop: '2px' }}>
                        {fmt(financialReport.summary.totalLiabilities)}
                      </div>
                    </div>
                  </div>

                  {/* Top Spending Categories */}
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 750, color: '#f8fafc', marginBottom: '8px' }}>
                      Top Outflow Categories
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {financialReport.topCategories.slice(0, 4).map((c, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', padding: '6px 10px', background: '#050608', borderRadius: '6px', border: '1px solid #141a27' }}>
                          <span style={{ color: '#cbd5e1' }}>{c.category}</span>
                          <span style={{ fontWeight: 700, color: '#f8fafc' }}>{fmt(c.amount)} ({c.percentage}%)</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Strategic Recommendation */}
                  <div style={{ background: 'rgba(56, 189, 248, 0.06)', border: '1px solid rgba(56, 189, 248, 0.25)', borderRadius: '10px', padding: '14px' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 750, color: '#38bdf8', marginBottom: '4px' }}>
                      💡 Strategic Recommendation
                    </div>
                    <p style={{ fontSize: '0.82rem', color: '#e2e8f0', lineHeight: 1.5, margin: 0 }}>
                      {financialReport.recommendation}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>

            <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #141a27', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                onClick={() => {
                  setShowReportModal(false);
                  handleSendMessage('Please give me an in-depth breakdown of my executive financial report, and suggest 3 high-impact habits to optimize my cash flow.');
                }}
                className="primary"
                style={{ padding: '6px 16px', fontSize: '0.82rem' }}
              >
                Discuss Report with AI ›
              </button>
              <button type="button" onClick={() => setShowReportModal(false)} className="secondary" style={{ padding: '6px 16px', fontSize: '0.82rem' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
