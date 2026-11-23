const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
    },
    role: {
      type: String,
      enum: ['admin', 'member'],
      default: 'member',
    },
    // Invite token for invite-only registration
    inviteToken: {
      type: String,
      default: null,
    },
    inviteUsed: {
      type: Boolean,
      default: false,
    },
    // Refresh token storage
    refreshToken: {
      type: String,
      default: null,
    },
    previousRefreshToken: {
      type: String,
      default: null,
    },
    refreshTokenUpdatedAt: {
      type: Date,
      default: null,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

// Hash password before saving (skip if already a bcrypt hash)
userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return;
  if (this.passwordHash.startsWith('$2')) return; // already hashed
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12);
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword) {
  return bcrypt.compare(candidatePassword, this.passwordHash);
};

// Never return passwordHash or refreshToken in JSON
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.passwordHash;
  delete obj.refreshToken;
  delete obj.inviteToken;
  return obj;
};

userSchema.index({ inviteToken: 1 });
userSchema.index({ role: 1, isActive: 1 });

module.exports = mongoose.model('User', userSchema);
