const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const bootstrapAdmin = async () => {
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@1234';

    if (!adminEmail) {
      console.log('⚠  ADMIN_EMAIL not set in .env — skipping admin bootstrap');
      return;
    }

    // Dynamically require User AFTER mongoose is connected
    const User = require('../models/User');

    const existing = await User.findOne({ email: adminEmail.toLowerCase() });
    if (existing) {
      console.log(`ℹ  Admin already exists: ${adminEmail}`);
      return;
    }

    // Hash password manually (avoid pre-save hook timing issues)
    const passwordHash = await bcrypt.hash(adminPassword, 12);

    await User.create({
      name: 'Admin',
      email: adminEmail.toLowerCase(),
      passwordHash,
      role: 'admin',
      isActive: true,
      inviteUsed: true,
    });

    console.log(`✅ Admin account created: ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
  } catch (err) {
    console.error('Bootstrap error:', err.message);
  }
};

module.exports = bootstrapAdmin;
