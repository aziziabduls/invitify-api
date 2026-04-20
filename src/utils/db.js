const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('DATABASE_URL is not set. Using default local connection.');
}

const pool = new Pool({
  connectionString:
    connectionString || 'postgres://postgres:postgres@localhost:5432/',
});

async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Roles Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS roles (
        id SERIAL PRIMARY KEY,
        name VARCHAR(50) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Menus Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS menus (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        path VARCHAR(255) UNIQUE NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Ensure unique constraint on menus.path if table already exists
    await client.query(`
      DO $$
      BEGIN
        -- First, delete duplicates if any
        DELETE FROM menus 
        WHERE id IN (
          SELECT id FROM (
            SELECT id, ROW_NUMBER() OVER (PARTITION BY path ORDER BY id) as rn
            FROM menus
          ) t WHERE t.rn > 1
        );

        -- Then add the constraint if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'menus_path_key') THEN
          ALTER TABLE menus ADD CONSTRAINT menus_path_key UNIQUE (path);
        END IF;
      END;
      $$;
    `);

    // Role Menus Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS role_menus (
        role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
        menu_id INTEGER NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
        PRIMARY KEY (role_id, menu_id)
      )
    `);

    // Users Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        username VARCHAR(255) UNIQUE NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL,
        last_login_at TIMESTAMPTZ,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id INTEGER REFERENCES roles(id) ON DELETE SET NULL;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
      ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;
    `);
    // End of Users Table

    // Seed Data
    const roles = ['SUPER_ADMIN', 'EVENT_ORGANIZER', 'INCIDENTAL'];
    for (const role of roles) {
      await client.query('INSERT INTO roles (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [role]);
    }

    const menus = [
      { name: 'Dashboard', path: '/dashboard' },
      { name: 'Organizers', path: '/dashboard/organizers' },
      { name: 'Events', path: '/dashboard/events' },
      { name: 'Participants', path: '/dashboard/participants' },
      { name: 'Attendance', path: '/dashboard/attendance' },
      { name: 'Settings', path: '/dashboard/settings' },
      { name: 'Role Management', path: '/dashboard/roles' }
    ];

    for (const menu of menus) {
      await client.query('INSERT INTO menus (name, path) VALUES ($1, $2) ON CONFLICT (path) DO NOTHING', [menu.name, menu.path]);
    }

    // Assign Menus to Roles
    const superAdminRole = await client.query('SELECT id FROM roles WHERE name = $1', ['SUPER_ADMIN']);
    const organizerRole = await client.query('SELECT id FROM roles WHERE name = $1', ['EVENT_ORGANIZER']);
    const incidentalRole = await client.query('SELECT id FROM roles WHERE name = $1', ['INCIDENTAL']);

    const allMenus = await client.query('SELECT id, name FROM menus');

    if (superAdminRole.rows.length > 0) {
      for (const menu of allMenus.rows) {
        await client.query('INSERT INTO role_menus (role_id, menu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [superAdminRole.rows[0].id, menu.id]);
      }
    }

    if (organizerRole.rows.length > 0) {
      for (const menu of allMenus.rows) {
        if (['Dashboard', 'Events', 'Participants', 'Attendance', 'Settings'].includes(menu.name)) {
          await client.query('INSERT INTO role_menus (role_id, menu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [organizerRole.rows[0].id, menu.id]);
        }
      }
    }

    if (incidentalRole.rows.length > 0) {
      for (const menu of allMenus.rows) {
        // Incidental can "show" menus but they are unable to access (logic will be in middleware/frontend)
        // For now we assign Attendance as the only functional one, but we link all for "showing"
        await client.query('INSERT INTO role_menus (role_id, menu_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [incidentalRole.rows[0].id, menu.id]);
      }
    }
    // End Seed Data

    // Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // End of Items Table

    // Events Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        tagline VARCHAR(255),
        logo_url TEXT,
        image_url TEXT,
        start_date TIMESTAMPTZ NOT NULL,
        end_date TIMESTAMPTZ NOT NULL,
        timezone VARCHAR(100) NOT NULL,
        location VARCHAR(255) NOT NULL,
        location_url TEXT,
        is_free BOOLEAN NOT NULL DEFAULT FALSE,
        price NUMERIC(15,2) DEFAULT 0,
        currency VARCHAR(10) DEFAULT 'USD',
        max_participants INTEGER DEFAULT 0,
        is_shared_album_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        about TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    `);

    await client.query(`
      ALTER TABLE events ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active'
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS event_rundowns (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        rundown_date DATE NOT NULL,
        rundown_time VARCHAR(20) NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        image_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS event_brands (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        icon_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS event_promo_codes (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        code VARCHAR(100) NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('percentage', 'fixed')),
        value NUMERIC(15,2) NOT NULL,
        usage_limit INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS event_participants (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        reference_id VARCHAR(50) UNIQUE,
        customer_name VARCHAR(255) NOT NULL,
        customer_email VARCHAR(255) NOT NULL,
        customer_phone VARCHAR(50) NOT NULL,
        payment_method VARCHAR(50) NOT NULL,
        original_price NUMERIC(15,2) NOT NULL DEFAULT 0,
        discount_code VARCHAR(100),
        discount_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
        final_price NUMERIC(15,2) NOT NULL DEFAULT 0,
        status VARCHAR(50) NOT NULL DEFAULT 'pending_confirmation',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS reference_id VARCHAR(50) UNIQUE
    `);

    await client.query(`
      CREATE OR REPLACE FUNCTION set_participant_reference_id()
      RETURNS TRIGGER AS $$
      BEGIN
        UPDATE event_participants SET reference_id = 'P-' || NEW.event_id || '-' || NEW.id WHERE id = NEW.id;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await client.query(`DROP TRIGGER IF EXISTS trg_set_participant_reference_id ON event_participants`);
    await client.query(`
      CREATE TRIGGER trg_set_participant_reference_id
      AFTER INSERT ON event_participants FOR EACH ROW
      EXECUTE PROCEDURE set_participant_reference_id()
    `);

    await client.query(`
      ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS attended_at TIMESTAMPTZ
    `);

    await client.query(`
      ALTER TABLE event_participants ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(20) DEFAULT 'pending' CHECK (attendance_status IN ('pending', 'attended'))
    `);

    await client.query('COMMIT');
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        domain VARCHAR(255) UNIQUE NOT NULL,
        scope VARCHAR(255),
        category VARCHAR(255),
        format VARCHAR(20) CHECK (format IN ('hybrid', 'non-hybrid')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await client.query(`
      ALTER TABLE organizers ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
    `);

    // Organizer_Events Table (Many-to-Many)
    await client.query(`
      CREATE TABLE IF NOT EXISTS organizer_events (
        id SERIAL PRIMARY KEY,
        organizer_id INTEGER NOT NULL REFERENCES organizers(id) ON DELETE CASCADE,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        UNIQUE(organizer_id, event_id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    // END OF ORGANIZERS TABLES


    await client.query('COMMIT');
    console.log('Database initialized');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error initializing database', err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  initDb,
};

