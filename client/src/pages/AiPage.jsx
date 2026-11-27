import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Sparkles,
  Target,
  FileText,
  Plus,
  ShieldCheck,
  TrendingUp,
  Lock,
  ArrowUp,
  BarChart3,
  Pencil,
  Bell,
  BellOff,
  Copy,
  Check,
  PanelLeft,
  SquarePen,
  Trash2,
  X,
} from 'lucide-react';
import { ICON_STROKE } from '../components/AppIcons';
import api from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import MarkdownRenderer from '../components/MarkdownRenderer';
import db from '../db/localDb';
import {
  getNotificationSettings,
  enableSmartNotifications,
  disableSmartNotifications,
  buildPersonalizedNotifications,
  showNativeNotification,
} from '../services/budgetNotificationService';

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

  // Budget & Spending Insights (consolidated from legacy Reports page)
  const [showInsightsModal, setShowInsightsModal] = useState(false);
  const [localExpenses, setLocalExpenses] = useState([]);
  const [monthlyBudget, setMonthlyBudget] = useState(
    () => localStorage.getItem('daily_ledger_monthly_budget') || '12000'
  );
  const [budgetInput, setBudgetInput] = useState(
    () => localStorage.getItem('daily_ledger_monthly_budget') || '12000'
  );
  const [editingBudget, setEditingBudget] = useState(false);
  const [copiedMsgIdx, setCopiedMsgIdx] = useState(null);
  const [notifEnabled, setNotifEnabled] = useState(() => getNotificationSettings().enabled);

  const handleToggleNotifications = async () => {
    if (notifEnabled) {
      disableSmartNotifications();
      setNotifEnabled(false);
      toast.info('Daily Smart Alerts turned off.');
    } else {
      try {
        await enableSmartNotifications();
        setNotifEnabled(true);
        toast.success('Daily Smart Alerts enabled! (5 catchy alerts/day)');
      } catch (err) {
        toast.error(err.message || 'Could not enable notifications.');
      }
    }
  };

  const handleTestNotification = async () => {
    try {
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted') {
        await enableSmartNotifications();
        setNotifEnabled(true);
        toast.success('Test notification sent!');
        return;
      }
      const list = await buildPersonalizedNotifications();
      const randomItem = list[Math.floor(Math.random() * list.length)];
      const ok = await showNativeNotification(randomItem);
      if (ok) {
        toast.success('Notification sent! Check your system tray.');
      } else {
        toast.info(`${randomItem.title} — ${randomItem.body}`);
      }
    } catch (err) {
      toast.error(err.message || 'Notification failed');
    }
  };

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
    { label: 'Analyze My Spending', Icon: BarChart3, color: '#38bdf8', query: 'Can you analyze my top spending categories and tell me where I can cut costs?' },
    { label: 'Emergency Fund Plan', Icon: ShieldCheck, color: '#34d399', query: 'How much should I set aside for an emergency fund based on my actual expenses?' },
    { label: 'Boost Savings Rate', Icon: TrendingUp, color: '#a855f7', query: 'What is my current savings rate, and what practical steps will help increase it?' },
    { label: 'Plan Financial Goal', Icon: Target, color: '#f59e0b', query: 'I want to plan a savings goal. How much can I comfortably save each month without debt risk?' },
    { label: 'Monthly Briefing', Icon: FileText, color: '#06b6d4', query: 'Please give me an executive summary of my financial health, net worth, and cash flow.' },
  ];

  useEffect(() => {
    loadConversations();
    loadLocalExpenses();
    const handleUpdate = () => loadLocalExpenses();
    window.addEventListener('daily_ledger:data_updated', handleUpdate);
    return () => window.removeEventListener('daily_ledger:data_updated', handleUpdate);
  }, []);

  const loadLocalExpenses = async () => {
    try {
      const txs = await db.transactions.where('isDeleted').equals(0).toArray();
      setLocalExpenses(txs.filter((t) => t.type === 'expense' && t.category !== 'Banking'));
    } catch {}
  };

  const insights = useMemo(() => {
    const itemizedTotal = localExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const daysMap = {};
    const catTotals = {};
    const now = new Date();
    const curY = now.getFullYear();
    const curM = now.getMonth();
    const prevDate = new Date(curY, curM - 1, 1);
    const prevY = prevDate.getFullYear();
    const prevM = prevDate.getMonth();
    let currentMonthSpend = 0;
    let prevMonthSpend = 0;

    localExpenses.forEach((e) => {
      const d = new Date(e.date);
      if (isNaN(d.getTime())) return;
      const key = d.toISOString().split('T')[0];
      const amt = Number(e.amount) || 0;
      daysMap[key] = (daysMap[key] || 0) + amt;

      const cat = e.category && e.category !== 'General' ? e.category : 'General';
      catTotals[cat] = (catTotals[cat] || 0) + amt;

      if (d.getFullYear() === curY && d.getMonth() === curM) currentMonthSpend += amt;
      if (d.getFullYear() === prevY && d.getMonth() === prevM) prevMonthSpend += amt;
    });

    const dayEntries = Object.entries(daysMap);
    const avgPerDay = dayEntries.length ? itemizedTotal / dayEntries.length : 0;
    const highestDay = dayEntries.sort((a, b) => b[1] - a[1])[0] || null;
    const categories = Object.entries(catTotals)
      .sort((a, b) => b[1] - a[1])
      .map(([name, amount]) => ({
        name,
        amount,
        pct: itemizedTotal ? Math.round((amount / itemizedTotal) * 100) : 0,
      }));

    return {
      itemizedTotal,
      recordedDays: dayEntries.length,
      avgPerDay,
      highestDay,
      currentMonthSpend,
      prevMonthSpend,
      categories,
    };
  }, [localExpenses]);

  const handleSaveBudget = (e) => {
    e.preventDefault();
    const val = parseFloat(budgetInput);
    if (isNaN(val) || val < 0) {
      toast.warning('Please enter a valid monthly target');
      return;
    }
    localStorage.setItem('daily_ledger_monthly_budget', String(val));
    setMonthlyBudget(String(val));
    setEditingBudget(false);
    toast.success('Monthly spending target updated!');
  };

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
      console.warn('AI request failed:', err);
      const isActuallyOffline = typeof navigator !== 'undefined' && !navigator.onLine;
      const errDetail = err.response?.data?.message || err.message || 'Network error';
      const statusCode = err.response?.status;

      let fallbackSummary = '';
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

        const header = isActuallyOffline
          ? `📱 **Phone Offline Mode (No Wi-Fi / Data)**\n\nYou are currently offline. Conversational responses with Google Gemini require an internet connection, but your phone's stored ledger data remains 100% accessible:`
          : statusCode === 401
          ? `🔐 **Session Expired on This Device (401)**\n\nYour login session on this device was invalidated (\`${errDetail}\`). Please **Sign Out** in Settings and **Sign In** again to reconnect to Ledger AI.\n\nMeanwhile, here is your local ledger summary:`
          : `⚠️ **Cloud AI Server Unreachable${statusCode ? ` (${statusCode})` : ''}**\n\nYour device is online, but the backend AI service did not respond (\`${errDetail}\`). If your backend is hosted on Render's free tier, it may be waking up or redeploying—please wait 15–30 seconds and retry.\n\nMeanwhile, here is your local ledger summary:`;

        fallbackSummary =
          `${header}\n\n` +
          `* **Local Income:** ৳${totalIncome.toLocaleString('en-US')}\n` +
          `* **Local Outflow:** ৳${totalExpense.toLocaleString('en-US')}\n` +
          `* **Net Balance:** ৳${netCash.toLocaleString('en-US')}\n` +
          `* **Local Records:** ${activeTxs.length} transactions stored`;
      } catch {
        fallbackSummary = isActuallyOffline
          ? `📱 **Phone Offline Mode (No Wi-Fi / Data)**\n\nYour phone is not connected to Wi-Fi or mobile data. Google Gemini requires an internet connection to generate conversational answers.`
          : `⚠️ **Cloud AI Server Unreachable${statusCode ? ` (${statusCode})` : ''}**\n\nUnable to reach the backend AI service (\`${errDetail}\`). Please wait a few seconds and try again.`;
      }

      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: fallbackSummary,
          timestamp: new Date().toISOString(),
          metadata: { provider: isActuallyOffline ? 'client-offline-storage' : 'client-error-fallback' },
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
    <div className="pitch-dashboard" style={{ maxWidth: '860px', margin: '0 auto', display: 'flex', flexDirection: 'column', minHeight: 'calc(100dvh - 190px)' }}>
      {/* 1. Minimal ChatGPT-Style Top Bar */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 4px 14px',
          borderBottom: '1px solid #141a27',
          marginBottom: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button
            type="button"
            onClick={() => setShowHistoryDrawer(true)}
            aria-label="Open Ledger AI Menu & History"
            title="Menu & History"
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '10px',
              background: '#101116',
              border: '1px solid #252936',
              color: '#e2e8f0',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
            }}
          >
            <PanelLeft size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '1.08rem', fontWeight: 800, color: '#f8fafc', letterSpacing: '-0.01em' }}>
              Ledger AI
            </span>
            <span style={{ fontSize: '0.68rem', color: '#06b6d4', fontWeight: 650, padding: '2px 7px', borderRadius: '999px', background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.25)' }}>
              Gemini
            </span>
          </div>
        </div>

        <button
          type="button"
          onClick={handleStartNewChat}
          aria-label="New chat"
          title="New chat"
          style={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            background: '#101116',
            border: '1px solid #252936',
            color: '#e2e8f0',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          <SquarePen size={17} strokeWidth={ICON_STROKE} aria-hidden="true" />
        </button>
      </div>

      {/* 2. Main ChatGPT-Style Workspace */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          minHeight: '460px',
        }}
      >
        {/* Messages Stream */}
        <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '22px', padding: '6px 2px 20px' }}>
          {/* Unique Welcome Hero if no messages */}
          {messages.length === 0 && (
            <div
              style={{
                background: 'radial-gradient(circle at 50% 0%, rgba(39, 139, 250, 0.1) 0%, rgba(10, 10, 15, 0.9) 75%)',
                border: '1px solid #1e283d',
                borderRadius: '20px',
                padding: '32px 20px',
                textAlign: 'center',
                margin: 'auto 0',
              }}
            >
              <div
                style={{
                  width: '54px',
                  height: '54px',
                  borderRadius: '16px',
                  margin: '0 auto 14px',
                  background: 'linear-gradient(135deg, #5145E5 0%, #278BFA 50%, #06B6D4 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                  boxShadow: '0 0 28px rgba(39, 139, 250, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)',
                }}
              >
                <Sparkles size={26} strokeWidth={1.9} aria-hidden="true" />
              </div>

              <h3
                style={{
                  fontSize: '1.28rem',
                  fontWeight: 850,
                  color: '#f8fafc',
                  marginBottom: '8px',
                  letterSpacing: '-0.02em',
                }}
              >
                হ্যালো, {user?.name?.split(' ')[0] || 'বন্ধু'}! আজ আপনার টাকা{' '}
                <span
                  style={{
                    background: 'linear-gradient(105deg, #60a5fa, #22d3ee)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  কীভাবে কাজ করবে?
                </span>
              </h3>

              <p style={{ fontSize: '0.84rem', color: '#94a3b8', maxWidth: '520px', margin: '0 auto 22px', lineHeight: 1.6 }}>
                আয় বাড়ান, অপ্রয়োজনীয় খরচ কমান—আপনার আসল লেজার হিসাব থেকে সরাসরি স্মার্ট পরামর্শ নিন।
              </p>

              {/* Quick Prompt Chips */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center', maxWidth: '640px', margin: '0 auto' }}>
                {quickPrompts.map((qp, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSendMessage(qp.query)}
                    style={{
                      background: '#101116',
                      border: '1px solid #252936',
                      borderRadius: '999px',
                      padding: '8px 14px',
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: '#cbd5e1',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '7px',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.borderColor = '#38bdf8';
                      e.currentTarget.style.color = '#f8fafc';
                      e.currentTarget.style.transform = 'translateY(-1px)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.borderColor = '#252936';
                      e.currentTarget.style.color = '#cbd5e1';
                      e.currentTarget.style.transform = 'translateY(0)';
                    }}
                  >
                    <qp.Icon size={14} strokeWidth={ICON_STROKE} color={qp.color} aria-hidden="true" />
                    <span>{qp.label}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Conversation Messages (ChatGPT Style: pill for user, full-width clean prose for AI) */}
          {messages.map((msg, index) => {
            const isUser = msg.role === 'user';
            if (isUser) {
              return (
                <div
                  key={index}
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      maxWidth: '82%',
                      background: '#171a23',
                      border: '1px solid #252936',
                      borderRadius: '20px',
                      padding: '10px 16px',
                      color: '#f5f7fa',
                      lineHeight: 1.55,
                      fontSize: '0.92rem',
                      wordBreak: 'break-word',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {msg.content}
                  </div>
                </div>
              );
            }

            const isCopied = copiedMsgIdx === index;
            return (
              <div
                key={index}
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div
                    style={{
                      width: '24px',
                      height: '24px',
                      borderRadius: '50%',
                      background: 'linear-gradient(135deg, #5145E5 0%, #278BFA 50%, #06B6D4 100%)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ffffff',
                    }}
                  >
                    <Sparkles size={13} strokeWidth={ICON_STROKE} aria-hidden="true" />
                  </div>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#e2e8f0', letterSpacing: '0.01em' }}>
                    Ledger AI
                  </span>
                </div>

                <div
                  style={{
                    width: '100%',
                    color: '#f1f5f9',
                    lineHeight: 1.75,
                    fontSize: '0.95rem',
                    wordBreak: 'break-word',
                    paddingLeft: '2px',
                  }}
                >
                  <MarkdownRenderer content={msg.content} />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '2px' }}>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(msg.content || '');
                      setCopiedMsgIdx(index);
                      setTimeout(() => setCopiedMsgIdx(null), 1800);
                    }}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: isCopied ? '#34d399' : '#64748b',
                      cursor: 'pointer',
                      padding: '4px 6px',
                      borderRadius: '6px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '0.74rem',
                      fontWeight: 600,
                    }}
                    title="Copy response"
                    aria-label="Copy response"
                  >
                    {isCopied ? (
                      <>
                        <Check size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}

          {/* Thinking / Loading Indicator */}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: '#94a3b8', fontSize: '0.88rem', padding: '6px 0' }}>
              <span className="spinner-sm" style={{ width: '16px', height: '16px' }} />
              <span>Ledger AI is analyzing...</span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ChatGPT-Style Floating Composer Pill */}
        <div style={{ marginTop: 'auto', position: 'sticky', bottom: '68px', paddingTop: '10px', background: '#050505' }}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            style={{
              background: '#171a23',
              border: '1px solid #252936',
              borderRadius: '26px',
              padding: '10px 12px 10px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
            }}
          >
            <input
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask Ledger AI"
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: '#f5f7fa',
                fontSize: '0.95rem',
                outline: 'none',
                padding: '4px 2px',
              }}
              disabled={loading}
              autoFocus
            />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                onClick={handleStartNewChat}
                title="Start New Chat"
                aria-label="Start New Chat"
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '50%',
                  background: 'transparent',
                  border: '1px solid #2e3444',
                  color: '#cbd5e1',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <Plus size={17} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </button>

              <button
                type="submit"
                disabled={loading || !prompt.trim()}
                aria-label="Send message"
                style={{
                  width: '34px',
                  height: '34px',
                  borderRadius: '50%',
                  border: 'none',
                  background:
                    loading || !prompt.trim()
                      ? '#252936'
                      : 'linear-gradient(135deg, #5145E5 0%, #278BFA 55%, #06B6D4 100%)',
                  color: loading || !prompt.trim() ? '#64748b' : '#ffffff',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: loading || !prompt.trim() ? 'not-allowed' : 'pointer',
                  transition: 'all 0.15s ease',
                  flexShrink: 0,
                }}
              >
                <ArrowUp size={17} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* 3. ChatGPT-Style Slide-Out Sidebar (Menu + Recents) */}
      {showHistoryDrawer && (
        <div
          className="mobile-drawer-overlay"
          onClick={() => setShowHistoryDrawer(false)}
          style={{ justifyContent: 'flex-start' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(300px, 84vw)',
              height: '100%',
              background: '#0a0a0f',
              borderRight: '1px solid #252936',
              display: 'flex',
              flexDirection: 'column',
              padding: '16px 12px',
              boxShadow: '12px 0 36px rgba(0, 0, 0, 0.75)',
            }}
          >
            {/* Sidebar Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 6px 14px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Sparkles size={18} strokeWidth={ICON_STROKE} color="#38bdf8" aria-hidden="true" />
                <span style={{ fontSize: '1.05rem', fontWeight: 800, color: '#f5f7fa' }}>Ledger AI</span>
              </div>
              <button
                type="button"
                onClick={() => setShowHistoryDrawer(false)}
                aria-label="Close sidebar"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#9ca3af',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <X size={18} strokeWidth={ICON_STROKE} aria-hidden="true" />
              </button>
            </div>

            {/* ChatGPT-Style Action Links */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', marginBottom: '18px' }}>
              {[
                { label: 'New chat', Icon: SquarePen, onClick: handleStartNewChat },
                {
                  label: 'Budget & Insights',
                  Icon: BarChart3,
                  onClick: () => {
                    setShowHistoryDrawer(false);
                    loadLocalExpenses();
                    setShowInsightsModal(true);
                  },
                },
                {
                  label: 'Goal Planner',
                  Icon: Target,
                  onClick: () => {
                    setShowHistoryDrawer(false);
                    setShowGoalModal(true);
                  },
                },
                {
                  label: 'Executive Report',
                  Icon: FileText,
                  onClick: () => {
                    setShowHistoryDrawer(false);
                    handleGenerateReport();
                  },
                },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={item.onClick}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: '10px',
                    background: 'transparent',
                    border: 'none',
                    color: '#f5f7fa',
                    fontSize: '0.9rem',
                    fontWeight: 550,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.14s ease',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = '#171a23'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                >
                  <item.Icon size={18} strokeWidth={ICON_STROKE} color="#cbd5e1" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>

            {/* Recents Section */}
            <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', padding: '0 12px 8px', letterSpacing: '0.03em' }}>
              Recents
            </div>

            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {conversations.length === 0 ? (
                <p style={{ color: '#64748b', padding: '12px', fontSize: '0.82rem', margin: 0 }}>
                  No recent chats yet.
                </p>
              ) : (
                conversations.map((c) => {
                  const isActive = c._id === conversationId;
                  return (
                    <div
                      key={c._id}
                      onClick={() => handleSelectConversation(c._id)}
                      style={{
                        background: isActive ? '#171a23' : 'transparent',
                        borderRadius: '10px',
                        padding: '9px 12px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        cursor: 'pointer',
                        transition: 'background 0.14s ease',
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1, paddingRight: '8px' }}>
                        <div style={{ fontWeight: isActive ? 650 : 500, color: isActive ? '#f5f7fa' : '#cbd5e1', fontSize: '0.86rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {c.title}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteConversation(e, c._id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#64748b',
                          cursor: 'pointer',
                          padding: '4px',
                          display: 'inline-flex',
                          borderRadius: '6px',
                        }}
                        title="Delete conversation"
                        aria-label={`Delete ${c.title}`}
                      >
                        <Trash2 size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      </button>
                    </div>
                  );
                })
              )}
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

      {/* 6. Budget & Spending Insights Modal (consolidated from legacy Reports) */}
      {showInsightsModal && (() => {
        const budgetNum = parseFloat(monthlyBudget) || 0;
        const pctUsed = budgetNum > 0 ? Math.min(100, Math.round((insights.currentMonthSpend / budgetNum) * 100)) : 0;
        const rawPct = budgetNum > 0 ? Math.round((insights.currentMonthSpend / budgetNum) * 100) : 0;
        const overBudget = budgetNum > 0 && insights.currentMonthSpend > budgetNum;

        return (
          <div className="modal-overlay" onClick={() => setShowInsightsModal(false)}>
            <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '620px', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }}>
              <div className="modal-header">
                <h2 className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <BarChart3 size={19} strokeWidth={ICON_STROKE} color="#c084fc" aria-hidden="true" />
                  <span>Budget &amp; Spending Insights</span>
                </h2>
                <button type="button" className="modal-close-btn" onClick={() => setShowInsightsModal(false)}>✕</button>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: '8px 2px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {/* Monthly Spending Target */}
                <div style={{ background: '#050608', border: '1px solid #1a2233', borderRadius: '12px', padding: '14px 16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
                    <div>
                      <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Monthly Spending Target
                      </div>
                      <div style={{ fontSize: '0.76rem', color: '#94a3b8' }}>
                        Target: <strong style={{ color: '#f8fafc' }}>{budgetNum ? fmt(budgetNum) : 'Not set'}</strong> · Spent: <strong style={{ color: overBudget ? '#fb7185' : '#38bdf8' }}>{fmt(insights.currentMonthSpend)}</strong>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setBudgetInput(monthlyBudget || '');
                        setEditingBudget(!editingBudget);
                      }}
                      style={{ padding: '5px 10px', fontSize: '0.75rem', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', gap: '5px' }}
                    >
                      <Pencil size={12} strokeWidth={ICON_STROKE} aria-hidden="true" />
                      <span>{editingBudget ? 'Cancel' : budgetNum ? 'Edit Target' : 'Set Target'}</span>
                    </button>
                  </div>

                  {editingBudget && (
                    <form onSubmit={handleSaveBudget} style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={budgetInput}
                        onChange={(e) => setBudgetInput(e.target.value)}
                        placeholder="e.g. 15000"
                        className="field"
                        style={{ flex: 1, height: '38px' }}
                        required
                      />
                      <button type="submit" className="primary" style={{ height: '38px', padding: '0 16px', fontSize: '0.82rem' }}>
                        Save
                      </button>
                    </form>
                  )}

                  {budgetNum > 0 && (
                    <div>
                      <div style={{ height: '8px', background: '#0d131f', borderRadius: '999px', overflow: 'hidden' }}>
                        <div
                          style={{
                            height: '100%',
                            width: `${pctUsed}%`,
                            borderRadius: '999px',
                            background: overBudget ? '#f43f5e' : 'linear-gradient(90deg, #5145E5, #278BFA, #06B6D4)',
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: '#94a3b8', marginTop: '6px' }}>
                        <span>{rawPct}% consumed</span>
                        <span style={{ color: overBudget ? '#fb7185' : '#34d399', fontWeight: 600 }}>
                          {overBudget
                            ? `Exceeded by ${fmt(insights.currentMonthSpend - budgetNum)}`
                            : `Remaining: ${fmt(budgetNum - insights.currentMonthSpend)}`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Smart Daily Coaching Notifications (4-5/day) */}
                <div style={{ background: '#050608', border: '1px solid #1a2233', borderRadius: '12px', padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
                  <div style={{ flex: 1, minWidth: '210px' }}>
                    <div style={{ fontSize: '0.82rem', fontWeight: 750, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {notifEnabled ? (
                        <Bell size={15} strokeWidth={ICON_STROKE} color="#34d399" aria-hidden="true" />
                      ) : (
                        <BellOff size={15} strokeWidth={ICON_STROKE} color="#94a3b8" aria-hidden="true" />
                      )}
                      <span>Daily Smart Coaching Alerts (5/day)</span>
                    </div>
                    <div style={{ fontSize: '0.74rem', color: '#94a3b8', marginTop: '3px', lineHeight: 1.45 }}>
                      Catchy Bangla reminders to trim top expenses, stay under budget, and boost your income.
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="secondary"
                      onClick={handleTestNotification}
                      style={{ height: '34px', padding: '0 12px', fontSize: '0.76rem', borderRadius: '8px' }}
                    >
                      Test Alert
                    </button>
                    <button
                      type="button"
                      className={notifEnabled ? 'secondary' : 'primary'}
                      onClick={handleToggleNotifications}
                      style={{ height: '34px', padding: '0 14px', fontSize: '0.76rem', borderRadius: '8px', fontWeight: 700 }}
                    >
                      {notifEnabled ? 'Turn Off' : 'Enable Alerts'}
                    </button>
                  </div>
                </div>

                {/* Key Metrics Grid */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '10px' }}>
                  <div style={{ background: '#050608', border: '1px solid #1a2233', borderRadius: '10px', padding: '12px' }}>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700 }}>ITEMIZED SPENDING</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', marginTop: '3px' }}>{fmt(insights.itemizedTotal)}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{insights.recordedDays} recorded days</div>
                  </div>
                  <div style={{ background: '#050608', border: '1px solid #1a2233', borderRadius: '10px', padding: '12px' }}>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700 }}>DAILY AVERAGE</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#38bdf8', marginTop: '3px' }}>{fmt(Math.round(insights.avgPerDay))}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Per active spend day</div>
                  </div>
                  <div style={{ background: '#050608', border: '1px solid #1a2233', borderRadius: '10px', padding: '12px' }}>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700 }}>HIGHEST-SPEND DAY</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#fb7185', marginTop: '3px' }}>
                      {insights.highestDay ? fmt(insights.highestDay[1]) : '৳0'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                      {insights.highestDay ? insights.highestDay[0] : 'No records yet'}
                    </div>
                  </div>
                  <div style={{ background: '#050608', border: '1px solid #1a2233', borderRadius: '10px', padding: '12px' }}>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 700 }}>MONTH VS LAST</div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f8fafc', marginTop: '3px' }}>{fmt(insights.currentMonthSpend)}</div>
                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>Last month: {fmt(insights.prevMonthSpend)}</div>
                  </div>
                </div>

                {/* Spending by Category */}
                <div style={{ background: '#050608', border: '1px solid #1a2233', borderRadius: '12px', padding: '14px 16px' }}>
                  <div style={{ fontSize: '0.82rem', fontWeight: 750, color: '#f8fafc', marginBottom: '10px' }}>
                    Spending by Category
                  </div>
                  {insights.categories.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: '#64748b', margin: 0 }}>No categorized expenses yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {insights.categories.map((c) => (
                        <div key={c.name}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '4px' }}>
                            <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{c.name}</span>
                            <span style={{ color: '#94a3b8' }}>
                              <strong style={{ color: '#f8fafc' }}>{fmt(c.amount)}</strong> ({c.pct}%)
                            </span>
                          </div>
                          <div style={{ height: '6px', background: '#0d131f', borderRadius: '999px', overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${c.pct}%`, background: 'linear-gradient(90deg, #5145E5, #06B6D4)', borderRadius: '999px' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div style={{ marginTop: '14px', paddingTop: '10px', borderTop: '1px solid #141a27', display: 'flex', justifyContent: 'flex-end', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={() => {
                    setShowInsightsModal(false);
                    handleSendMessage(`My monthly spending target is ৳${budgetNum || 0} and I have spent ৳${insights.currentMonthSpend} so far this month. Based on my spending categories, how can I stay under budget?`);
                  }}
                  className="primary"
                  style={{ padding: '6px 16px', fontSize: '0.82rem' }}
                >
                  Ask AI to Optimize Budget ›
                </button>
                <button type="button" onClick={() => setShowInsightsModal(false)} className="secondary" style={{ padding: '6px 16px', fontSize: '0.82rem' }}>
                  Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
