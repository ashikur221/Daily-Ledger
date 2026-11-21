import React from 'react';
import { NavLink } from 'react-router-dom';

export default function DeveloperPage() {
  const skills = [
    { name: 'React', icon: '⚛️', color: '#61dafb' },
    { name: 'Tailwind CSS', icon: '🌊', color: '#38bdf8' },
    { name: 'Node.js', icon: '🟩', color: '#68a063' },
    { name: 'Express', icon: '⚡', color: '#e2e8f0' },
    { name: 'MongoDB', icon: '🍃', color: '#47a248' },
    { name: 'Figma', icon: '🎨', color: '#f24e1e' },
    { name: 'GitHub', icon: '🐙', color: '#f0f6fc' },
    { name: 'IndexedDB / PWA', icon: '📱', color: '#a78bfa' },
  ];

  const highlights = [
    { title: 'Offline-First Architect', desc: 'Crafting resilient web apps that function seamlessly without an internet connection using IndexedDB, background sync, and local caching.' },
    { title: 'Full-Stack Engineering', desc: 'End-to-end mastery from reactive client interfaces in React to scalable RESTful APIs in Node.js and cloud databases on MongoDB Atlas.' },
    { title: 'UI/UX & Product Design', desc: 'Deep passion for futuristic neon themes, smooth motion, high-performance interactions, and intuitive human experiences.' },
  ];

  return (
    <div style={{ maxWidth: '980px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '32px', paddingBottom: '60px' }}>
      
      {/* 1. Hero Card matching the uploaded poster */}
      <div
        className="panel"
        style={{
          background: 'radial-gradient(circle at 15% 50%, rgba(220, 38, 38, 0.28) 0%, #050608 75%)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: '24px',
          padding: '36px 32px',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 20px 50px rgba(0, 0, 0, 0.8), 0 0 30px rgba(220, 38, 38, 0.15)',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: '36px' }}>
          
          {/* Developer Photo */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div
              style={{
                position: 'absolute',
                inset: '-10px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, rgba(239, 68, 68, 0.5) 0%, transparent 70%)',
                filter: 'blur(16px)',
                zIndex: 0,
              }}
            />
            <div
              style={{
                width: '180px',
                height: '180px',
                borderRadius: '50%',
                border: '3px solid #ef4444',
                boxShadow: '0 0 25px rgba(239, 68, 68, 0.5), inset 0 0 15px rgba(239, 68, 68, 0.3)',
                overflow: 'hidden',
                position: 'relative',
                zIndex: 1,
                background: '#090d15',
              }}
            >
              <img
                src="/developer.jpg"
                alt="Ashikur Rahman"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                  objectPosition: 'center 15%',
                }}
                onError={(e) => {
                  // Fallback to placeholder if asset load fails
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.parentElement.innerHTML = '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:3rem;color:#ef4444;font-weight:800;">AR</div>';
                }}
              />
            </div>
            {/* Glowing Code Tag Badge */}
            <div
              style={{
                position: 'absolute',
                bottom: '4px',
                right: '4px',
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: '#ef4444',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 900,
                fontSize: '0.9rem',
                boxShadow: '0 0 16px #ef4444',
                zIndex: 2,
              }}
            >
              &lt;/&gt;
            </div>
          </div>

          {/* Details Column */}
          <div style={{ flex: 1, minWidth: '280px', zIndex: 1 }}>
            <div
              style={{
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '0.22em',
                fontWeight: 800,
                color: '#ef4444',
                marginBottom: '8px',
              }}
            >
              ABOUT ME
            </div>

            <h1
              style={{
                fontSize: '2.4rem',
                fontWeight: 900,
                letterSpacing: '-0.02em',
                margin: 0,
                color: '#ffffff',
                lineHeight: 1.15,
              }}
            >
              Ashikur <span style={{ color: '#ef4444' }}>Rahman</span>
            </h1>

            <div
              style={{
                fontSize: '0.95rem',
                fontWeight: 600,
                color: '#cbd5e1',
                marginTop: '10px',
                letterSpacing: '0.01em',
              }}
            >
              Frontend Developer <span style={{ color: '#ef4444' }}>|</span> Software Developer <span style={{ color: '#ef4444' }}>|</span> Digital Creator
            </div>

            <p
              style={{
                fontSize: '0.92rem',
                color: '#94a3b8',
                lineHeight: 1.65,
                marginTop: '14px',
                maxWidth: '620px',
              }}
            >
              I'm a Computer Science graduate and software developer passionate about building meaningful digital experiences. 
              I love turning ideas into reality through clean code, design creativity, and continuous learning.
            </p>

            {/* Signature Tagline */}
            <div
              style={{
                marginTop: '20px',
                fontFamily: 'cursive, sans-serif',
                fontSize: '1.25rem',
                color: '#ffffff',
                letterSpacing: '0.04em',
              }}
            >
              Think. Build. <span style={{ color: '#ef4444', fontStyle: 'italic', textDecoration: 'underline' }}>Learn. Repeat.</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Tech Stack & Tools Grid */}
      <div
        className="panel"
        style={{
          background: '#050608',
          border: '1px solid #1a202c',
          borderRadius: '20px',
          padding: '28px 24px',
        }}
      >
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', margin: 0, marginBottom: '6px' }}>
          Technologies & Core Stack
        </h2>
        <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0, marginBottom: '20px' }}>
          The modern tools, frameworks, and architecture patterns powering this project and daily workflows.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
          {skills.map((s) => (
            <div
              key={s.name}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                background: '#0d1117',
                border: '1px solid #232a3b',
                padding: '10px 18px',
                borderRadius: '12px',
                fontSize: '0.88rem',
                fontWeight: 600,
                color: '#f1f5f9',
                transition: 'all 0.2s ease',
              }}
            >
              <span>{s.icon}</span>
              <span>{s.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 3. About The Project: Daily Ledger */}
      <div
        className="panel"
        style={{
          background: '#050608',
          border: '1px solid #1a202c',
          borderRadius: '20px',
          padding: '28px 24px',
        }}
      >
        <h2 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f8fafc', margin: 0, marginBottom: '6px' }}>
          About The Daily Ledger Project
        </h2>
        <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0, marginBottom: '20px' }}>
          Architectural philosophy and real-world problems solved by this application.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' }}>
          {highlights.map((h, i) => (
            <div
              key={i}
              style={{
                background: '#0d1117',
                border: '1px solid #1e2638',
                borderRadius: '14px',
                padding: '18px 20px',
              }}
            >
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#f87171', margin: 0, marginBottom: '8px' }}>
                {h.title}
              </h3>
              <p style={{ fontSize: '0.82rem', color: '#94a3b8', lineHeight: 1.6, margin: 0 }}>
                {h.desc}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 4. Contact & Links Footer */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '16px',
          padding: '16px 8px',
          borderTop: '1px solid #141a27',
        }}
      >
        <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
          Designed & Built with ❤️ by <strong style={{ color: '#f1f5f9' }}>Ashikur Rahman</strong>
        </div>

        <div style={{ display: 'flex', gap: '14px' }}>
          <a
            href="https://github.com/ashikur221"
            target="_blank"
            rel="noopener noreferrer"
            className="secondary"
            style={{
              height: '38px',
              padding: '0 16px',
              borderRadius: '10px',
              fontSize: '0.82rem',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            🐙 GitHub
          </a>
          <NavLink
            to="/"
            className="primary"
            style={{
              height: '38px',
              padding: '0 18px',
              borderRadius: '10px',
              fontSize: '0.82rem',
              fontWeight: 600,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            ← Back to Ledger
          </NavLink>
        </div>
      </div>

    </div>
  );
}
