import React from 'react';

/**
 * Parses inline markdown:
 * - Bold: **text**
 * - Italic: *text* or _text_
 * - Code: `code`
 */
function parseInline(text) {
  if (!text) return null;

  // Tokenize bold, italic, code
  const tokens = [];
  let remaining = text;
  let key = 0;

  // Regex matches: `code`, **bold**, or *italic*
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|_[^_]+_)/;

  while (remaining) {
    const match = remaining.match(pattern);
    if (!match) {
      tokens.push(remaining);
      break;
    }

    const index = match.index;
    if (index > 0) {
      tokens.push(remaining.substring(0, index));
    }

    const matchedStr = match[0];
    if (matchedStr.startsWith('`') && matchedStr.endsWith('`')) {
      tokens.push(
        <code
          key={`code-${key++}`}
          style={{
            background: 'rgba(30, 41, 59, 0.7)',
            padding: '2px 6px',
            borderRadius: '4px',
            fontSize: '0.86em',
            color: '#38bdf8',
            fontFamily: 'monospace',
          }}
        >
          {matchedStr.slice(1, -1)}
        </code>
      );
    } else if (matchedStr.startsWith('**') && matchedStr.endsWith('**')) {
      tokens.push(
        <strong key={`bold-${key++}`} style={{ fontWeight: 700, color: '#f8fafc' }}>
          {matchedStr.slice(2, -2)}
        </strong>
      );
    } else if (
      (matchedStr.startsWith('*') && matchedStr.endsWith('*')) ||
      (matchedStr.startsWith('_') && matchedStr.endsWith('_'))
    ) {
      tokens.push(
        <em key={`em-${key++}`} style={{ fontStyle: 'italic', color: '#94a3b8' }}>
          {matchedStr.slice(1, -1)}
        </em>
      );
    } else {
      tokens.push(matchedStr);
    }

    remaining = remaining.substring(index + matchedStr.length);
  }

  return tokens;
}

/**
 * Lightweight, safe Markdown renderer for Ledger AI output.
 * Renders:
 * - Headings (#, ##, ###)
 * - Lists (*, -, •, 1.)
 * - Blockquotes (>)
 * - Paragraphs with bold, italic, inline code
 */
export default function MarkdownRenderer({ content, className = '' }) {
  if (!content) return null;

  const rawLines = content.split('\n');
  const elements = [];
  let currentList = null; // { type: 'ul' | 'ol', items: [] }

  const flushList = () => {
    if (currentList) {
      const ListTag = currentList.type;
      elements.push(
        <ListTag
          key={`list-${elements.length}`}
          style={{
            margin: '8px 0',
            paddingLeft: currentList.type === 'ol' ? '24px' : '18px',
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
          }}
        >
          {currentList.items.map((item, idx) => (
            <li
              key={idx}
              style={{
                lineHeight: 1.6,
                color: '#e2e8f0',
                listStyleType: currentList.type === 'ol' ? 'decimal' : 'disc',
              }}
            >
              {parseInline(item)}
            </li>
          ))}
        </ListTag>
      );
      currentList = null;
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();

    // Empty line separates blocks
    if (!trimmed) {
      flushList();
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      flushList();
      elements.push(
        <h4
          key={`h3-${i}`}
          style={{
            fontSize: '1rem',
            fontWeight: 750,
            color: '#38bdf8',
            margin: '14px 0 6px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            letterSpacing: '-0.01em',
          }}
        >
          {parseInline(trimmed.substring(4))}
        </h4>
      );
      continue;
    }

    if (trimmed.startsWith('## ')) {
      flushList();
      elements.push(
        <h3
          key={`h2-${i}`}
          style={{
            fontSize: '1.08rem',
            fontWeight: 800,
            color: '#f8fafc',
            margin: '16px 0 8px',
            letterSpacing: '-0.01em',
          }}
        >
          {parseInline(trimmed.substring(3))}
        </h3>
      );
      continue;
    }

    if (trimmed.startsWith('# ')) {
      flushList();
      elements.push(
        <h2
          key={`h1-${i}`}
          style={{
            fontSize: '1.2rem',
            fontWeight: 850,
            color: '#f8fafc',
            margin: '18px 0 10px',
            letterSpacing: '-0.02em',
          }}
        >
          {parseInline(trimmed.substring(2))}
        </h2>
      );
      continue;
    }

    // Unordered List Items (*, -, •)
    const bulletMatch = trimmed.match(/^(\*|-|•)\s+(.*)/);
    if (bulletMatch) {
      if (!currentList || currentList.type !== 'ul') {
        flushList();
        currentList = { type: 'ul', items: [] };
      }
      currentList.items.push(bulletMatch[2]);
      continue;
    }

    // Ordered List Items (1. , 2. )
    const numberedMatch = trimmed.match(/^\d+\.\s+(.*)/);
    if (numberedMatch) {
      if (!currentList || currentList.type !== 'ol') {
        flushList();
        currentList = { type: 'ol', items: [] };
      }
      currentList.items.push(numberedMatch[1]);
      continue;
    }

    // Blockquote (> )
    if (trimmed.startsWith('> ')) {
      flushList();
      elements.push(
        <blockquote
          key={`quote-${i}`}
          style={{
            borderLeft: '3px solid #38bdf8',
            margin: '8px 0',
            padding: '6px 12px',
            background: 'rgba(56, 189, 248, 0.05)',
            borderRadius: '0 8px 8px 0',
            color: '#94a3b8',
            fontSize: '0.88rem',
          }}
        >
          {parseInline(trimmed.substring(2))}
        </blockquote>
      );
      continue;
    }

    // Standard Paragraph
    flushList();
    elements.push(
      <p
        key={`p-${i}`}
        style={{
          margin: '6px 0',
          lineHeight: 1.65,
          color: '#e2e8f0',
        }}
      >
        {parseInline(line)}
      </p>
    );
  }

  flushList();

  return <div className={`ledger-markdown ${className}`}>{elements}</div>;
}
