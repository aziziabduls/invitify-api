const express = require('express');
const { pool } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');
const { sendEmail } = require('../services/emailService');
const { markAsPaid } = require('../services/participantService');

const router = express.Router();

router.use(authMiddleware);

const participantColumns =
    'id, event_id, reference_id, customer_name, customer_email, customer_phone, payment_method, original_price, discount_code, discount_amount, final_price, status, created_at, updated_at';

async function assertEventOwnership(eventId, userId, role) {
    if (role === 'SUPER_ADMIN') {
        const r = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
        if (r.rows.length === 0) return null;
        return r.rows[0].id;
    }
    const r = await pool.query('SELECT id FROM events WHERE id = $1 AND user_id = $2', [eventId, userId]);
    if (r.rows.length === 0) return null;
    return r.rows[0].id;
}

function normalizeParticipantBody(body) {
    const c = body.customer ?? {};
    const p = body.pricing ?? {};
    return {
        event_id: body.eventId ?? body.event_id,
        customer_name: c.name ?? c.customer_name,
        customer_email: c.email ?? c.customer_email,
        customer_phone: c.phone ?? c.customer_phone,
        payment_method: body.paymentMethod ?? body.payment_method,
        original_price: p.originalPrice ?? p.original_price ?? 0,
        discount_code: p.discountCode ?? p.discount_code ?? null,
        discount_amount: p.discountAmount ?? p.discount_amount ?? 0,
        final_price: p.finalPrice ?? p.final_price ?? 0,
        status: body.status ?? 'pending_confirmation',
    };
}

