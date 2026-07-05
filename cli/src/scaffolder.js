const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

const REQUIRED_DIRS = ['controllers', 'routes', 'middleware', 'models', 'utils', 'database'];

const LOCKOUT_HELPER = `
async function checkAccountLockout(user) {
  if (user.locked_until) {
    const lockedUntil = new Date(user.locked_until);
    if (lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((lockedUntil - new Date()) / 60000);
      throw { status: 423, message: \`Account locked due to too many failed attempts. Try again in \${minutesLeft} minute(s).\` };
    }
  }
}
`;

const LOCKOUT_CHECK_CODE = `
    try {
      await checkAccountLockout(user);
    } catch (lockErr) {
      await insertAuditLog(user.id, 'login_attempt_locked', req.ip || 'unknown', req.get('User-Agent') || 'unknown');
      return res.status(lockErr.status || 423).json({
        error: 'Account locked',
        message: lockErr.message
      });
    }
`;

const LOCKOUT_INCREMENT_CODE = `
      const failedAttempts = await userModel.incrementFailedAttempts(user.id);
`;

const LOCKOUT_TRIGGER_CODE = `
      if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
        await userModel.lockAccount(user.id, LOCKOUT_DURATION_MINUTES);
        await insertAuditLog(user.id, 'account_locked', req.ip || 'unknown', req.get('User-Agent') || 'unknown');
        return res.status(423).json({
          error: 'Account locked',
          message: \`Account locked due to \${MAX_FAILED_ATTEMPTS} failed attempts. Try again in \${LOCKOUT_DURATION_MINUTES} minutes.\`
        });
      }
`;

const LOCKOUT_RESET_CODE = `
      await userModel.resetFailedAttempts(user.id);
`;

const LOCKOUT_MESSAGE_CODE = '`Email or password is incorrect. ${remaining} attempt(s) remaining before account lockout.`';

const DDOS_MIDDLEWARE_CODE = `const ddos = require('./middleware/ddosMiddleware');

app.use(ddos.trackAndBlockIP);
app.use(ddos.connectionLimiter);
app.use(ddos.malformedRequestDetector);
app.use(ddos.validateRequestSize);
`;

const ADMIN_ROUTES_CODE = `
const adminController = require('../controllers/adminController');
const { isAdmin } = require('../middleware/adminMiddleware');

router.get('/admin/stats', checkAndRefreshToken, isAdmin, adminController.getSystemStats);
router.get('/admin/logs', checkAndRefreshToken, isAdmin, adminController.getSystemLogs);
router.get('/admin/users', checkAndRefreshToken, isAdmin, adminController.getAllUsers);
router.delete('/admin/users/:userId', checkAndRefreshToken, isAdmin, adminController.deleteUser);
`;

function scaffold(targetDir, answers) {
  const templateDir = path.join(__dirname, '..', 'templates');
  const hasAdmin = answers.features && answers.features.includes('admin');
  const hasDdos = answers.features && answers.features.includes('ddos');

  const createdDirs = [];
  for (const dir of REQUIRED_DIRS) {
    const dirPath = path.join(targetDir, dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
      createdDirs.push(dir);
    }
  }
  if (createdDirs.length > 0) {
    logger.info(`Created folders: ${createdDirs.join(', ')}`);
  }

  const templateFiles = collectFiles(templateDir);
  let fileCount = 0;

  for (const tmplPath of templateFiles) {
    const relative = path.relative(templateDir, tmplPath).replace(/\\/g, '/');

    if (answers.database === 'sqlite' && relative.includes('.pg.')) continue;
    if (answers.database === 'postgres' && relative.includes('.sqlite.')) continue;

    if (relative === 'middleware/adminMiddleware.js' && !hasAdmin) continue;
    if (relative === 'controllers/adminController.js' && !hasAdmin) continue;

    const destRelative = relative.replace('.pg.', '.').replace('.sqlite.', '.');
    const destPath = path.join(targetDir, destRelative);
    const destDir = path.dirname(destPath);

    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    if (fs.existsSync(destPath)) {
      logger.warn(`Skipped ${destRelative} — already exists`);
      continue;
    }

    let content = fs.readFileSync(tmplPath, 'utf-8');
    content = processContent(content, answers);
    fs.writeFileSync(destPath, content, 'utf-8');
    logger.success(`Created ${destRelative}`);
    fileCount++;
  }

  return fileCount;
}

function collectFiles(dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir)) {
    const fullPath = path.join(dir, entry);
    if (fs.statSync(fullPath).isDirectory()) {
      results.push(...collectFiles(fullPath));
    } else {
      results.push(fullPath);
    }
  }
  return results;
}

function processContent(content, answers) {
  const hasLockout = answers.features && answers.features.includes('accountLockout');
  const hasDdos = answers.features && answers.features.includes('ddos');
  const hasAdmin = answers.features && answers.features.includes('admin');

  content = content.replace(/\{\{PORT\}\}/g, String(answers.port));
  content = content.replace(/\{\{TOTP_ISSUER\}\}/g, answers.projectName || 'SecureAuth-App');

  content = content.replace(/\{\{ACCOUNT_LOCKOUT\}\}/g, hasLockout ? LOCKOUT_HELPER : '');
  content = content.replace(/\{\{LOCKOUT_CHECK\}\}/g, hasLockout ? LOCKOUT_CHECK_CODE : '');
  content = content.replace(/\{\{LOCKOUT_INCREMENT\}\}/g, hasLockout ? LOCKOUT_INCREMENT_CODE : '');
  content = content.replace(/\{\{LOCKOUT_TRIGGER\}\}/g, hasLockout ? LOCKOUT_TRIGGER_CODE : '');
  content = content.replace(/\{\{LOCKOUT_RESET\}\}/g, hasLockout ? LOCKOUT_RESET_CODE : '');
  content = content.replace(/\{\{LOCKOUT_MESSAGE\}\}/g, hasLockout ? LOCKOUT_MESSAGE_CODE : "'Email or password is incorrect'");

  content = content.replace(/\{\{DDOS_MIDDLEWARE\}\}/g, hasDdos ? DDOS_MIDDLEWARE_CODE : '');

  content = content.replace(/\{\{ADMIN_ROUTES\}\}/g, hasAdmin ? ADMIN_ROUTES_CODE : '');

  return content;
}

module.exports = { scaffold };
