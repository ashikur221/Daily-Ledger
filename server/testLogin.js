require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const user = await User.findOne({ email: 'ashikur1602@gmail.com' });
  console.log('User found:', !!user);
  if (user) {
    console.log('User object:', {
      id: user._id,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
      inviteUsed: user.inviteUsed,
      hasHash: !!user.passwordHash,
      hashPrefix: user.passwordHash ? user.passwordHash.substring(0, 10) : null
    });
    const match = await user.comparePassword('password');
    console.log('Does "password" match comparePassword?:', match);
  }
  process.exit(0);
}).catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
