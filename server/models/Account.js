const mongoose = require('mongoose');

const accountSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    localId: {
      type: String,
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    type: {
      type: String,
      enum: ['bank', 'mfs', 'cash', 'fdr', 'asset', 'other'],
      default: 'bank',
    },
    balance: {
      type: Number,
      default: 0,
    },
    institution: {
      type: String,
      default: '',
      trim: true,
    },
    accountNumber: {
      type: String,
      default: '',
      trim: true,
    },
    maturityDate: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: '',
      trim: true,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    clientUpdatedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

accountSchema.index({ userId: 1, localId: 1 }, { unique: true });
accountSchema.index({ userId: 1, isDeleted: 1, updatedAt: -1 });
accountSchema.index({ userId: 1, isDeleted: 1, type: 1 });

module.exports = mongoose.model('Account', accountSchema);
