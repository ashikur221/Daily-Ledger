const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const User = require('../models/User');

// Generate access + refresh tokens
const generateTokens = (userId, rememberMe = true) => {
  const accessToken = jwt.sign({ id: userId }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  });
  const refreshExpires = rememberMe ? (process.env.JWT_REFRESH_EXPIRES || '90d') : '1d';
  const refreshToken = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: refreshExpires,
  });
  return { accessToken, refreshToken };
};

const setRefreshCookie = (res, token, rememberMe = true) => {
  const maxAge = rememberMe ? 90 * 24 * 60 * 60 * 1000 : 24 * 60 * 60 * 1000; // 90 days or 1 day
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    maxAge,
  });
};

// POST /api/auth/register
// Body: { name, email, password, inviteToken }
const register = async (req, res) => {
  try {
    const { name, email, password, inviteToken } = req.body;

    if (!name || !email || !password || !inviteToken) {
      return res.status(400).json({ message: 'All fields are required including invite token' });
    }

    // Check invite token
    const invitee = await User.findOne({ inviteToken, inviteUsed: false });
    if (!invitee || invitee.email !== email.toLowerCase()) {
      return res.status(400).json({ message: 'Invalid or expired invite token' });
    }

    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters' });
    }

    // Update the pre-created user record with the actual password
    invitee.name = name;
    invitee.passwordHash = password; // will be hashed by pre-save hook
    invitee.inviteUsed = true;
    invitee.inviteToken = null;
    await invitee.save();

    const { accessToken, refreshToken } = generateTokens(invitee._id);
    invitee.refreshToken = refreshToken;
    invitee.lastLoginAt = new Date();
    await invitee.save();

    setRefreshCookie(res, refreshToken);
    res.status(201).json({ accessToken, user: invitee });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ message: 'Server error during registration' });
  }
};

// POST /api/auth/login
// Body: { email, password, rememberMe }
const login = async (req, res) => {
  try {
    const { email, password, rememberMe = true } = req.body;
    if (!email || !password) {
      console.log('Login failed: missing email or password');
      return res.status(400).json({ message: 'Email and password are required' });
    }

    const cleanEmail = email.toLowerCase().trim();
    console.log(`[AUTH] Login attempt for: "${cleanEmail}" (raw: "${email}", rememberMe: ${rememberMe})`);

    const user = await User.findOne({ email: cleanEmail });
    if (!user) {
      console.log(`[AUTH] User not found for email: "${cleanEmail}"`);
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    if (!user.isActive) {
      console.log(`[AUTH] User account is inactive: "${cleanEmail}"`);
      return res.status(401).json({ message: 'Account is deactivated' });
    }

    // Reject if invite not yet accepted (no password set)
    if (!user.inviteUsed && user.role !== 'admin') {
      console.log(`[AUTH] Invite not accepted for: "${cleanEmail}"`);
      return res.status(401).json({ message: 'Please complete registration via your invite link first' });
    }

    const isMatch = await user.comparePassword(password);
    console.log(`[AUTH] Password match result for "${cleanEmail}":`, isMatch);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }

    const { accessToken, refreshToken } = generateTokens(user._id, rememberMe);
    user.refreshToken = refreshToken;
    user.lastLoginAt = new Date();
    await user.save();

    setRefreshCookie(res, refreshToken, rememberMe);
    console.log(`[AUTH] Login successful for: "${cleanEmail}"`);
    res.json({ accessToken, refreshToken, user });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error during login' });
  }
};

// POST /api/auth/refresh
const refreshAccessToken = async (req, res) => {
  try {
    const token = req.cookies.refreshToken || req.body?.refreshToken || req.headers['x-refresh-token'];
    if (!token) return res.status(401).json({ message: 'No refresh token' });

    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const user = await User.findById(decoded.id);

    if (!user || user.refreshToken !== token) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }

    const { accessToken, refreshToken } = generateTokens(user._id, true);
    user.refreshToken = refreshToken;
    await user.save();

    setRefreshCookie(res, refreshToken, true);
    res.json({ accessToken, refreshToken, user });
  } catch (err) {
    res.status(401).json({ message: 'Refresh token expired or invalid' });
  }
};

// POST /api/auth/logout
const logout = async (req, res) => {
  try {
    const token = req.cookies.refreshToken || req.body?.refreshToken || req.headers['x-refresh-token'];
    if (token) {
      await User.findOneAndUpdate({ refreshToken: token }, { refreshToken: null });
    }
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Logout error' });
  }
};

// GET /api/auth/me
const getMe = (req, res) => {
  res.json({ user: req.user });
};

module.exports = { register, login, refreshAccessToken, logout, getMe };
