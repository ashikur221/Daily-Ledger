const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    // The user who owns this transaction
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    // localId is a UUID generated on the client device — used for offline sync deduplication
    localId: {
      type: String,
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['expense', 'income', 'bank', 'transfer'],
      required: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      trim: true,
      default: '',
    },
    // The account this transaction belongs to (e.g., "bKash", "Dutch-Bangla", "Cash")
    account: {
      type: String,
      trim: true,
      default: '',
    },
    // For transfers: the destination account
    toAccount: {
      type: String,
      trim: true,
      default: '',
    },
    date: {
      type: Date,
      required: true,
    },
    note: {
      type: String,
      trim: true,
      default: '',
    },
    // Receipt image stored as a base64 data URL (small images only)
    receiptImage: {
      type: String,
      default: null,
    },
    // Soft delete — deleted records are marked rather than removed (preserves sync history)
    isDeleted: {
      type: Boolean,
      default: false,
    },
    // Timestamp from the client device (used for conflict resolution)
    clientUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Compound index: one localId per user
transactionSchema.index({ userId: 1, localId: 1 }, { unique: true });

// Index for efficient date range queries and delta sync
transactionSchema.index({ userId: 1, date: -1 });
transactionSchema.index({ userId: 1, isDeleted: 1, updatedAt: -1 });

module.exports = mongoose.model('Transaction', transactionSchema);
