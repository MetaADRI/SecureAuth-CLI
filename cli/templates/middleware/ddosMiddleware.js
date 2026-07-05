const slowDown = require('express-slow-down');

const MAX_REQUESTS_PER_MINUTE = parseInt(process.env.MAX_REQUESTS_PER_MINUTE) || 60;
const AUTO_BAN_THRESHOLD = parseInt(process.env.AUTO_BAN_THRESHOLD) || 100;
const BAN_DURATION_MINUTES = parseInt(process.env.BAN_DURATION_MINUTES) || 30;
const MAX_CONCURRENT_CONNECTIONS = parseInt(process.env.MAX_CONCURRENT_CONNECTIONS) || 100;

const ipRequestCounts = new Map();
const bannedIPs = new Map();
const activeConnections = new Map();

function trackAndBlockIP(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';
  const now = Date.now();

  if (bannedIPs.has(clientIP)) {
    const banExpiry = bannedIPs.get(clientIP);
    if (now < banExpiry) {
      const minutesLeft = Math.ceil((banExpiry - now) / 60000);
      return res.status(429).json({
        error: 'IP Banned',
        message: `Your IP has been temporarily banned due to suspicious activity. Ban expires in ${minutesLeft} minutes.`,
        banned_until: new Date(banExpiry).toISOString()
      });
    } else {
      bannedIPs.delete(clientIP);
    }
  }

  if (!ipRequestCounts.has(clientIP)) {
    ipRequestCounts.set(clientIP, []);
  }

  const requests = ipRequestCounts.get(clientIP);
  const oneMinuteAgo = now - 60000;
  const recentRequests = requests.filter(timestamp => timestamp > oneMinuteAgo);
  ipRequestCounts.set(clientIP, recentRequests);
  recentRequests.push(now);

  if (recentRequests.length > AUTO_BAN_THRESHOLD) {
    const banUntil = now + (BAN_DURATION_MINUTES * 60000);
    bannedIPs.set(clientIP, banUntil);
    return res.status(429).json({
      error: 'Too Many Requests - IP Banned',
      message: `Your IP has been automatically banned for ${BAN_DURATION_MINUTES} minutes due to excessive requests.`,
      requests_detected: recentRequests.length,
      threshold: AUTO_BAN_THRESHOLD
    });
  }

  if (recentRequests.length > MAX_REQUESTS_PER_MINUTE) {
    res.setHeader('X-RateLimit-Warning', 'Approaching request limit');
  }

  next();
}

const progressiveSlowDown = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 10,
  delayMs: (hits) => hits * 100,
  maxDelayMs: 5000,
  skipSuccessfulRequests: false,
  skipFailedRequests: false
});

function connectionLimiter(req, res, next) {
  const clientIP = req.ip || req.connection.remoteAddress || 'unknown';

  if (!activeConnections.has(clientIP)) {
    activeConnections.set(clientIP, 0);
  }

  const currentConnections = activeConnections.get(clientIP);

  if (currentConnections >= MAX_CONCURRENT_CONNECTIONS) {
    return res.status(429).json({
      error: 'Too Many Concurrent Connections',
      message: `Maximum ${MAX_CONCURRENT_CONNECTIONS} concurrent connections per IP allowed.`,
      current_connections: currentConnections
    });
  }

  activeConnections.set(clientIP, currentConnections + 1);

  res.on('finish', () => {
    const count = activeConnections.get(clientIP) || 0;
    if (count > 0) {
      activeConnections.set(clientIP, count - 1);
    }
  });

  next();
}

function validateRequestSize(req, res, next) {
  const contentLength = req.headers['content-length'];
  const MAX_SIZE = parseInt(process.env.MAX_REQUEST_SIZE) || 100000;

  if (contentLength && parseInt(contentLength) > MAX_SIZE) {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: `Request body must be less than ${MAX_SIZE / 1000}KB`,
      received: `${(contentLength / 1000).toFixed(2)}KB`
    });
  }

  next();
}

function malformedRequestDetector(req, res, next) {
  const userAgent = req.get('User-Agent') || '';
  const clientIP = req.ip || 'unknown';

  const suspiciousPatterns = [
    /sqlmap/i,
    /nikto/i,
    /nmap/i,
    /masscan/i,
    /<script>/i,
    /\.\.\/\.\.\//,
    /union.*select/i,
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(userAgent) || pattern.test(req.url)) {
      const banUntil = Date.now() + (60 * 60000);
      bannedIPs.set(clientIP, banUntil);
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Suspicious request detected. Your IP has been logged and banned.'
      });
    }
  }

  next();
}

function getProtectionStats() {
  const now = Date.now();
  const activeBans = Array.from(bannedIPs.entries())
    .filter(([ip, expiry]) => expiry > now)
    .length;

  const totalActiveConnections = Array.from(activeConnections.values())
    .reduce((sum, count) => sum + count, 0);

  return {
    banned_ips: activeBans,
    active_connections: totalActiveConnections,
    max_connections_per_ip: MAX_CONCURRENT_CONNECTIONS,
    auto_ban_threshold: AUTO_BAN_THRESHOLD,
    ban_duration_minutes: BAN_DURATION_MINUTES,
    tracked_ips: ipRequestCounts.size
  };
}

function cleanupExpiredBans() {
  const now = Date.now();
  let cleaned = 0;
  for (const [ip, expiry] of bannedIPs.entries()) {
    if (expiry < now) {
      bannedIPs.delete(ip);
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`Cleaned ${cleaned} expired IP bans`);
  }
}

if (process.env.VERCEL !== '1') {
  setInterval(cleanupExpiredBans, 5 * 60 * 1000);
}

module.exports = {
  trackAndBlockIP,
  progressiveSlowDown,
  connectionLimiter,
  validateRequestSize,
  malformedRequestDetector,
  getProtectionStats
};
