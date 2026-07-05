const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { verifyToken, checkAndRefreshToken, createRateLimiter } = require('../middleware/authMiddleware');
const jwtUtils = require('../utils/jwtUtils');

const loginLimiter = createRateLimiter(5, 15);

router.post('/register', authController.register);
router.post('/login', loginLimiter, authController.loginStep1);
router.post('/demo/login', authController.demoLogin);
router.post('/verify-2fa', loginLimiter, authController.verifyTOTP);
router.get('/dashboard', checkAndRefreshToken, authController.getDashboard);
router.get('/login-history', checkAndRefreshToken, authController.getLoginHistory);
router.post('/request-deletion', checkAndRefreshToken, authController.requestDeletion);

router.post('/refresh', (req, res) => {
  try {
    const authHeader = req.get('Authorization');
    const token = jwtUtils.extractTokenFromHeader(authHeader);

    if (!token) {
      return res.status(401).json({ error: 'Missing token' });
    }

    const inactivity = jwtUtils.checkInactivity(token);

    if (inactivity.inactive) {
      return res.status(401).json({
        error: 'Session expired',
        message: 'Your session has expired due to inactivity'
      });
    }

    const newToken = jwtUtils.refreshJWT(token);

    return res.status(200).json({
      accessToken: newToken,
      message: 'Token refreshed successfully'
    });

  } catch (error) {
    return res.status(401).json({ error: error.message });
  }
});

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    message: 'SecureAuth API is running',
    timestamp: new Date().toISOString(),
    version: '2.1.0',
    framework: 'Express/Node.js',
    features: [
      'TOTP Two-Factor Authentication',
      'JWT Session Management',
      'Inactivity Auto-Logout',
      'Account Lockout',
      'Login History Tracking',
      'Rate Limiting',
      'bcrypt Password Hashing'
    ]
  });
});

{{ADMIN_ROUTES}}

module.exports = router;
