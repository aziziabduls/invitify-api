const express = require('express');
const { pool } = require('../utils/db');
const auth = require('../middleware/auth');

const router = express.Router();

router.use(auth);

router.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT id, title, description, created_at, updated_at FROM items WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, title, description, created_at, updated_at FROM items WHERE id = $1 AND user_id = $2',
      [id, req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.post('/', async (req, res, next) => {
  try {
    const { title, description } = req.body;
    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }
    const result = await pool.query(
      'INSERT INTO items (user_id, title, description) VALUES ($1, $2, $3) RETURNING id, title, description, created_at, updated_at',
      [req.user.id, title, description || null],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { title, description } = req.body;
    const result = await pool.query(
      `
      UPDATE items
      SET title = COALESCE($1, title),
          description = COALESCE($2, description),
          updated_at = NOW()
      WHERE id = $3 AND user_id = $4
      RETURNING id, title, description, created_at, updated_at
    `,
      [title || null, description || null, id, req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM items WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    // res.json({ success: true });
    res.status(201).json({ message: 'Item deleted successfully' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

