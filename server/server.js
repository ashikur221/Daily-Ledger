require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/db');
const bootstrapAdmin = require('./config/bootstrap');
const authRoutes = require('./routes/auth');
const transactionRoutes = require('./routes/transactions');
const accountRoutes = require('./routes/accounts');
const toolRoutes = require('./routes/tools');
const adminRoutes = require('./routes/admin');
const syncRoutes = require('./routes/sync');

const app = express();

// Connect to MongoDB then bootstrap admin
const startServer = async () => {
  await connectDB();
  await bootstrapAdmin();
};
startServer();

// Security middleware
app.use(helmet());

// CORS — allow the React client
app.use(
  cors({
    origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
    credentials: true, // allow cookies (refresh token)
  })
);

// Body parsers
app.use(express.json({ limit: '5mb' })); // 5mb for receipt images
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// Rate limiting — stricter on auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // max 10 login attempts per 15 min
  message: { message: 'Too many attempts, please try again after 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  message: { message: 'Too many requests' },
});

// Apply limiters
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/', apiLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/tools', toolRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api', adminRoutes);

// Health check
app.get(['/health', '/api/health'], (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// 404 handler
app.use((req, res) => res.status(404).json({ message: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ message: 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT} [${process.env.NODE_ENV || 'development'}]`));
