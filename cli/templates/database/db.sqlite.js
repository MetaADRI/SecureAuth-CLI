const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

const dbPath = process.env.DATABASE_URL || path.join(__dirname, '..', 'secureauth.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        totp_secret TEXT NOT NULL,
        totp_enabled INTEGER DEFAULT 1,
        role TEXT DEFAULT 'user',
        created_at TEXT NOT NULL,
        failed_login_attempts INTEGER DEFAULT 0,
        locked_until TEXT,
        last_failed_login TEXT
      )
    `);

    try {
      db.exec("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'");
    } catch (e) {}

    db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        log_id TEXT PRIMARY KEY,
        user_id TEXT,
        action TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    console.log('✓ Database initialized successfully (SQLite)');
  } catch (err) {
    console.error('❌ Database initialization failed:', err.message || err);
  }
}

function seedDemoUser() {
  const demoEmail = 'demo@secureauth.com';
  try {
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(demoEmail);
    if (!existing) {
      const userId = uuidv4();
      const passwordHash = bcrypt.hashSync('Demo@123', 12);
      const totpSecret = 'JBSWY3DPEHPK3PXP';
      const createdAt = new Date().toISOString();
      db.prepare(`
        INSERT INTO users (id, full_name, email, password_hash, totp_secret, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, 'Demo User', demoEmail, passwordHash, totpSecret, 'admin', createdAt);
      console.log('✓ Demo user created: demo@secureauth.com / Demo@123');
    }
  } catch (err) {
    console.error('❌ Failed to seed demo user:', err);
  }
}

function seedAdminUser() {
  const adminEmail = 'admin@secureauth.com';
  try {
    const existing = db.prepare('SELECT * FROM users WHERE email = ?').get(adminEmail);
    if (!existing) {
      const userId = uuidv4();
      const passwordHash = bcrypt.hashSync('AdminPassword123!', 12);
      const totpSecret = 'KVKFKRCPNZQUYMLXOVZGUYLTKVKFKRCP';
      const createdAt = new Date().toISOString();
      db.prepare(`
        INSERT INTO users (id, full_name, email, password_hash, totp_secret, role, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, 'System Administrator', adminEmail, passwordHash, totpSecret, 'admin', createdAt);
      console.log('✓ Admin user created: admin@secureauth.com / AdminPassword123!');
    }
  } catch (err) {
    console.error('❌ Failed to seed admin user:', err);
  }
}

function insertAuditLog(userId, action, ipAddress = 'unknown', userAgent = 'unknown') {
  const logId = uuidv4();
  const timestamp = new Date().toISOString();
  try {
    db.prepare(`
      INSERT INTO audit_logs (log_id, user_id, action, ip_address, user_agent, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(logId, userId, action, ipAddress, userAgent, timestamp);
    return logId;
  } catch (err) {
    console.error('❌ Failed to insert audit log:', err);
    return null;
  }
}

module.exports = {
  initDatabase,
  seedAdminUser,
  seedDemoUser,
  insertAuditLog,
  db: {
    query: (text, params) => {
      const stmt = db.prepare(text);
      const rows = params ? stmt.all(...params) : stmt.all();
      return { rows };
    }
  }
};
