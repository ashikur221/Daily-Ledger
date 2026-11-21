require('dotenv').config();
const mongoose = require('mongoose');
const { login } = require('./controllers/authController');

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const req = {
    body: {
      email: 'ashikur1602@gmail.com',
      password: 'password'
    }
  };
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    cookie(name, val, opts) {
      console.log('Cookie set:', name, val ? 'YES' : 'NO');
    },
    json(data) {
      console.log('Response JSON:', this.statusCode, data);
    }
  };

  try {
    await login(req, res);
  } catch (e) {
    console.error('Caught error during login:', e);
  }
  process.exit(0);
}).catch(err => {
  console.error('DB error:', err);
  process.exit(1);
});
