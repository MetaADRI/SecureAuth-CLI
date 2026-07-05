const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const authRoutes = require('./routes/authRoutes');
const { initDatabase, seedAdminUser, seedDemoUser } = require('./database/db');

const app = express();
const PORT = process.env.PORT || {{PORT}};

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://cdn.tailwindcss.com", "https://unpkg.com"],
      fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "http://localhost:*", "https://localhost:*"],
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

{{DDOS_MIDDLEWARE}}

app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', authRoutes);

app.get('/api/health', (req, res) => {
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

app.get('/', (req, res) => {
  res.json({ message: 'SecureAuth API is running', version: '2.1.0' });
});

let dbReady = false;

try {
  initDatabase();
  seedAdminUser();
  seedDemoUser();
  dbReady = true;
  console.log('Database initialized and seeded');
} catch (err) {
  console.error('Database initialization failed:', err.message);
}

app.use((req, res, next) => {
  if (dbReady) return next();
  if (req.path.startsWith('/api')) {
    return res.status(503).json({
      error: 'System initializing, please try again in a moment.'
    });
  }
  next();
});

if (process.env.VERCEL !== '1') {
  app.listen(PORT, () => {
    console.log(`SecureAuth server running on http://localhost:${PORT}`);
    console.log(`Mode: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;
