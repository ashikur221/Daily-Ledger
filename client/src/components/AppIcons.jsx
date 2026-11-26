import React from 'react';
import {
  Utensils,
  Car,
  Smartphone,
  HeartPulse,
  Shirt,
  GraduationCap,
  Home,
  ReceiptText,
  Sparkles,
  ShoppingBag,
  CircleEllipsis,
} from 'lucide-react';

export const ICON_STROKE = 1.85;

/**
 * Semantic category icon & accent mapping for transaction rows and reports.
 */
export function getCategoryMeta(category = '') {
  const cat = String(category).toLowerCase();

  if (cat.includes('food') || cat.includes('drink')) {
    return {
      Icon: Utensils,
      color: '#fbbf24',
      bg: 'rgba(245, 158, 11, 0.14)',
      label: 'Food & Drinks',
    };
  }
  if (cat.includes('transport') || cat.includes('fare') || cat.includes('rickshaw')) {
    return {
      Icon: Car,
      color: '#38bdf8',
      bg: 'rgba(56, 189, 248, 0.14)',
      label: 'Transport',
    };
  }
  if (cat.includes('phone') || cat.includes('internet') || cat.includes('comm')) {
    return {
      Icon: Smartphone,
      color: '#818cf8',
      bg: 'rgba(129, 140, 248, 0.14)',
      label: 'Phone & Net',
    };
  }
  if (cat.includes('health') || cat.includes('med')) {
    return {
      Icon: HeartPulse,
      color: '#f87171',
      bg: 'rgba(239, 68, 68, 0.14)',
      label: 'Health',
    };
  }
  if (cat.includes('cloth') || cat.includes('wear')) {
    return {
      Icon: Shirt,
      color: '#f472b6',
      bg: 'rgba(236, 72, 153, 0.14)',
      label: 'Clothing',
    };
  }
  if (cat.includes('study') || cat.includes('book') || cat.includes('suppl') || cat.includes('edu')) {
    return {
      Icon: GraduationCap,
      color: '#c084fc',
      bg: 'rgba(168, 85, 247, 0.14)',
      label: 'Study & Supplies',
    };
  }
  if (cat.includes('house') || cat.includes('rent') || cat.includes('home')) {
    return {
      Icon: Home,
      color: '#34d399',
      bg: 'rgba(16, 185, 129, 0.14)',
      label: 'Housing',
    };
  }
  if (cat.includes('laundry') || cat.includes('util') || cat.includes('bill')) {
    return {
      Icon: ReceiptText,
      color: '#22d3ee',
      bg: 'rgba(6, 182, 212, 0.14)',
      label: 'Household & Bills',
    };
  }
  if (cat.includes('personal') || cat.includes('care')) {
    return {
      Icon: Sparkles,
      color: '#fb7185',
      bg: 'rgba(244, 63, 94, 0.14)',
      label: 'Personal Care',
    };
  }
  if (cat.includes('shop')) {
    return {
      Icon: ShoppingBag,
      color: '#fb923c',
      bg: 'rgba(251, 146, 60, 0.14)',
      label: 'Shopping',
    };
  }

  return {
    Icon: CircleEllipsis,
    color: '#94a3b8',
    bg: 'rgba(148, 163, 184, 0.12)',
    label: category || 'General',
  };
}

/**
 * Reusable category icon badge component.
 */
export function CategoryIcon({ category, size = 20 }) {
  const { Icon, color, bg } = getCategoryMeta(category);
  return (
    <div
      className="bkash-tx-icon"
      style={{ background: bg, color }}
      aria-hidden="true"
    >
      <Icon size={size} strokeWidth={ICON_STROKE} />
    </div>
  );
}
