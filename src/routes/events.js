const express = require('express');
const { pool } = require('../utils/db');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

router.use(authMiddleware);

const eventColumns =
  'id, user_id, name, tagline, logo_url, image_url, start_date, end_date, timezone, location, location_url, is_free, price, currency, max_participants, is_shared_album_enabled, about, status, created_at, updated_at';

const rundownColumns = 'id, event_id, rundown_date, rundown_time, title, description, image_url, created_at';
const brandColumns = 'id, event_id, name, icon_url, created_at';
const promoCodeColumns = 'id, event_id, code, type, value, usage_limit, created_at';

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

router.get('/', async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
    const query = isSuperAdmin
      ? `SELECT ${eventColumns} FROM events ORDER BY start_date ASC`
      : `SELECT ${eventColumns} FROM events WHERE user_id = $1 ORDER BY start_date ASC`;
    const params = isSuperAdmin ? [] : [req.user.id];

    const eventsResult = await pool.query(query, params);
    const list = await Promise.all(
      eventsResult.rows.map((row) => getEventWithNested(row.id)),
    );
    res.json(list);
  } catch (err) {
    next(err);
  }
});

// GET /events/upcoming - List 4 events coming soon
router.get('/upcoming', async (req, res, next) => {
  try {
    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
    const query = isSuperAdmin
      ? `SELECT ${eventColumns} FROM events WHERE start_date >= NOW() ORDER BY start_date ASC LIMIT 4`
      : `SELECT ${eventColumns} FROM events WHERE user_id = $1 AND start_date >= NOW() ORDER BY start_date ASC LIMIT 4`;
    const params = isSuperAdmin ? [] : [req.user.id];

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// GET /events/calendar - List events for a specific month and year
router.get('/calendar', async (req, res, next) => {
  try {
    const { month, year } = req.query;
    if (!month || !year) {
      return res.status(400).json({ error: 'month and year are required' });
    }

    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
    const startOfMonth = `${year}-${month.toString().padStart(2, '0')}-01`;
    const endOfMonth = new Date(year, month, 0).toISOString().split('T')[0];

    const query = isSuperAdmin
      ? `SELECT ${eventColumns} FROM events WHERE start_date BETWEEN $1 AND $2 ORDER BY start_date ASC`
      : `SELECT ${eventColumns} FROM events WHERE user_id = $3 AND start_date BETWEEN $1 AND $2 ORDER BY start_date ASC`;
    
    const params = isSuperAdmin 
      ? [startOfMonth, endOfMonth] 
      : [startOfMonth, endOfMonth, req.user.id];

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});


router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const isSuperAdmin = req.user.role === 'SUPER_ADMIN';
    const query = isSuperAdmin
      ? `SELECT id FROM events WHERE id = $1`
      : `SELECT id FROM events WHERE id = $1 AND user_id = $2`;
    const params = isSuperAdmin ? [id] : [id, req.user.id];

    const result = await pool.query(query, params);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    const payload = await getEventWithNested(id);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

// Normalize event create body: accept camelCase and alternate keys (rundown, promoCodes, date, time, image, icon, limit)
function normalizeEventCreateBody(body) {
  const start_date = body.start_date ?? body.startDate;
  const end_date = body.end_date ?? body.endDate;
  const location_url = body.location_url ?? body.locationUrl ?? body.location_url;
  const is_free = body.is_free ?? body.isFree;
  const max_participants = body.max_participants ?? body.maxParticipants;
  const is_shared_album_enabled = body.is_shared_album_enabled ?? body.isSharedAlbumEnabled;
  const rundownsRaw = body.rundowns ?? body.rundown ?? [];
  const rundowns = rundownsRaw.map((r) => ({
    rundown_date: r.rundown_date ?? r.date,
    rundown_time: r.rundown_time ?? r.time,
    title: r.title,
    description: r.description,
    image_url: r.image_url ?? r.image,
  }));
  const brandsRaw = body.brands ?? [];
  const brands = brandsRaw.map((b) => ({
    name: b.name,
    icon_url: b.icon_url ?? b.icon,
  }));
  const promo_codesRaw = body.promo_codes ?? body.promoCodes ?? [];
  const promo_codes = promo_codesRaw.map((p) => ({
    code: p.code,
    type: p.type,
    value: p.value,
    usage_limit: p.usage_limit ?? p.limit,
  }));
  return {
    name: body.name,
    tagline: body.tagline,
    logo_url: body.logo_url,
    image_url: body.image_url,
    start_date,
    end_date,
    timezone: body.timezone,
    location: body.location,
    location_url,
    is_free,
    price: body.price,
    currency: body.currency,
    max_participants,
    is_shared_album_enabled,
    about: body.about,
    rundowns,
    brands,
    promo_codes,
  };
}

router.post('/', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const body = normalizeEventCreateBody(req.body);
    const {
      name,
      tagline,
      logo_url,
      image_url,
      start_date,
      end_date,
      timezone,
      location,
      location_url,
      is_free,
      price,
      currency,
      max_participants,
      is_shared_album_enabled,
      about,
      rundowns,
      brands,
      promo_codes,
    } = body;

    if (!name || !start_date || !end_date || !timezone || !location) {
      return res.status(400).json({
        error: 'name, start_date, end_date, timezone, and location are required',
      });
    }

    await client.query('BEGIN');

    const eventResult = await client.query(
      `INSERT INTO events (
        user_id, name, tagline, logo_url, image_url,
        start_date, end_date, timezone, location, location_url,
        is_free, price, currency, max_participants, is_shared_album_enabled, about
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING ${eventColumns}`,
      [
        req.user.id,
        name,
        tagline || null,
        logo_url || null,
        image_url || null,
        start_date,
        end_date,
        timezone,
        location,
        location_url || null,
        is_free ?? false,
        price ?? 0,
        currency || 'USD',
        max_participants ?? 0,
        is_shared_album_enabled ?? false,
        about || null,
      ],
    );
    const event = eventResult.rows[0];
    const eventId = event.id;

    const createdRundowns = [];
    for (const r of rundowns) {
      if (!r.rundown_date || !r.rundown_time || !r.title) continue;
      const ir = await client.query(
        `INSERT INTO event_rundowns (event_id, rundown_date, rundown_time, title, description, image_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${rundownColumns}`,
        [eventId, r.rundown_date, r.rundown_time, r.title, r.description ?? null, r.image_url ?? null],
      );
      createdRundowns.push(ir.rows[0]);
    }

    const createdBrands = [];
    for (const b of brands) {
      if (!b.name) continue;
      const ib = await client.query(
        `INSERT INTO event_brands (event_id, name, icon_url) VALUES ($1, $2, $3) RETURNING ${brandColumns}`,
        [eventId, b.name, b.icon_url ?? null],
      );
      createdBrands.push(ib.rows[0]);
    }

    const createdPromoCodes = [];
    for (const p of promo_codes) {
      if (!p.code || !p.type || p.value == null) continue;
      if (!['percentage', 'fixed'].includes(p.type)) continue;
      const ip = await client.query(
        `INSERT INTO event_promo_codes (event_id, code, type, value, usage_limit) VALUES ($1, $2, $3, $4, $5) RETURNING ${promoCodeColumns}`,
        [eventId, p.code, p.type, p.value, Number(p.usage_limit) || 0],
      );
      createdPromoCodes.push(ip.rows[0]);
    }

    await client.query('COMMIT');

    res.status(201).json({
      event,
      rundowns: createdRundowns,
      brands: createdBrands,
      promo_codes: createdPromoCodes,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { });
    next(err);
  } finally {
    client.release();
  }
});

// ---- Event rundowns ----
router.get('/:eventId/rundowns', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const result = await pool.query(
      `SELECT ${rundownColumns} FROM event_rundowns WHERE event_id = $1 ORDER BY rundown_date, rundown_time`,
      [eventId],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/:eventId/rundowns', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const { rundown_date, rundown_time, title, description, image_url } = req.body;
    if (!rundown_date || !rundown_time || !title) {
      return res.status(400).json({ error: 'rundown_date, rundown_time, and title are required' });
    }
    const result = await pool.query(
      `INSERT INTO event_rundowns (event_id, rundown_date, rundown_time, title, description, image_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${rundownColumns}`,
      [eventId, rundown_date, rundown_time, title, description ?? null, image_url ?? null],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:eventId/rundowns/:id', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const { id } = req.params;
    const { rundown_date, rundown_time, title, description, image_url } = req.body;
    const result = await pool.query(
      `UPDATE event_rundowns SET
        rundown_date = COALESCE($1, rundown_date),
        rundown_time = COALESCE($2, rundown_time),
        title = COALESCE($3, title),
        description = COALESCE($4, description),
        image_url = COALESCE($5, image_url)
      WHERE id = $6 AND event_id = $7 RETURNING ${rundownColumns}`,
      [rundown_date ?? null, rundown_time ?? null, title ?? null, description ?? null, image_url ?? null, id, eventId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rundown not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:eventId/rundowns/:id', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const result = await pool.query(
      'DELETE FROM event_rundowns WHERE id = $1 AND event_id = $2 RETURNING id',
      [req.params.id, eventId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Rundown not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---- Event brands ----
router.get('/:eventId/brands', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const result = await pool.query(
      `SELECT ${brandColumns} FROM event_brands WHERE event_id = $1 ORDER BY id`,
      [eventId],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/:eventId/brands', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const { name, icon_url } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      `INSERT INTO event_brands (event_id, name, icon_url) VALUES ($1, $2, $3) RETURNING ${brandColumns}`,
      [eventId, name, icon_url ?? null],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:eventId/brands/:id', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const { id } = req.params;
    const { name, icon_url } = req.body;
    const result = await pool.query(
      `UPDATE event_brands SET name = COALESCE($1, name), icon_url = COALESCE($2, icon_url)
       WHERE id = $3 AND event_id = $4 RETURNING ${brandColumns}`,
      [name ?? null, icon_url ?? null, id, eventId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Brand not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:eventId/brands/:id', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const result = await pool.query(
      'DELETE FROM event_brands WHERE id = $1 AND event_id = $2 RETURNING id',
      [req.params.id, eventId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Brand not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ---- Event promo codes ----
router.get('/:eventId/promo-codes', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const result = await pool.query(
      `SELECT ${promoCodeColumns} FROM event_promo_codes WHERE event_id = $1 ORDER BY id`,
      [eventId],
    );
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

router.post('/:eventId/promo-codes', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const { code, type, value, usage_limit } = req.body;
    if (!code || !type || value == null) {
      return res.status(400).json({ error: 'code, type, and value are required' });
    }
    if (!['percentage', 'fixed'].includes(type)) {
      return res.status(400).json({ error: 'type must be percentage or fixed' });
    }
    const result = await pool.query(
      `INSERT INTO event_promo_codes (event_id, code, type, value, usage_limit) VALUES ($1, $2, $3, $4, $5) RETURNING ${promoCodeColumns}`,
      [eventId, code, type, value, usage_limit ?? 0],
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:eventId/promo-codes/:id', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const { id } = req.params;
    const { code, type, value, usage_limit } = req.body;
    const result = await pool.query(
      `UPDATE event_promo_codes SET
        code = COALESCE($1, code),
        type = COALESCE($2, type),
        value = COALESCE($3, value),
        usage_limit = COALESCE($4, usage_limit)
      WHERE id = $5 AND event_id = $6 RETURNING ${promoCodeColumns}`,
      [code ?? null, type ?? null, value ?? null, usage_limit ?? null, id, eventId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Promo code not found' });
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.delete('/:eventId/promo-codes/:id', async (req, res, next) => {
  try {
    const eventId = await assertEventOwnership(req.params.eventId, req.user.id, req.user.role);
    if (!eventId) return res.status(404).json({ error: 'Event not found' });
    const result = await pool.query(
      'DELETE FROM event_promo_codes WHERE id = $1 AND event_id = $2 RETURNING id',
      [req.params.id, eventId],
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Promo code not found' });
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});


// Normalize event update body: accept camelCase and nested resources (rundowns, brands, promo_codes)
function normalizeEventUpdateBody(body) {
  const rundownsRaw = body.rundowns ?? body.rundown ?? [];
  const rundowns = rundownsRaw.map((r) => ({
    rundown_date: r.rundown_date ?? r.date,
    rundown_time: r.rundown_time ?? r.time,
    title: r.title,
    description: r.description,
    image_url: r.image_url ?? r.image,
  }));
  const brandsRaw = body.brands ?? [];
  const brands = brandsRaw.map((b) => ({
    name: b.name,
    icon_url: b.icon_url ?? b.icon,
  }));
  const promo_codesRaw = body.promo_codes ?? body.promoCodes ?? [];
  const promo_codes = promo_codesRaw.map((p) => ({
    code: p.code,
    type: p.type,
    value: p.value,
    usage_limit: p.usage_limit ?? p.limit,
  }));
  return {
    name: body.name,
    tagline: body.tagline,
    logo_url: body.logo_url,
    image_url: body.image_url,
    start_date: body.start_date ?? body.startDate,
    end_date: body.end_date ?? body.endDate,
    timezone: body.timezone,
    location: body.location,
    location_url: body.location_url ?? body.locationUrl,
    is_free: body.is_free ?? body.isFree,
    price: body.price,
    currency: body.currency,
    max_participants: body.max_participants ?? body.maxParticipants,
    is_shared_album_enabled: body.is_shared_album_enabled ?? body.isSharedAlbumEnabled,
    about: body.about,
    rundowns,
    brands,
    promo_codes,
  };
}

// ---- Event CRUD (must be after nested routes) ----
router.patch('/:id/status', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !['active', 'inactive'].includes(status)) {
      return res.status(400).json({ error: 'status must be "active" or "inactive"' });
    }
    const updates =
      status === 'inactive'
        ? 'status = $1, end_date = NOW(), updated_at = NOW()'
        : 'status = $1, updated_at = NOW()';
    const result = await pool.query(
      `UPDATE events SET ${updates} WHERE id = $2 AND user_id = $3 RETURNING ${eventColumns}`,
      [status, id, req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

router.put('/:id', async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const body = normalizeEventUpdateBody(req.body);
    const {
      name,
      tagline,
      logo_url,
      image_url,
      start_date,
      end_date,
      timezone,
      location,
      location_url,
      is_free,
      price,
      currency,
      max_participants,
      is_shared_album_enabled,
      about,
      rundowns = [],
      brands = [],
      promo_codes = [],
    } = body;

    await client.query('BEGIN');

    const eventResult = await client.query(
      `UPDATE events SET
        name = COALESCE($1, name),
        tagline = COALESCE($2, tagline),
        logo_url = COALESCE($3, logo_url),
        image_url = COALESCE($4, image_url),
        start_date = COALESCE($5, start_date),
        end_date = COALESCE($6, end_date),
        timezone = COALESCE($7, timezone),
        location = COALESCE($8, location),
        location_url = COALESCE($9, location_url),
        is_free = COALESCE($10, is_free),
        price = COALESCE($11, price),
        currency = COALESCE($12, currency),
        max_participants = COALESCE($13, max_participants),
        is_shared_album_enabled = COALESCE($14, is_shared_album_enabled),
        about = COALESCE($15, about),
        updated_at = NOW()
      WHERE id = $16 AND user_id = $17
      RETURNING ${eventColumns}`,
      [
        name ?? null,
        tagline ?? null,
        logo_url ?? null,
        image_url ?? null,
        start_date ?? null,
        end_date ?? null,
        timezone ?? null,
        location ?? null,
        location_url ?? null,
        is_free ?? null,
        price ?? null,
        currency ?? null,
        max_participants ?? null,
        is_shared_album_enabled ?? null,
        about ?? null,
        id,
        req.user.id,
      ],
    );

    if (eventResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found' });
    }

    const updatedEvent = eventResult.rows[0];
    const datesChanged = start_date != null || end_date != null;

    if (datesChanged) {
      await client.query(
        `UPDATE events 
         SET status = CASE 
           WHEN NOW() >= start_date AND NOW() <= end_date THEN 'active'
           ELSE status
         END,
         updated_at = NOW()
         WHERE id = $1 AND user_id = $2`,
        [id, req.user.id],
      );
    }

    await client.query('DELETE FROM event_rundowns WHERE event_id = $1', [id]);
    const createdRundowns = [];
    for (const r of rundowns) {
      if (!r.rundown_date || !r.rundown_time || !r.title) continue;
      const ir = await client.query(
        `INSERT INTO event_rundowns (event_id, rundown_date, rundown_time, title, description, image_url)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${rundownColumns}`,
        [id, r.rundown_date, r.rundown_time, r.title, r.description ?? null, r.image_url ?? null],
      );
      createdRundowns.push(ir.rows[0]);
    }

    await client.query('DELETE FROM event_brands WHERE event_id = $1', [id]);
    const createdBrands = [];
    for (const b of brands) {
      if (!b.name) continue;
      const ib = await client.query(
        `INSERT INTO event_brands (event_id, name, icon_url) VALUES ($1, $2, $3) RETURNING ${brandColumns}`,
        [id, b.name, b.icon_url ?? null],
      );
      createdBrands.push(ib.rows[0]);
    }

    await client.query('DELETE FROM event_promo_codes WHERE event_id = $1', [id]);
    const createdPromoCodes = [];
    for (const p of promo_codes) {
      if (!p.code || !p.type || p.value == null) continue;
      if (!['percentage', 'fixed'].includes(p.type)) continue;
      const ip = await client.query(
        `INSERT INTO event_promo_codes (event_id, code, type, value, usage_limit) VALUES ($1, $2, $3, $4, $5) RETURNING ${promoCodeColumns}`,
        [id, p.code, p.type, p.value, Number(p.usage_limit) || 0],
      );
      createdPromoCodes.push(ip.rows[0]);
    }

    await client.query('COMMIT');

    const payload = await getEventWithNested(id);
    res.json(payload);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { });
    next(err);
  } finally {
    client.release();
  }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'DELETE FROM events WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, req.user.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
