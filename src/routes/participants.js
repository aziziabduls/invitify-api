const express = require('express');
const { pool } = require('../utils/db');
const auth = require('../middleware/auth');

const router = express.Router();

router.use(auth);

const participantColumns =
    'id, event_id, reference_id, customer_name, customer_email, customer_phone, payment_method, original_price, discount_code, discount_amount, final_price, status, created_at, updated_at';

async function assertEventOwnership(eventId, userId) {
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
        const result = await pool.query(
            `SELECT p.id, p.event_id, p.reference_id, p.customer_name, p.customer_email, p.customer_phone,
              p.payment_method, p.original_price, p.discount_code, p.discount_amount,
              p.final_price, p.status, p.created_at, p.updated_at,
              e.name AS event_name
       FROM event_participants p
       INNER JOIN events e ON e.id = p.event_id AND e.user_id = $1
       ORDER BY e.start_date DESC, p.created_at DESC`,
            [req.user.id],
        );
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

// GET all participants for a specific event
router.get('/:eventId', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id);
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
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id);
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
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id);
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
        res.status(201).json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// PATCH participant status
router.patch('/:eventId/:id', async (req, res, next) => {
    try {
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id);
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
        const eventId = await assertEventOwnership(req.params.eventId, req.user.id);
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
