const express = require('express');
const { pool } = require('../utils/db');

const router = express.Router();

// GET /client/events - get all active events (no auth)
router.get('/events', async (req, res, next) => {
  try {
    const eventsResult = await pool.query(
      `SELECT id FROM events WHERE status = 'active' ORDER BY start_date ASC`
    );
    const list = await Promise.all(
      eventsResult.rows.map((row) => getEventWithNested(row.id)),
    );
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// GET /client/events/featured - get one random active event (no auth)
router.get('/events/featured', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id FROM events WHERE status = 'active' ORDER BY RANDOM() LIMIT 1`
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active events found' });
    }

    const payload = await getEventWithNested(result.rows[0].id);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});


// GET /client/events/:id - get event by ID (no auth)
router.get('/events/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const payload = await getEventWithNested(id);
    if (!payload) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(payload);
  } catch (err) {
    next(err);
  }
});
// GET /client/organizers/:domain - get organizer profile and events by domain (no auth)
router.get('/organizers/:domain', async (req, res, next) => {
  try {
    const { domain } = req.params;

    // Get organizer profile
    const organizerRes = await pool.query(
      'SELECT id, name, domain, scope, category, format, created_at FROM organizers WHERE domain = $1',
      [domain]
    );

    if (organizerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Organizer not found' });
    }

    const organizer = organizerRes.rows[0];

    // Get events associated with this organizer
    const eventsRes = await pool.query(
      `SELECT e.id FROM events e
       JOIN organizer_events oe ON e.id = oe.event_id
       WHERE oe.organizer_id = $1 AND e.status = 'active'
       ORDER BY e.start_date ASC`,
      [organizer.id]
    );

    const eventDetails = await Promise.all(
      eventsRes.rows.map((row) => getEventWithNested(row.id))
    );

    res.json({
      organizer,
      events: eventDetails
    });
  } catch (err) {
    next(err);
  }
});

// GET /client/:domain/featured - get one random active event from a specific organizer (no auth)
router.get('/:domain/featured', async (req, res, next) => {
  try {
    const { domain } = req.params;

    // Get organizer id
    const organizerRes = await pool.query('SELECT id FROM organizers WHERE domain = $1', [domain]);
    if (organizerRes.rows.length === 0) {
      return res.status(404).json({ error: 'Organizer not found' });
    }
    const organizerId = organizerRes.rows[0].id;

    // Get one random active event for this organizer
    const result = await pool.query(
      `SELECT e.id FROM events e
       JOIN organizer_events oe ON e.id = oe.event_id
       WHERE oe.organizer_id = $1 AND e.status = 'active'
       ORDER BY RANDOM() LIMIT 1`,
      [organizerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No active events found for this organizer' });
    }

    const payload = await getEventWithNested(result.rows[0].id);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});


const participantColumns =
  'id, event_id, reference_id, customer_name, customer_email, customer_phone, payment_method, original_price, discount_code, discount_amount, final_price, status, created_at, updated_at';

const eventColumns =
  'id, user_id, name, tagline, logo_url, image_url, start_date, end_date, timezone, location, location_url, is_free, price, currency, max_participants, is_shared_album_enabled, about, status, created_at, updated_at';
const rundownColumns = 'id, event_id, rundown_date, rundown_time, title, description, image_url, created_at';
const brandColumns = 'id, event_id, name, icon_url, created_at';
const promoCodeColumns = 'id, event_id, code, type, value, usage_limit, created_at';

async function getEventWithNested(eventId) {
  const [eventRes, rundownsRes, brandsRes, promosRes] = await Promise.all([
    pool.query(`SELECT ${eventColumns} FROM events WHERE id = $1`, [eventId]),
    pool.query(`SELECT ${rundownColumns} FROM event_rundowns WHERE event_id = $1 ORDER BY rundown_date, rundown_time`, [eventId]),
    pool.query(`SELECT ${brandColumns} FROM event_brands WHERE event_id = $1 ORDER BY id`, [eventId]),
    pool.query(`SELECT ${promoCodeColumns} FROM event_promo_codes WHERE event_id = $1 ORDER BY id`, [eventId]),
  ]);
  const event = eventRes.rows[0];
  if (!event) return null;
  return {
    event,
    rundowns: rundownsRes.rows,
    brands: brandsRes.rows,
    promo_codes: promosRes.rows,
  };
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

// POST /client/participants - register for an event (no auth)
router.post('/participants', async (req, res, next) => {
  try {
    const body = normalizeParticipantBody(req.body);
    const eventId = body.event_id ? Number(body.event_id) : null;
    if (!eventId) {
      return res.status(400).json({ error: 'eventId is required' });
    }

    const eventCheck = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
    if (eventCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

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
      RETURNING id, event_id, customer_name, customer_email, customer_phone, payment_method, original_price, discount_code, discount_amount, final_price, status, created_at, updated_at`,
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
    const row = result.rows[0];
    const referenceId = 'P-' + row.event_id + '-' + row.id;
    res.status(201).json({ ...row, reference_id: referenceId });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
