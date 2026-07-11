const fs = require('fs');
const path = require('path');
const { logger } = require('./logger');

const ENTRY_CANDIDATES = ['server.js', 'app.js', 'index.js'];
const NESTED_ENTRIES = [
  ['backend', 'server.js'],
  ['backend', 'app.js'],
  ['backend', 'index.js'],
  ['src', 'server.js'],
  ['src', 'app.js'],
  ['src', 'index.js']
];
const AUTH_ROUTE_PATTERNS = [
  ['routes', 'auth.js'],
  ['routes', 'authRoutes.js'],
  ['backend', 'routes', 'auth.js'],
  ['backend', 'routes', 'authRoutes.js'],
  ['src', 'routes', 'auth.js'],
  ['src', 'routes', 'authRoutes.js']
];

function findEntryPoint(targetDir) {
  for (const name of ENTRY_CANDIDATES) {
    const p = path.join(targetDir, name);
    if (fs.existsSync(p)) return p;
  }
  for (const parts of NESTED_ENTRIES) {
    const p = path.join(targetDir, ...parts);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function findAuthRouteFile(targetDir) {
  const entry = findEntryPoint(targetDir);
  if (entry) {
    const content = fs.readFileSync(entry, 'utf-8');
    const regex = /require\(['"]\.\/?([^'"]*(?:auth|login)[^'"]*)['"]\)/i;
    const m = content.match(regex);
    if (m) {
      let routePath = m[1].replace(/\.js$/, '');
      const base = path.dirname(entry);
      for (const ext of ['', '.js']) {
        const full = path.resolve(base, routePath + ext);
        if (fs.existsSync(full)) return full;
      }
    }
  }
  for (const parts of AUTH_ROUTE_PATTERNS) {
    const p = path.join(targetDir, ...parts);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function detectDatabaseType(targetDir) {
  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
      if ('pg' in allDeps || '@neondatabase/serverless' in allDeps) return 'postgres';
      if ('better-sqlite3' in allDeps || 'sql.js' in allDeps) return 'sqlite';
      if ('mysql2' in allDeps) return 'mysql';
    } catch {}
  }
  const entry = findEntryPoint(targetDir);
  if (entry) {
    try {
      const content = fs.readFileSync(entry, 'utf-8');
      if (/require\(['"](pg|@neondatabase\/serverless)['"]\)/.test(content)) return 'postgres';
      if (/require\(['"]better-sqlite3['"]\)/.test(content)) return 'sqlite';
      if (/require\(['"]mysql2['"]\)/.test(content)) return 'mysql';
    } catch {}
  }
  const authFile = findAuthRouteFile(targetDir);
  if (authFile) {
    try {
      const content = fs.readFileSync(authFile, 'utf-8');
      if (/\$\d/.test(content)) return 'postgres';
      if (/\?\s*\]/.test(content) && /better-sqlite3/.test(content)) return 'sqlite';
    } catch {}
  }
  return 'sqlite';
}

function isAlreadyPatched(content) {
  return /checkAccountLockout/.test(content) ||
    /MAX_FAILED_ATTEMPTS/.test(content) ||
    /failed_login_attempts/.test(content) ||
    /LOCKOUT_DURATION_MINUTES/.test(content);
}

function detectDbVariable(content) {
  const poolMatch = content.match(/(?:const|let|var)\s+(pool|db|client|query)\s*=\s*(?:new\s+(?:Pool|Client|Database)|require\()/i);
  if (poolMatch) return poolMatch[1];
  const exportMatch = content.match(/(?:const|let|var)\s+(\w+)\s*=\s*require\(['"]\.\.?\/[^'"]*db[^'"]*['"]\)/i);
  if (exportMatch) return exportMatch[1];
  return 'pool';
}

function detectParamStyle(content) {
  if (/\$\d/.test(content)) return 'postgres';
  return 'sqlite';
}

function generateLockoutEnvBlock() {
  return `
const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_FAILED_ATTEMPTS) || 5;
const LOCKOUT_DURATION_MINUTES = parseInt(process.env.LOCKOUT_DURATION_MINUTES) || 30;
`;
}

function generateHelperBlock(dbVar, paramStyle) {
  const p1 = paramStyle === 'postgres' ? '$1' : '?';
  return `

async function checkAccountLockout(user, ${dbVar}) {
  if (user.locked_until) {
    const lockedUntil = new Date(user.locked_until);
    if (lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((lockedUntil - new Date()) / 60000);
      const err = new Error(\`Account locked due to too many failed attempts. Try again in \${minutesLeft} minute(s).\`);
      err.statusCode = 423;
      throw err;
    } else {
      // Lock expired — reset failed attempts so user can log in cleanly
      await ${dbVar}.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL WHERE id = ${p1}', [user.id]);
    }
  }
}
`;
}

function generateLockoutCheckBlock(dbVar) {
  return `
    try {
      await checkAccountLockout(user, ${dbVar});
    } catch (lockErr) {
      return res.status(lockErr.statusCode || 423).json({
        error: 'Account locked',
        message: lockErr.message
      });
    }
`;
}

function generateIncrementBlock(dbVar, paramStyle) {
  if (paramStyle === 'postgres') {
    return `
    const failedResult = await ${dbVar}.query('UPDATE users SET failed_login_attempts = failed_login_attempts + 1, last_failed_login = $1 WHERE id = $2 RETURNING failed_login_attempts', [new Date().toISOString(), user.id]);
    const failedAttempts = failedResult.rows[0] ? failedResult.rows[0].failed_login_attempts : 1;
    const remaining = MAX_FAILED_ATTEMPTS - failedAttempts;
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + LOCKOUT_DURATION_MINUTES);
      await ${dbVar}.query('UPDATE users SET locked_until = $1 WHERE id = $2', [lockedUntil.toISOString(), user.id]);
      return res.status(423).json({
        error: 'Account locked',
        message: \`Account locked due to \${MAX_FAILED_ATTEMPTS} failed attempts. Try again in \${LOCKOUT_DURATION_MINUTES} minutes.\`
      });
    }
`;
  } else {
    return `
    ${dbVar}.query('UPDATE users SET failed_login_attempts = failed_login_attempts + 1, last_failed_login = ? WHERE id = ?', [new Date().toISOString(), user.id]);
    const failedRow = ${dbVar}.query('SELECT failed_login_attempts FROM users WHERE id = ?', [user.id]);
    const failedAttempts = failedRow.rows[0] ? failedRow.rows[0].failed_login_attempts : 1;
    const remaining = MAX_FAILED_ATTEMPTS - failedAttempts;
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + LOCKOUT_DURATION_MINUTES);
      ${dbVar}.query('UPDATE users SET locked_until = ? WHERE id = ?', [lockedUntil.toISOString(), user.id]);
      return res.status(423).json({
        error: 'Account locked',
        message: \`Account locked due to \${MAX_FAILED_ATTEMPTS} failed attempts. Try again in \${LOCKOUT_DURATION_MINUTES} minutes.\`
      });
    }
`;
  }
}

function generateResetBlock(dbVar, paramStyle) {
  const param = paramStyle === 'postgres' ? '$1' : '?';
  return `
    await ${dbVar}.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL WHERE id = ${param}', [user.id]);
`;
}

function generateMigrationSql(dbType) {
  if (dbType === 'postgres') {
    return `-- SecureAuth: Add account lockout columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
`;
  }
  return `-- SecureAuth: Add account lockout columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TEXT;
`;
}

function addEnvVars(content) {
  const requireRegex = /(?:const|let|var)\s+\w+\s*=\s*require\([^)]+\)/g;
  let lastMatch = null;
  let m;
  while ((m = requireRegex.exec(content)) !== null) {
    lastMatch = m;
  }
  if (lastMatch) {
    const insertPos = content.indexOf('\n', lastMatch.index);
    const splitPos = insertPos !== -1 ? insertPos + 1 : content.length;
    return {
      content: content.slice(0, splitPos) + generateLockoutEnvBlock() + content.slice(splitPos),
      modified: true
    };
  }
  return { content: generateLockoutEnvBlock() + '\n' + content, modified: true };
}

function addHelper(content, dbVar, paramStyle) {
  const loginRouteRegex = /(?:router|app)\s*\.\s*(?:post|get)\s*\(\s*['"](?:\/(?:api\/)?)?(?:login|signin)['"]/;
  const loginMatch = content.match(loginRouteRegex);
  if (!loginMatch) return { content, modified: false };

  const lineStart = content.lastIndexOf('\n', loginMatch.index) + 1;
  const helper = generateHelperBlock(dbVar, paramStyle);
  return {
    content: content.slice(0, lineStart) + helper + '\n' + content.slice(lineStart),
    modified: true
  };
}

function addLockoutCheck(content, dbVar) {
  const compareRegex = /(?:const\s+)?is(?:Valid|PasswordValid)\s*=\s*await\s+bcrypt\.compare\(/;
  const compareMatch = content.match(compareRegex);
  if (!compareMatch) return { content, modified: false };

  const lineStart = content.lastIndexOf('\n', compareMatch.index) + 1;
  const lockoutCheck = generateLockoutCheckBlock(dbVar);
  return {
    content: content.slice(0, lineStart) + lockoutCheck + content.slice(lineStart),
    modified: true
  };
}

function addIncrementReset(content, dbVar, paramStyle) {
  const invalidPwMatch = content.match(/if\s*\(\s*!is(?:Valid|PasswordValid)\s*\)/);
  if (!invalidPwMatch) return { content, modified: false };

  const blockStart = content.indexOf('{', invalidPwMatch.index);
  if (blockStart === -1) return { content, modified: false };

  const incrementBlock = generateIncrementBlock(dbVar, paramStyle);

  const afterBrace = content.slice(blockStart + 1);
  const errorResponsePatterns = [
    /\breturn\s+res\.status\(40[13]\)/,
    /\bres\.status\(40[13]\)/,
  ];
  let firstError = -1;
  for (const p of errorResponsePatterns) {
    const m = afterBrace.search(p);
    if (m !== -1 && (firstError === -1 || m < firstError)) {
      firstError = m;
    }
  }
  if (firstError === -1) return { content, modified: false };

  const insertPos = blockStart + 1 + firstError;
  content = content.slice(0, insertPos) + incrementBlock + content.slice(insertPos);

  const closingBraceIndex = findMatchingBrace(content, blockStart);
  if (closingBraceIndex === -1) return { content, modified: false };

  const afterInvalidBlock = content.slice(closingBraceIndex + 1);
  const secondInvalidMatch = afterInvalidBlock.match(/if\s*\(\s*!is(?:Valid|PasswordValid)\s*\)/);
  if (secondInvalidMatch) {
    const secondBlockStart = afterInvalidBlock.indexOf('{', secondInvalidMatch.index);
    if (secondBlockStart !== -1) {
      const secondClosing = findMatchingBrace(afterInvalidBlock, secondBlockStart);
      if (secondClosing !== -1) {
        const afterSecond = afterInvalidBlock.slice(secondClosing + 1);
        const resetBlock = generateResetBlock(dbVar, paramStyle);
        const successPos = findSuccessResponse(afterSecond);
        if (successPos !== -1) {
          const insertAfterSecond = closingBraceIndex + 1 + secondClosing + 1 + successPos;
          content = content.slice(0, insertAfterSecond) + resetBlock + content.slice(insertAfterSecond);
          return { content, modified: true };
        }
      }
    }
  }

  const afterBlock = content.slice(closingBraceIndex + 1);
  const hasAnotherCompare = afterBlock.match(/await\s+bcrypt\.compare\(/);
  if (hasAnotherCompare) {
    return { content, modified: false };
  }

  const resetBlock = generateResetBlock(dbVar, paramStyle);
  const successPos = findSuccessResponse(afterBlock);
  if (successPos !== -1) {
    const insertPosReset = closingBraceIndex + 1 + successPos;
    content = content.slice(0, insertPosReset) + resetBlock + content.slice(insertPosReset);
    return { content, modified: true };
  }

  return { content, modified: false };
}

function findSuccessResponse(str) {
  const patterns = [
    /\breturn\s+res\.status\(2\d{2}\)\s*\.\s*json\(/,
    /\breturn\s+res\.json\(/,
    /\bres\.status\(2\d{2}\)\s*\.\s*json\(/,
    /\bres\.json\(/
  ];
  for (const p of patterns) {
    const m = str.match(p);
    if (m) {
      return m.index;
    }
  }
  return -1;
}

function addStatus423Return(content, dbVar, paramStyle) {
  const lockedResponse = `\n      return res.status(423).json({
        error: 'Account locked',
        message: \`Account locked due to \${MAX_FAILED_ATTEMPTS} failed attempts. Try again in \${LOCKOUT_DURATION_MINUTES} minutes.\`
      });`;
  const ifBlockRegex = /if\s*\(\s*failedAttempts\s*>=\s*MAX_FAILED_ATTEMPTS\s*\)\s*\{/;
  const ifMatch = content.match(ifBlockRegex);
  if (!ifMatch) return { content, modified: false };

  const blockStart = content.indexOf('{', ifMatch.index);
  const beforeLock = content.slice(blockStart + 1).match(/\bawait\s+dbVar\.query\(/);
  if (beforeLock) {
    const insertAfterLock = blockStart + 1 + beforeLock.index + beforeLock[0].length;
    const semicolon = content.indexOf(';', insertAfterLock);
    if (semicolon !== -1) {
      content = content.slice(0, semicolon + 1) + lockedResponse + content.slice(semicolon + 1);
      return { content, modified: true };
    }
  }
  return { content, modified: false };
}

function findMatchingBrace(str, openPos) {
  if (str[openPos] !== '{') return -1;
  let depth = 0;
  for (let i = openPos; i < str.length; i++) {
    if (str[i] === '{') depth++;
    else if (str[i] === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function writeMigration(targetDir, dbType) {
  const fileName = 'migration_lockout.sql';
  const filePath = path.join(targetDir, fileName);

  if (fs.existsSync(filePath)) {
    logger.warn(`${fileName} already exists — skipping`);
    return null;
  }

  const sql = generateMigrationSql(dbType);
  fs.writeFileSync(filePath, sql, 'utf-8');
  logger.success(`Created ${fileName}`);
  return filePath;
}

function patchExisting(targetDir, answers) {
  const hasLockout = answers.features && answers.features.includes('accountLockout');
  if (!hasLockout) {
    logger.info('Account lockout not selected — skipping patcher');
    return { patched: false };
  }

  const authFile = findAuthRouteFile(targetDir);
  if (!authFile) {
    logger.warn('Could not find existing auth route file — lockout not patched');
    return { patched: false };
  }

  logger.info(`Found auth route: ${path.relative(targetDir, authFile)}`);

  let content = fs.readFileSync(authFile, 'utf-8');
  if (isAlreadyPatched(content)) {
    logger.info('Auth route already has lockout protection');
    const migrationPath = writeMigration(targetDir, detectDatabaseType(targetDir));
    return { patched: true, alreadyPatched: true, authFile, migrationPath };
  }

  const dbType = detectDatabaseType(targetDir);
  const paramStyle = detectParamStyle(content);
  const dbVar = detectDbVariable(content);

  logger.info(`Database type: ${dbType}, param style: ${paramStyle}, DB variable: \`${dbVar}\``);

  let result = addEnvVars(content);
  content = result.content;

  result = addHelper(content, dbVar, paramStyle);
  content = result.content;

  result = addLockoutCheck(content, dbVar);
  content = result.content;

  result = addIncrementReset(content, dbVar, paramStyle);
  content = result.content;

  fs.writeFileSync(authFile, content, 'utf-8');
  logger.success(`Patched ${path.relative(targetDir, authFile)} with account lockout`);

  const migrationPath = writeMigration(targetDir, dbType);

  logger.info('Add these to your .env file for lockout configuration:');
  logger.info('  MAX_FAILED_ATTEMPTS=5');
  logger.info('  LOCKOUT_DURATION_MINUTES=30');

  return { patched: true, authFile, migrationPath, dbType };
}

module.exports = { patchExisting, findEntryPoint, findAuthRouteFile, detectDatabaseType, detectDbVariable, detectParamStyle, isAlreadyPatched, writeMigration };
