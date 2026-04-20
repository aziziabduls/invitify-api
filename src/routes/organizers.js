const express = require('express');
const { pool } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const router = express.Router();

router.use(authMiddleware);

const organizerColumns = 'id, user_id, name, domain, scope, category, format, created_at, updated_at';

// GET /organizers - List all organizers
router.get('/', async (req, res, next) => {
    try {
        const { name, domain } = req.query;
        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        let query = isSuperAdmin
            ? `SELECT ${organizerColumns} FROM organizers WHERE 1=1`
            : `SELECT ${organizerColumns} FROM organizers WHERE user_id = $1`;
        const params = isSuperAdmin ? [] : [req.user.id];

        if (name || domain) {
            if (name) {
                params.push(`%${name}%`);
                query += ` AND name ILIKE $${params.length}`;
            }
            if (domain) {
                params.push(`%${domain}%`);
                query += ` AND domain ILIKE $${params.length}`;
            }
        }

        query += ' ORDER BY name ASC';
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// POST /organizers - Create a new organizer
router.post('/', async (req, res, next) => {
    try {
        const { name, domain, scope, category, format } = req.body;

        // Validation
        if (!name || !domain) {
            return res.status(400).json({ error: 'name and domain are required' });
        }

        // domain must only contain lowercase letters, numbers, and hyphens
        const domainRegex = /^[a-z0-9-]+$/;
        if (!domainRegex.test(domain)) {
            return res.status(400).json({ error: 'domain must only contain lowercase letters, numbers, and hyphens' });
        }

        // format must be either "hybrid" or "non-hybrid"
        if (format && !['hybrid', 'non-hybrid'].includes(format)) {
            return res.status(400).json({ error: 'format must be either "hybrid" or "non-hybrid"' });
        }

        // Check for unique domain
        const existing = await pool.query('SELECT id FROM organizers WHERE domain = $1', [domain]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'domain must be unique' });
        }

        const result = await pool.query(
            `INSERT INTO organizers (user_id, name, domain, scope, category, format)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${organizerColumns}`,
            [req.user.id, name, domain, scope || null, category || null, format || null]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// GET /organizers/:id - Get details for a specific organizer
router.get('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;
        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const query = isSuperAdmin
            ? `SELECT ${organizerColumns} FROM organizers WHERE id = $1`
            : `SELECT ${organizerColumns} FROM organizers WHERE id = $1 AND user_id = $2`;
        const params = isSuperAdmin ? [id] : [id, req.user.id];

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Organizer not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// GET /organizers/:id/events - Get all events associated with a specific organizer
router.get('/:id/events', async (req, res, next) => {
    try {
        const { id } = req.params;

        // First check if organizer exists and belongs to user
        // First check if organizer exists
        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const query = isSuperAdmin
            ? 'SELECT id FROM organizers WHERE id = $1'
            : 'SELECT id FROM organizers WHERE id = $1 AND user_id = $2';
        const params = isSuperAdmin ? [id] : [id, req.user.id];

        const organizer = await pool.query(query, params);
        if (organizer.rows.length === 0) {
            return res.status(404).json({ error: 'Organizer not found' });
        }

        const result = await pool.query(
            `SELECT e.* FROM events e
       JOIN organizer_events oe ON e.id = oe.event_id
       WHERE oe.organizer_id = $1
       ORDER BY e.start_date ASC`,
            [id]
        );

        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// POST /organizers/:id/events - Link an existing event to an organizer
router.post('/:id/events', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { event_id } = req.body;

        if (!event_id) {
            return res.status(400).json({ error: 'event_id is required' });
        }

        // Check if organizer exists and belongs to user
        // Check if organizer exists
        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const query = isSuperAdmin
            ? 'SELECT id FROM organizers WHERE id = $1'
            : 'SELECT id FROM organizers WHERE id = $1 AND user_id = $2';
        const params = isSuperAdmin ? [id] : [id, req.user.id];

        const organizer = await pool.query(query, params);
        if (organizer.rows.length === 0) {
            return res.status(404).json({ error: 'Organizer not found' });
        }

        // Check if event exists
        const event = await pool.query('SELECT id FROM events WHERE id = $1', [event_id]);
        if (event.rows.length === 0) {
            return res.status(404).json({ error: 'Event not found' });
        }

        // Check if link already exists
        const link = await pool.query(
            'SELECT id FROM organizer_events WHERE organizer_id = $1 AND event_id = $2',
            [id, event_id]
        );
        if (link.rows.length > 0) {
            return res.status(400).json({ error: 'Link already exists' });
        }

        await pool.query(
            'INSERT INTO organizer_events (organizer_id, event_id) VALUES ($1, $2)',
            [id, event_id]
        );

        res.status(201).json({ message: 'Event linked to organizer successfully' });
    } catch (err) {
        next(err);
    }
});

// DELETE /organizers/:id/events/:eventId - Unlink an event from an organizer
router.delete('/:id/events/:eventId', async (req, res, next) => {
    try {
        const { id, eventId } = req.params;

        // Check if organizer exists and belongs to user
        // Check if organizer exists
        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const query = isSuperAdmin
            ? 'SELECT id FROM organizers WHERE id = $1'
            : 'SELECT id FROM organizers WHERE id = $1 AND user_id = $2';
        const params = isSuperAdmin ? [id] : [id, req.user.id];

        const organizer = await pool.query(query, params);
        if (organizer.rows.length === 0) {
            return res.status(404).json({ error: 'Organizer not found' });
        }

        const result = await pool.query(
            'DELETE FROM organizer_events WHERE organizer_id = $1 AND event_id = $2 RETURNING id',
            [id, eventId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Link between organizer and event not found' });
        }

        res.json({ success: true, message: 'Event unlinked from organizer successfully' });
    } catch (err) {
        next(err);
    }
});


// DELETE /organizers/:id - Remove an organizer and its associations
router.delete('/:id', async (req, res, next) => {
    try {
        const { id } = req.params;

        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const query = isSuperAdmin
            ? 'DELETE FROM organizers WHERE id = $1 RETURNING id'
            : 'DELETE FROM organizers WHERE id = $1 AND user_id = $2 RETURNING id';
        const params = isSuperAdmin ? [id] : [id, req.user.id];

        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Organizer not found' });
        }

        res.json({ success: true, message: 'Organizer removed successfully' });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
