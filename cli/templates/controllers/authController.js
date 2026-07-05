const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const userModel = require('../models/userModel');
const totpUtils = require('../utils/totpUtils');
const jwtUtils = require('../utils/jwtUtils');
const { insertAuditLog, db } = require('../database/db');

const BCRYPT_ROUNDS = parseInt(process.env.BCRYPT_ROUNDS) || 12;
const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_FAILED_ATTEMPTS) || 5;
const LOCKOUT_DURATION_MINUTES = parseInt(process.env.LOCKOUT_DURATION_MINUTES) || 30;

async function register(req, res) {
  try {
    const { fullName, email, password } = req.body;

    if (!fullName || !email || !password) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Please provide fullName, email, and password'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Invalid email format',
        message: 'Please provide a valid email address'
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        error: 'Weak password',
        message: 'Password must be at least 8 characters long'
      });
    }

    const existingUser = await userModel.findByEmail(email);
    if (existingUser) {
      return res.status(400).json({
        error: 'Email already registered',
        message: 'This email address is already associated with an account'
      });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const secretData = totpUtils.generateSecret();
    const totpSecret = secretData.base32_secret;
    const qrCode = await totpUtils.generateQR(totpSecret, email);

    const userId = uuidv4();
    const createdAt = new Date().toISOString();

    await userModel.createUser({
      id: userId,
      full_name: fullName,
      email: email,
      password_hash: passwordHash,
      totp_secret: totpSecret,
      created_at: createdAt
    });

    const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    await insertAuditLog(userId, 'register', ipAddress, userAgent);

    return res.status(201).json({
      message: 'Registration successful! Scan the QR code with Google Authenticator to complete setup.',
      qrCode: qrCode,
      userId: userId,
      instructions: [
        '1. Open Google Authenticator on your smartphone',
        '2. Tap the "+" button to add a new account',
        '3. Select "Scan a QR code"',
        '4. Scan the QR code displayed above',
        '5. Your SecureAuth account will appear in the app',
        '6. Use the 6-digit code from the app when logging in'
      ]
    });

  } catch (error) {
    console.error('Registration error:', error);
    return res.status(500).json({
      error: 'Registration failed',
      message: 'An error occurred during registration. Please try again.'
    });
  }
}

{{ACCOUNT_LOCKOUT}}

async function loginStep1(req, res) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Please provide email and password'
      });
    }

    const user = await userModel.findByEmail(email);

    if (!user) {
      const ipAddress = req.ip || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';
      await insertAuditLog(null, 'login_attempt_failed', ipAddress, userAgent);

      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email or password is incorrect'
      });
    }

    {{LOCKOUT_CHECK}}

    const isValid = await bcrypt.compare(password, user.password_hash);

    if (!isValid) {
      {{LOCKOUT_INCREMENT}}

      const ipAddress = req.ip || 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';
      await insertAuditLog(user.id, 'login_attempt_failed', ipAddress, userAgent);

      {{LOCKOUT_TRIGGER}}

      return res.status(401).json({
        error: 'Invalid credentials',
        message: {{LOCKOUT_MESSAGE}}
      });
    }

    {{LOCKOUT_RESET}}

    const tempToken = jwtUtils.generateTempJWT(user.id, user.email);

    const ipAddress = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';
    await insertAuditLog(user.id, 'login_step1_success', ipAddress, userAgent);

    return res.status(200).json({
      message: 'Password verified. Please enter your 6-digit 2FA code.',
      tempToken: tempToken,
      '2fa_required': true,
      next_step: 'POST /api/verify-2fa with the tempToken in Authorization header'
    });

  } catch (error) {
    console.error('Login Step 1 error:', error);
    return res.status(500).json({
      error: 'Login failed',
      message: 'An error occurred during login. Please try again.'
    });
  }
}