// GET all participants for all events created by the organizer
router.get('/', async (req, res, next) => {
    try {
        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const query = isSuperAdmin
            ? `SELECT p.id, p.event_id, p.reference_id, p.customer_name, p.customer_email, p.customer_phone,
                p.payment_method, p.original_price, p.discount_code, p.discount_amount,
                p.final_price, p.status, p.created_at, p.updated_at,
                e.name AS event_name, e.currency
               FROM event_participants p
               INNER JOIN events e ON e.id = p.event_id
               ORDER BY e.start_date DESC, p.created_at DESC`
            : `SELECT p.id, p.event_id, p.reference_id, p.customer_name, p.customer_email, p.customer_phone,
                p.payment_method, p.original_price, p.discount_code, p.discount_amount,
                p.final_price, p.status, p.created_at, p.updated_at,
                e.name AS event_name, e.currency
               FROM event_participants p
               INNER JOIN events e ON e.id = p.event_id AND e.user_id = $1
               ORDER BY e.start_date DESC, p.created_at DESC`;
        const params = isSuperAdmin ? [] : [req.user.id];
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET attendance list for all events owned by user
router.get('/attendance', async (req, res, next) => {
    try {
        const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
        const query = isSuperAdmin
            ? `SELECT p.id, p.customer_name, p.customer_email, e.name AS event_name, 
                    p.attended_at, p.attendance_status AS status
               FROM event_participants p
               INNER JOIN events e ON e.id = p.event_id
               ORDER BY p.attended_at DESC NULLS LAST, p.created_at DESC`
            : `SELECT p.id, p.customer_name, p.customer_email, e.name AS event_name, 
                    p.attended_at, p.attendance_status AS status
               FROM event_participants p
               INNER JOIN events e ON e.id = p.event_id
               WHERE e.user_id = $1
               ORDER BY p.attended_at DESC NULLS LAST, p.created_at DESC`;
        const params = isSuperAdmin ? [] : [req.user.id];
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// POST check-in participant
router.post('/check-in', async (req, res, next) => {
    const { eventId, participantId, email, type } = req.body;

    // Check if the request body is correct
    if (!type || type !== 'attendance_check') {
        return res.status(400).json({ error: 'Invalid check-in request type' });
    }

    if (!participantId && !email) {
        return res.status(400).json({ error: 'participantId or email is required' });
    }

    try {
        // 1. Find participant and verify event ownership in one query
        let query = `
            SELECT p.id, p.customer_name, p.attendance_status, e.user_id, e.id as event_id
            FROM event_participants p
            INNER JOIN events e ON e.id = p.event_id
            WHERE `;
        let params = [];

        if (eventId) {
            // If eventId is provided (QR code scan), strictly match that event
            query += 'p.event_id = $1 AND ';
            params.push(eventId);

            if (participantId) {
                query += '(p.id::text = $2::text OR p.reference_id = $2::text)';
                params.push(String(participantId));
            } else {
                query += 'p.customer_email = $2';
                params.push(email);
            }
        } else {
            // If no eventId (manual entry), search across all participant identifiers
            // but we still need to check ownership later
            query += '(p.id::text = $1 OR p.reference_id = $1 OR p.customer_email = $1)';
            params.push(String(participantId || email));
        }

        const checkResult = await pool.query(query, params);

        if (checkResult.rows.length === 0) {
            return res.status(404).json({ error: 'Participant not found' });
        }

        // Handle multiple results if searching by email without eventId
        const participant = checkResult.rows[0];

        // 2. Verify ownership
        // 2. Verify ownership
        if (req.user.role !== 'SUPER_ADMIN' && participant.user_id !== req.user.id) {
            return res.status(403).json({
                error: 'Forbidden',
                message: 'You do not have permission to manage attendance for this event.'
            });
        }

        // 3. Check if already attended
        if (participant.attendance_status === 'attended') {
            return res.status(400).json({
                error: 'Already Checked In',
                message: `${participant.customer_name} has already checked in.`
            });
        }

        // 4. Update attendance
        const updateResult = await pool.query(
            `UPDATE event_participants 
             SET attendance_status = 'attended', attended_at = NOW(), updated_at = NOW() 
             WHERE id = $1 
             RETURNING id, customer_name, attended_at`,
            [participant.id]
        );

        res.json(updateResult.rows[0]);
    } catch (err) {
        next(err);
    }
});

// GET all participants for a specific event
router.get('/:eventId', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
        if (!eventId) return res.status(404).json({ error: 'Event not found' });
        const result = await pool.query(
            `SELECT ${participantColumns} FROM event_participants WHERE event_id = $1 ORDER BY created_at DESC`,
            [eventId],
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET specific participant
router.get('/:eventId/:id', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
        if (!eventId) return res.status(404).json({ error: 'Event not found' });
        const result = await pool.query(
            `SELECT ${participantColumns} FROM event_participants WHERE id = $1 AND event_id = $2`,
            [req.params.id, eventId],
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Participant not found' });
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// POST new participant
router.post('/:eventId', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
        if (!eventId) return res.status(404).json({ error: 'Event not found' });
        const body = normalizeParticipantBody({ ...req.body, eventId: Number(req.params.eventId) });
        const {
            customer_name,
            customer_email,
            customer_phone,
            payment_method,
            original_price,
            discount_code,
            discount_amount,
            final_price,
            status,
        } = body;
        if (!customer_name || !customer_email || !customer_phone || !payment_method) {
            return res.status(400).json({
                error: 'customer.name, customer.email, customer.phone and paymentMethod are required',
            });
        }
        const result = await pool.query(
            `INSERT INTO event_participants (
        event_id, customer_name, customer_email, customer_phone, payment_method,
        original_price, discount_code, discount_amount, final_price, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, event_id, reference_id, customer_name, customer_email, customer_phone, payment_method, original_price, discount_code, discount_amount, final_price, status, created_at, updated_at`,
            [
                eventId,
                customer_name,
                customer_email,
                customer_phone,
                payment_method,
                Number(original_price) || 0,
                discount_code ?? null,
                Number(discount_amount) || 0,
                Number(final_price) || 0,
                status ?? 'pending_confirmation',
            ],
        );
        const created = result.rows[0];

        try {
            const evRes = await pool.query(
                'SELECT is_free, price FROM events WHERE id = $1',
                [eventId],
            );
            const ev = evRes.rows[0];
            const isFree = ev && (ev.is_free === true || Number(ev.price) <= 0);
            if (isFree) {
                const payload = {
                    eventId: eventId,
                    participantId: created.id,
                    email: customer_email,
                    type: 'attendance_check',
                };
                await sendEmail({
                    to: customer_email,
                    subject: 'Your Attendance QR',
                    text: JSON.stringify(payload),
                });
            }
        } catch (e) {
        }

        res.status(201).json(created);
    } catch (err) {
        next(err);
    }
});

router.post('/:eventId/:id/set_as_paid', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
        if (!eventId) return res.status(404).json({ error: 'Event not found' });

        const paid = await markAsPaid(req.params.id, eventId);
        if (!paid) return res.status(404).json({ error: 'Participant not found' });

        res.json(paid);
    } catch (err) {
        next(err);
    }
});

router.post('/:eventId/:id/block', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
        if (!eventId) return res.status(404).json({ error: 'Event not found' });
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE event_participants SET status = 'blocked', updated_at = NOW() WHERE id = $1 AND event_id = $2 RETURNING ${participantColumns}`,
            [id, eventId],
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Participant not found' });
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

router.post('/:eventId/:id/remove', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
        if (!eventId) return res.status(404).json({ error: 'Event not found' });
        const { id } = req.params;
        const result = await pool.query(
            'DELETE FROM event_participants WHERE id = $1 AND event_id = $2 RETURNING id',
            [id, eventId],
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Participant not found' });
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

// PATCH participant status
router.patch('/:eventId/:id', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
        if (!eventId) return res.status(404).json({ error: 'Event not found' });
        const { id } = req.params;
        const { status } = req.body;
        if (!status) return res.status(400).json({ error: 'status is required' });
        const result = await pool.query(
            `UPDATE event_participants SET status = $1, updated_at = NOW() WHERE id = $2 AND event_id = $3 RETURNING ${participantColumns}`,
            [status, id, eventId],
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Participant not found' });
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// DELETE participant
router.delete('/:eventId/:id', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
        if (!eventId) return res.status(404).json({ error: 'Event not found' });
        const result = await pool.query(
            'DELETE FROM event_participants WHERE id = $1 AND event_id = $2 RETURNING id',
            [req.params.id, eventId],
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Participant not found' });
        res.json({ success: true });
    } catch (err) {
        next(err);
    }
});

module.exports = router;
