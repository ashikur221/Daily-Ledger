const mongoose = require('mongoose');
const Transaction = require('./models/Transaction');

mongoose.connect('mongodb+srv://compassAdmin2:nXw7lwGEQqL2TVGl@cluster0.bpilnp1.mongodb.net/daily-ledger')
  .then(async () => {
    const count = await Transaction.countDocuments();
    const all = await Transaction.find().lean();
    console.log('Mongo Total Transactions:', count);
    const exp = all.filter(t => t.type === 'expense');
    console.log('Mongo Expenses:', exp.length, 'Sum:', exp.reduce((s,t)=>s+(t.amount||0), 0));
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