async function verifyTOTP(req, res) {
  try {
    const { token: totpCode, code } = req.body;
    const finalCode = totpCode || code;

    if (!finalCode) {
      return res.status(400).json({
        error: 'Missing TOTP code',
        message: 'Please provide the 6-digit code from your authenticator app'
      });
    }

    const authHeader = req.get('Authorization');
    const token = jwtUtils.extractTokenFromHeader(authHeader);

    if (!token) {
      return res.status(401).json({
        error: 'Missing authorization token',
        message: 'Please provide the tempToken from login step 1 in Authorization header'
      });
    }

    let payload;
    try {
      payload = jwtUtils.verifyJWT(token);
    } catch (error) {
      return res.status(401).json({
        error: 'Invalid or expired token',
        message: error.message
      });
    }

    if (!payload['2fa_required']) {
      return res.status(401).json({
        error: 'Invalid token type',
        message: 'This endpoint requires a temporary token from login step 1'
      });
    }

    const userId = payload.user_id;
    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        message: 'Invalid token'
      });
    }

    const isValid = totpUtils.verifyCode(user.totp_secret, finalCode);

    const ipAddress = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    if (!isValid) {
      await insertAuditLog(userId, '2fa_fail', ipAddress, userAgent);
      return res.status(401).json({
        error: 'Invalid TOTP code',
        message: 'The code you entered is invalid or has expired. Please try again.'
      });
    }

    const fullToken = jwtUtils.generateFullJWT(user.id, user.email, user.full_name, user.role);

    await insertAuditLog(userId, '2fa_success', ipAddress, userAgent);
    await insertAuditLog(userId, 'login_success', ipAddress, userAgent);

    return res.status(200).json({
      message: '2FA verification successful. You are now logged in.',
      accessToken: fullToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role || 'user',
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error('TOTP verification error:', error);
    return res.status(500).json({
      error: '2FA verification failed',
      message: 'An error occurred during 2FA verification. Please try again.'
    });
  }
}

async function getDashboard(req, res) {
  try {
    const userId = req.user.user_id;
    const user = await userModel.findById(userId);

    if (!user) {
      return res.status(401).json({
        error: 'User not found',
        message: 'Invalid token'
      });
    }

    const totalUsers = await userModel.countUsers();

    return res.status(200).json({
      message: 'Welcome to your secure dashboard!',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        totpEnabled: Boolean(user.totp_enabled),
        createdAt: user.created_at
      },
      stats: {
        totalUsers: totalUsers,
        loginTime: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Dashboard error:', error);
    return res.status(500).json({
      error: 'Dashboard access failed',
      message: 'An error occurred. Please try again.'
    });
  }
}

async function getLoginHistory(req, res) {
  try {
    const userId = req.user.user_id;

    const query = `
      SELECT action, ip_address, user_agent, timestamp
      FROM audit_logs
      WHERE user_id = $1
      AND action IN ('login_success', 'login_attempt_failed', 'login_attempt_locked', '2fa_success', '2fa_fail')
      ORDER BY timestamp DESC
      LIMIT 10
    `;

    const result = await db.query(query, [userId]);
    const rows = result.rows;

    const history = rows.map(row => ({
      action: row.action,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      timestamp: row.timestamp
    }));

    return res.status(200).json({
      loginHistory: history,
      count: history.length
    });

  } catch (error) {
    console.error('Login history error:', error);
    return res.status(500).json({
      error: 'Failed to fetch login history'
    });
  }
}

async function requestDeletion(req, res) {
  try {
    const userId = req.user.user_id;
    const ipAddress = req.ip || 'unknown';
    const userAgent = req.get('User-Agent') || 'unknown';

    await insertAuditLog(userId, 'deletion_request', ipAddress, userAgent);

    return res.status(200).json({
      message: 'Deletion request sent successfully'
    });
  } catch (error) {
    console.error('Deletion request error:', error);
    return res.status(500).json({ error: 'Failed to request deletion' });
  }
}

module.exports = {
  register,
  loginStep1,
  verifyTOTP,
  getDashboard,
  getLoginHistory,
  requestDeletion
};
