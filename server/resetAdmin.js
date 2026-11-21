require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./models/User');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  // Delete old broken record
  await User.deleteOne({ email: 'ashikur1602@gmail.com' });
  console.log('Deleted old user');

  // Save plain password — pre-save hook will hash it correctly now
  const admin = new User({
    name: 'Admin',
    email: 'ashikur1602@gmail.com',
    passwordHash: 'password',   // plain — hook hashes it once
    role: 'admin',
    isActive: true,
    inviteUsed: true,
  });
  await admin.save();

  console.log('✅ Admin recreated!');
  console.log('   Email:    ashikur1602@gmail.com');
  console.log('   Password: password');
  process.exit(0);
}).catch(err => { console.error(err.message); process.exit(1); });
