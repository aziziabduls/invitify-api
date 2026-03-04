const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../utils/db');

const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const { email, username, fullName, password } = req.body;
    console.log(req.body);
    if (!email || !username || !fullName || !password) {
      return res.status(400).json({ error: 'Email, username, full_name and password are required' });
    }

    const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, username, full_name, password_hash) VALUES ($1, $2, $3, $4) RETURNING id, email, username, full_name, created_at',
      [email, username, fullName, passwordHash],
    );

    const user = result.rows[0];

    return res.status(201).json({ user });
  } catch (err) {
    return next(err);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query(
      'SELECT id, email, username, full_name, password_hash FROM users WHERE email = $1',
      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const passwordValid = await bcrypt.compare(password, user.password_hash);

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { sub: user.id, email: user.email, username: user.username, full_name: user.full_name },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '24h' },
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email, username: user.username, full_name: user.full_name },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

