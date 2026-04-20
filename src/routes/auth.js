const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { pool } = require('../utils/db');

const router = express.Router();

router.post('/register', async (req, res, next) => {
  try {
    const { email, username, fullName, password } = req.body;
    if (!email || !username || !fullName || !password) {
      return res.status(400).json({ error: 'Email, username, full_name and password are required' });
    }

    const existingEmail = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existingEmail.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Get default role (EVENT_ORGANIZER)
    const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', ['EVENT_ORGANIZER']);
    const defaultRoleId = roleResult.rows[0]?.id;

    const result = await pool.query(
      'INSERT INTO users (email, username, full_name, password_hash, role_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, username, full_name, created_at',
      [email, username, fullName, passwordHash, defaultRoleId],
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
      `SELECT u.id, u.email, u.username, u.full_name, u.password_hash, u.is_active, r.name as role 
       FROM users u 
       LEFT JOIN roles r ON u.role_id = r.id 
       WHERE u.email = $1`,
      [email],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];

    // Check if user is active
    if (user.is_active === false) {
      return res.status(403).json({ error: 'Your account is currently inactive. Please contact the administrator.' });
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Update last login
    await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = jwt.sign(
      { sub: user.id, email: user.email, username: user.username, full_name: user.full_name, role: user.role },
      process.env.JWT_SECRET || 'dev_secret',
      { expiresIn: '24h' },
    );

    return res.json({
      token,
      user: { id: user.id, email: user.email, username: user.username, full_name: user.full_name, role: user.role },
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;

