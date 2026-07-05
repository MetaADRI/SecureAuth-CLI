const { db } = require('../database/db');

function findByEmail(email) {
  const result = db.query('SELECT * FROM users WHERE email = ?', [email]);
  return result.rows[0];
}

function findById(userId) {
  const result = db.query('SELECT * FROM users WHERE id = ?', [userId]);
  return result.rows[0];
}

function createUser(userData) {
  db.query(`
    INSERT INTO users (id, full_name, email, password_hash, totp_secret, role, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `, [userData.id, userData.full_name, userData.email,
      userData.password_hash, userData.totp_secret,
      userData.role || 'user', userData.created_at]);
}

function getAllUsers() {
  const result = db.query('SELECT id, full_name, email, role, created_at FROM users ORDER BY created_at DESC');
  return result.rows;
}

function deleteUser(userId) {
  db.query('DELETE FROM audit_logs WHERE user_id = ?', [userId]);
  db.query('DELETE FROM users WHERE id = ?', [userId]);
}

function countUsers() {
  const result = db.query('SELECT COUNT(*) as count FROM users');
  return result.rows[0].count;
}

function incrementFailedAttempts(userId) {
  const result = db.query(`
    UPDATE users
    SET failed_login_attempts = failed_login_attempts + 1,
        last_failed_login = ?
    WHERE id = ?
  `, [new Date().toISOString(), userId]);
  const row = db.query('SELECT failed_login_attempts FROM users WHERE id = ?', [userId]);
  return row.rows[0] ? row.rows[0].failed_login_attempts : 0;
}

function resetFailedAttempts(userId) {
  db.query(`
    UPDATE users
    SET failed_login_attempts = 0,
        locked_until = NULL,
        last_failed_login = NULL
    WHERE id = ?
  `, [userId]);
}

function lockAccount(userId, lockoutDurationMinutes) {
  const lockedUntil = new Date();
  lockedUntil.setMinutes(lockedUntil.getMinutes() + lockoutDurationMinutes);
  db.query('UPDATE users SET locked_until = ? WHERE id = ?', [lockedUntil.toISOString(), userId]);
}

module.exports = {
  findByEmail, findById, createUser, getAllUsers,
  deleteUser, countUsers, incrementFailedAttempts,
  resetFailedAttempts, lockAccount
};
