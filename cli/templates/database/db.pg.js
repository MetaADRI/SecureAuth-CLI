const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const connectionString = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false
  },
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10000,
  max: 3
});

async function initDatabase() {
  try {
    const client = await pool.connect();

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        totp_secret TEXT NOT NULL,
        totp_enabled BOOLEAN DEFAULT TRUE,
        role TEXT DEFAULT 'user',
        created_at TEXT NOT NULL,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until TEXT,
        last_failed_login TEXT
      )
    `);

    try {
      await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT \'user\'');
    } catch (e) {}

    await client.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        log_id TEXT PRIMARY KEY,
        user_id TEXT REFERENCES users(id),
        action TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        timestamp TEXT NOT NULL
      )
    `);

    client.release();
    console.log('✓ Database initialized successfully (PostgreSQL)');
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message || err);
  }
}

async function seedDemoUser() {
  const demoEmail = 'demo@secureauth.com';
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [demoEmail]);
    if (result.rows.length === 0) {
      const userId = uuidv4();
      const passwordHash = await bcrypt.hash('Demo@123', 12);
      const totpSecret = 'JBSWY3DPEHPK3PXP';
      const createdAt = new Date().toISOString();
      await pool.query(`
        INSERT INTO users (id, full_name, email, password_hash, totp_secret, role, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [userId, 'Demo User', demoEmail, passwordHash, totpSecret, 'admin', createdAt]);
      console.log('✓ Demo user created: demo@secureauth.com / Demo@123');
    }
  } catch (err) {
    console.error('❌ Failed to seed demo user:', err);
  }
}

async function seedAdminUser() {
  const adminEmail = 'admin@secureauth.com';
  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [adminEmail]);
    if (result.rows.length === 0) {
      const userId = uuidv4();
      const passwordHash = await bcrypt.hash('AdminPassword123!', 12);
      const totpSecret = 'KVKFKRCPNZQUYMLXOVZGUYLTKVKFKRCP';
      const createdAt = new Date().toISOString();
      await pool.query(`
        INSERT INTO users (id, full_name, email, password_hash, totp_secret, role, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [userId, 'System Administrator', adminEmail, passwordHash, totpSecret, 'admin', createdAt]);
      console.log('✓ Admin user created: admin@secureauth.com / AdminPassword123!');
    }
  } catch (err) {
    console.error('❌ Failed to seed admin user:', err);
  }
}

async function insertAuditLog(userId, action, ipAddress = 'unknown', userAgent = 'unknown') {
  const logId = uuidv4();
  const timestamp = new Date().toISOString();
  try {
    await pool.query(`
      INSERT INTO audit_logs (log_id, user_id, action, ip_address, user_agent, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [logId, userId, action, ipAddress, userAgent, timestamp]);
    return logId;
  } catch (err) {
    console.error('❌ Failed to insert audit log:', err);
    return null;
  }
}

pool.on('error', (err) => {
  console.error('❌ Unexpected Postgres pool error:', err.message);
});

module.exports = {
  initDatabase,
  seedAdminUser,
  seedDemoUser,
  insertAuditLog,
  pool,
  db: {
    query: (text, params) => pool.query(text, params)
  }
};
