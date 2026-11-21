# 📒 Daily Ledger — Personal Finance System

Modern, offline-first personal finance tracker upgraded from the original single-file prototype into a full-stack **React + Express + MongoDB** architecture.

---

## 🏗️ Architecture

- **Frontend (`/client`)**:
  - React 19 + Vite
  - Dexie (IndexedDB) for 100% offline support
  - Sync engine: works offline first, auto-syncs to cloud when online
  - Recharts for financial analytics and breakdowns
  - Optimized for **Vercel** hosting with SPA client routing

- **Backend (`/server`)**:
  - Node.js + Express
  - MongoDB Atlas via Mongoose
  - JWT auth (Access token in memory + HttpOnly Refresh token cookie)
  - Full backup export/import (JSON)
  - Optimized for **Render** hosting with automatic deployments via GitHub

---

## 🚀 Hosting & Deployment Guide

### 1. Backend on **Render**
1. Push this repository to your GitHub.
2. In [Render Dashboard](https://dashboard.render.com/):
   - Click **New +** -> **Web Service**.
   - Connect your GitHub repository.
   - Set **Root Directory**: `server`
   - Set **Build Command**: `npm install`
   - Set **Start Command**: `node server.js`
3. In **Environment Variables**, add:
   - `MONGODB_URI`: Your MongoDB Atlas connection string (free tier at [mongodb.com](https://mongodb.com)).
   - `JWT_ACCESS_SECRET`: Long random string.
   - `JWT_REFRESH_SECRET`: Long random string.
   - `CLIENT_ORIGIN`: Your frontend URL (e.g., `https://your-app.vercel.app`).
   - `NODE_ENV`: `production`

---

### 2. Frontend on **Vercel**
1. In [Vercel Dashboard](https://vercel.com/):
   - Click **Add New Project** and select your GitHub repository.
   - Set **Root Directory**: `client`
   - Framework Preset: **Vite**
2. In **Environment Variables**:
   - `VITE_API_URL`: Your Render backend URL + `/api` (e.g., `https://daily-ledger-api.onrender.com/api`).
3. Deploy! Every time you `git push` to your GitHub repo, both Vercel and Render will build and deploy your updates automatically.

---

## 💻 Local Development

### Run Backend
```bash
cd server
npm install
# Ensure .env is populated (see .env.example)
npm run dev
```

### Run Frontend
```bash
cd client
npm install
npm run dev
```
Open [http://localhost:5173](http://localhost:5173).
