const mongoose = require('mongoose');

// Stores advanced tool data: savings goals, debts, bills, budgets
const toolSchema = new mongoose.Schema(
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
    toolType: {
      type: String,
      enum: ['savings_goal', 'debt', 'bill', 'budget', 'checklist', 'todo', 'vault_item'],
      required: true,
    },
    // Flexible JSON data payload for each tool type
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
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

toolSchema.index({ userId: 1, localId: 1 }, { unique: true });
toolSchema.index({ userId: 1, isDeleted: 1, toolType: 1 });
toolSchema.index({ userId: 1, isDeleted: 1, updatedAt: -1 });

module.exports = mongoose.model('Tool', toolSchema);
