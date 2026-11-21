const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Account = require('../models/Account');
const Tool = require('../models/Tool');
const User = require('../models/User');

async function syncAllIndexes() {
  try {
    console.log('Connecting to MongoDB Atlas...');
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not defined in .env');

    await mongoose.connect(uri);
    console.log('✅ Connected to MongoDB Atlas');

    console.log('\n--- Syncing Indexes ---');

    console.log('1. Building Transaction indexes...');
    await Transaction.syncIndexes();
    const txIndexes = await Transaction.collection.indexes();
    console.log('Transaction indexes created:', txIndexes.map((i) => i.name));

    console.log('\n2. Building Account indexes...');
    await Account.syncIndexes();
    const accIndexes = await Account.collection.indexes();
    console.log('Account indexes created:', accIndexes.map((i) => i.name));

    console.log('\n3. Building Tool indexes...');
    await Tool.syncIndexes();
    const toolIndexes = await Tool.collection.indexes();
    console.log('Tool indexes created:', toolIndexes.map((i) => i.name));

    console.log('\n4. Building User indexes...');
    await User.syncIndexes();
    const userIndexes = await User.collection.indexes();
    console.log('User indexes created:', userIndexes.map((i) => i.name));

    console.log('\n✨ All compound & text indexes built successfully on MongoDB Atlas!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Index synchronization failed:', err);
    process.exit(1);
  }
}

syncAllIndexes();
