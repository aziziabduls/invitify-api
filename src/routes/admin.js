const express = require('express');
const { pool } = require('../utils/db');
const { authMiddleware, checkRole } = require('../middleware/auth');
const router = express.Router();

router.use(authMiddleware);
router.use(checkRole(['SUPER_ADMIN']));

// GET /admin/users - List all users with their roles
router.get('/users', async (req, res, next) => {
    try {
        const result = await pool.query(`
            SELECT 
                u.id, 
                u.email, 
                u.username, 
                u.full_name, 
                u.created_at, 
                u.last_login_at, 
                u.is_active, 
                r.name as role,
                (SELECT COUNT(*) FROM organizers o WHERE o.user_id = u.id) as total_organizer,
                (SELECT COUNT(*) FROM events e WHERE e.user_id = u.id) as total_event
            FROM users u
            LEFT JOIN roles r ON u.role_id = r.id
            ORDER BY u.created_at DESC
        `);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// PATCH /admin/users/:id/role - Update a user's role
router.patch('/users/:id/role', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { role_name } = req.body;

        if (!role_name) {
            return res.status(400).json({ error: 'role_name is required' });
        }

        const roleResult = await pool.query('SELECT id FROM roles WHERE name = $1', [role_name]);
        if (roleResult.rows.length === 0) {
            return res.status(404).json({ error: 'Role not found' });
        }

        const result = await pool.query(
            'UPDATE users SET role_id = $1 WHERE id = $2 RETURNING id, email, username, role_id',
            [roleResult.rows[0].id, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// PATCH /admin/users/:id/status - Toggle user active status
router.patch('/users/:id/status', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { is_active } = req.body;

        if (is_active === undefined) {
            return res.status(400).json({ error: 'is_active is required' });
        }

        const result = await pool.query(
            'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, email, is_active',
            [is_active, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// GET /admin/roles - List all roles
router.get('/roles', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT id, name, description, created_at FROM roles ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// POST /admin/roles - Create a new role
router.post('/roles', async (req, res, next) => {
    try {
        const { name, description } = req.body;
        if (!name) return res.status(400).json({ error: 'name is required' });

        const result = await pool.query(
            'INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *',
            [name.toUpperCase(), description || null]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// GET /admin/menus - List all menus
router.get('/menus', async (req, res, next) => {
    try {
        const result = await pool.query('SELECT * FROM menus ORDER BY id ASC');
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET /admin/roles/:id/menus - Get menus assigned to a role
router.get('/roles/:id/menus', async (req, res, next) => {
    try {
        const { id } = req.params;
        const result = await pool.query(`
            SELECT m.* 
            FROM menus m
            JOIN role_menus rm ON m.id = rm.menu_id
            WHERE rm.role_id = $1
        `, [id]);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// POST /admin/roles/:id/menus - Assign menus to a role
router.post('/roles/:id/menus', async (req, res, next) => {
    try {
        const { id } = req.params;
        const { menu_ids } = req.body; // Array of menu IDs

        if (!Array.isArray(menu_ids)) {
            return res.status(400).json({ error: 'menu_ids must be an array' });
        }

        await pool.query('BEGIN');
        await pool.query('DELETE FROM role_menus WHERE role_id = $1', [id]);
        
        for (const menuId of menu_ids) {
            await pool.query('INSERT INTO role_menus (role_id, menu_id) VALUES ($1, $2)', [id, menuId]);
        }
        
        await pool.query('COMMIT');
        res.json({ success: true, message: 'Menus assigned to role successfully' });
    } catch (err) {
        await pool.query('ROLLBACK');
        next(err);
    }
});

module.exports = router;
