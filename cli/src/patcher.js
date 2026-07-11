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
  const destructMatch = content.match(/(?:const|let|var)\s+\{\s*(pool|db|client|query)\s*\}\s*=\s*require\(/i);
  if (destructMatch) return destructMatch[1];
  const exportMatch = content.match(/(?:const|let|var)\s+(\w+)\s*=\s*require\(['"]\.\.?\/[^'"]*db[^'"]*['"]\)/i);
  if (exportMatch) return exportMatch[1];
  return 'pool';
}

function detectParamStyle(content) {
  if (/\$\d/.test(content)) return 'postgres';
  return 'sqlite';
}

function detectApiStyle(content) {
  if (/\.prepare\s*\(/.test(content)) return 'native';
  return 'wrapper';
}

function generateLockoutEnvBlock() {
  return `
const MAX_FAILED_ATTEMPTS = parseInt(process.env.MAX_FAILED_ATTEMPTS) || 5;
const LOCKOUT_DURATION_MINUTES = parseInt(process.env.LOCKOUT_DURATION_MINUTES) || 30;
`;
}

function generateHelperBlock(dbVar, paramStyle, apiStyle) {
  const isSqlite = paramStyle === 'sqlite';
  const p1 = paramStyle === 'postgres' ? '$1' : '?';

  if (isSqlite && apiStyle === 'native') {
    return `

function checkAccountLockout(user) {
  if (user.locked_until) {
    const lockedUntil = new Date(user.locked_until);
    if (lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((lockedUntil - new Date()) / 60000);
      const err = new Error(\`Account locked due to too many failed attempts. Try again in \${minutesLeft} minute(s).\`);
      err.statusCode = 423;
      throw err;
    } else {
      ${dbVar}.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL WHERE id = ?').run(user.id);
    }
  }
}
`;
  }

  if (isSqlite) {
    return `

function checkAccountLockout(user) {
  if (user.locked_until) {
    const lockedUntil = new Date(user.locked_until);
    if (lockedUntil > new Date()) {
      const minutesLeft = Math.ceil((lockedUntil - new Date()) / 60000);
      const err = new Error(\`Account locked due to too many failed attempts. Try again in \${minutesLeft} minute(s).\`);
      err.statusCode = 423;
      throw err;
    } else {
      ${dbVar}.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL WHERE id = ?', [user.id]);
    }
  }
}
`;
  }

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
      await ${dbVar}.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL WHERE id = $1', [user.id]);
    }
  }
}
`;
}

function generateLockoutCheckBlock(dbVar, paramStyle) {
  const isSqlite = paramStyle === 'sqlite';
  if (isSqlite) {
    return `
    try {
      checkAccountLockout(user);
    } catch (lockErr) {
      return res.status(lockErr.statusCode || 423).json({
        error: 'Account locked',
        message: lockErr.message
      });
    }
`;
  }
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

function generateIncrementBlock(dbVar, paramStyle, apiStyle) {
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
  }

  if (apiStyle === 'native') {
    return `
    ${dbVar}.prepare('UPDATE users SET failed_login_attempts = failed_login_attempts + 1, last_failed_login = ? WHERE id = ?').run(new Date().toISOString(), user.id);
    const failedRow = ${dbVar}.prepare('SELECT failed_login_attempts FROM users WHERE id = ?').get(user.id);
    const failedAttempts = failedRow ? failedRow.failed_login_attempts : 1;
    const remaining = MAX_FAILED_ATTEMPTS - failedAttempts;
    if (failedAttempts >= MAX_FAILED_ATTEMPTS) {
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + LOCKOUT_DURATION_MINUTES);
      ${dbVar}.prepare('UPDATE users SET locked_until = ? WHERE id = ?').run(lockedUntil.toISOString(), user.id);
      return res.status(423).json({
        error: 'Account locked',
        message: \`Account locked due to \${MAX_FAILED_ATTEMPTS} failed attempts. Try again in \${LOCKOUT_DURATION_MINUTES} minutes.\`
      });
    }
`;
  }

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

function generateResetBlock(dbVar, paramStyle, apiStyle) {
  if (apiStyle === 'native') {
    return `
    ${dbVar}.prepare('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL WHERE id = ?').run(user.id);
`;
  }
  const param = paramStyle === 'postgres' ? '$1' : '?';
  if (paramStyle === 'postgres') {
    return `
    await ${dbVar}.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL WHERE id = ${param}', [user.id]);
`;
  }
  return `
    ${dbVar}.query('UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_failed_login = NULL WHERE id = ?', [user.id]);
`;
}

function generateMigrationSql(dbType) {
  if (dbType === 'postgres') {
    return `-- SecureAuth: Add account lockout columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login TIMESTAMPTZ;
`;
  }
  return `-- SecureAuth: Add account lockout columns
ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_failed_login TEXT;
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

function addHelper(content, dbVar, paramStyle, apiStyle) {
  const loginRouteRegex = /(?:router|app)\s*\.\s*(?:post|get)\s*\(\s*['"](?:\/(?:api\/)?)?(?:login|signin)['"]/;
  const loginMatch = content.match(loginRouteRegex);
  if (!loginMatch) return { content, modified: false };

  const lineStart = content.lastIndexOf('\n', loginMatch.index) + 1;
  const helper = generateHelperBlock(dbVar, paramStyle, apiStyle);
  return {
    content: content.slice(0, lineStart) + helper + '\n' + content.slice(lineStart),
    modified: true
  };
}

function addLockoutCheck(content, dbVar, paramStyle) {
  const asyncCompareRegex = /(?:const\s+)?is(?:Valid|PasswordValid)\s*=\s*await\s+bcrypt\.compare\(/;
  const syncCompareRegex = /(?:const\s+)?is(?:Valid|PasswordValid)\s*=\s*bcrypt\.compareSync\(/;

  let compareMatch = content.match(asyncCompareRegex);
  if (!compareMatch) {
    compareMatch = content.match(syncCompareRegex);
  }
  if (!compareMatch) return { content, modified: false };

  const lineStart = content.lastIndexOf('\n', compareMatch.index) + 1;
  const lockoutCheck = generateLockoutCheckBlock(dbVar, paramStyle);
  return {
    content: content.slice(0, lineStart) + lockoutCheck + content.slice(lineStart),
    modified: true
  };
}

function addIncrementReset(content, dbVar, paramStyle, apiStyle) {
  const invalidPwMatch = content.match(/if\s*\(\s*!is(?:Valid|PasswordValid)\s*\)/);
  if (!invalidPwMatch) return { content, modified: false };

  const blockStart = content.indexOf('{', invalidPwMatch.index);
  if (blockStart === -1) return { content, modified: false };

  const incrementBlock = generateIncrementBlock(dbVar, paramStyle, apiStyle);

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
        const resetBlock = generateResetBlock(dbVar, paramStyle, apiStyle);
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

  const resetBlock = generateResetBlock(dbVar, paramStyle, apiStyle);
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

const SCHEMA_FILE_CANDIDATES = [
  'initDatabase.js', 'init-db.js', 'init_db.js', 'initDatabase.ts',
  'database.js', 'db.js', 'schema.js', 'models.js',
  'database/init.js', 'database/setup.js', 'database/schema.js',
  'database/db.js', 'database/index.js',
  'db/init.js', 'db/setup.js', 'db/schema.js', 'db/index.js',
  'src/database.js', 'src/db.js', 'src/schema.js',
  'src/database/init.js', 'src/database/setup.js',
  'backend/database.js', 'backend/db.js',
  'backend/database/init.js', 'backend/database/setup.js',
  'models/User.js', 'models/user.js', 'models/userModel.js',
  'src/models/User.js', 'src/models/user.js', 'src/models/userModel.js'
];

const SCHEMA_NESTED_CANDIDATES = [
  ['database', 'schema.sql'],
  ['db', 'schema.sql'],
  ['migrations', '001_init.sql'],
  ['migrations', 'create_users.sql'],
  ['src', 'database', 'schema.sql'],
  ['prisma', 'schema.prisma']
];

function findSchemaFile(targetDir) {
  for (const name of SCHEMA_FILE_CANDIDATES) {
    const p = path.join(targetDir, name);
    if (fs.existsSync(p)) return p;
  }
  for (const parts of SCHEMA_NESTED_CANDIDATES) {
    const p = path.join(targetDir, ...parts);
    if (fs.existsSync(p)) return p;
  }
  const entry = findEntryPoint(targetDir);
  if (entry) {
    const content = fs.readFileSync(entry, 'utf-8');
    const schemaRequire = content.match(/require\(['"]\.\/?([^'"]*(?:database|db|schema|init)[^'"]*)['"]\)/i);
    if (schemaRequire) {
      const base = path.dirname(entry);
      let schemaPath = schemaRequire[1].replace(/\.js$/, '');
      for (const ext of ['', '.js', '.ts']) {
        const full = path.resolve(base, schemaPath + ext);
        if (fs.existsSync(full)) return full;
      }
    }
  }
  return null;
}

function isSchemaAlreadyPatched(content) {
  return /failed_login_attempts/.test(content);
}

function detectSchemaStyle(content) {
  if (/\.exec\s*\(`[\s\S]*CREATE\s+TABLE/i.test(content) || /\.exec\s*\([\s\S]*CREATE\s+TABLE/i.test(content)) return 'sqlite-exec';
  if (/CREATE\s+TABLE/i.test(content)) return 'sql';
  if (/knex\.schema|createTable\s*\(/i.test(content)) return 'knex';
  if (/\.init\s*\(|\.define\s*\(/i.test(content) && /DataTypes|sequelize/i.test(content)) return 'sequelize';
  if (/model\s*\(\s*['"]users['"]/i.test(content)) return 'mongoose';
  return 'unknown';
}

function generateLockoutColumnsForSchema(dbType) {
  if (dbType === 'postgres') {
    return `  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_failed_login TIMESTAMPTZ`;
  }
  return `  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TEXT,
  last_failed_login TEXT`;
}

function patchSqlInJs(content, dbType) {
  const createTableRegex = /((?:db|pool|client|connection)\s*\.\s*exec\s*\(\s*(?:`|['"]))([\s\S]*?)(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?users\s*\([\s\S]*?)(\)\s*(?:`|['"]))/i;
  const match = content.match(createTableRegex);
  if (!match) return { content, modified: false };

  const fullMatch = match[0];
  const usersTableStart = match[3];
  const closing = match[4];

  const colDef = generateLockoutColumnsForSchema(dbType);

  const patched = fullMatch.replace(
    usersTableStart + closing,
    usersTableStart + ',\n' + colDef + '\n' + closing
  );

  return {
    content: content.replace(fullMatch, patched),
    modified: true
  };
}

function patchRawSql(content, dbType) {
  const createTableRegex = /(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?users\s*\([\s\S]*?)(\)\s*;?\s*$)/im;
  const match = content.match(createTableRegex);
  if (!match) return { content, modified: false };

  const tableBody = match[1];
  const closing = match[2];

  const colDef = generateLockoutColumnsForSchema(dbType);

  const patched = content.replace(
    match[0],
    tableBody + ',\n' + colDef + '\n' + closing
  );

  return {
    content: patched,
    modified: true
  };
}

function patchKnexSchema(content, dbType) {
  const knexRegex = /createTable\s*\(\s*['"]users['"]\s*,\s*(?:function\s*\(\s*table\s*\)|\(\s*table\s*\)|\(\s*t\s*\)|\(\s*b\s*\)\s*=>|table\s*=>)/i;
  const match = content.match(knexRegex);
  if (!match) return { content, modified: false };

  const afterMatch = content.slice(match.index + match[0].length);
  const closingRegex = /\}\s*\)/;
  const closingMatch = afterMatch.match(closingRegex);
  if (!closingMatch) return { content, modified: false };

  const insertPos = match.index + match[0].length + closingMatch.index;
  const colDef = dbType === 'postgres'
    ? `\n    table.integer('failed_login_attempts').defaultTo(0);\n    table.timestamp('locked_until');\n    table.timestamp('last_failed_login');`
    : `\n    table.integer('failed_login_attempts').defaultTo(0);\n    table.string('locked_until');\n    table.string('last_failed_login');`;

  return {
    content: content.slice(0, insertPos) + colDef + '\n  ' + content.slice(insertPos),
    modified: true
  };
}

function patchSequelizeModel(content, dbType) {
  const initRegex = /((?:\.init|\.define)\s*\([^)]*\{[\s\S]*?)(\}\s*,)/;
  const match = content.match(initRegex);
  if (!match) return { content, modified: false };

  const colDef = dbType === 'postgres'
    ? `\n    failed_login_attempts: { type: DataTypes.INTEGER, defaultValue: 0 },\n    locked_until: DataTypes.DATE,\n    last_failed_login: DataTypes.DATE,`
    : `\n    failed_login_attempts: { type: DataTypes.INTEGER, defaultValue: 0 },\n    locked_until: DataTypes.TEXT,\n    last_failed_login: DataTypes.TEXT,`;

  return {
    content: content.replace(match[0], match[1] + colDef + '\n  ' + match[2]),
    modified: true
  };
}

function patchSchemaFile(targetDir, dbType) {
  const schemaFile = findSchemaFile(targetDir);
  if (!schemaFile) {
    logger.info('No schema file found — generating migration SQL instead');
    return writeMigration(targetDir, dbType);
  }

  let content = fs.readFileSync(schemaFile, 'utf-8');
  if (isSchemaAlreadyPatched(content)) {
    logger.info(`Schema file already has lockout columns: ${path.relative(targetDir, schemaFile)}`);
    return null;
  }

  const schemaStyle = detectSchemaStyle(content);
  logger.info(`Found schema file: ${path.relative(targetDir, schemaFile)} (style: ${schemaStyle})`);

  let result;
  switch (schemaStyle) {
    case 'sqlite-exec':
      result = patchSqlInJs(content, dbType);
      break;
    case 'sql':
      result = patchRawSql(content, dbType);
      break;
    case 'knex':
      result = patchKnexSchema(content, dbType);
      break;
    case 'sequelize':
      result = patchSequelizeModel(content, dbType);
      break;
    default:
      logger.warn(`Unknown schema style in ${path.relative(targetDir, schemaFile)} — generating migration SQL instead`);
      return writeMigration(targetDir, dbType);
  }

  if (!result.modified) {
    logger.warn(`Could not patch schema file automatically — generating migration SQL instead`);
    return writeMigration(targetDir, dbType);
  }

  fs.writeFileSync(schemaFile, result.content, 'utf-8');
  logger.success(`Patched ${path.relative(targetDir, schemaFile)} with lockout columns`);
  return null;
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
    patchSchemaFile(targetDir, detectDatabaseType(targetDir));
    return { patched: true, alreadyPatched: true, authFile };
  }

  const dbType = detectDatabaseType(targetDir);
  const paramStyle = detectParamStyle(content);
  const apiStyle = detectApiStyle(content);
  const dbVar = detectDbVariable(content);

  logger.info(`Database type: ${dbType}, param style: ${paramStyle}, API style: ${apiStyle}, DB variable: \`${dbVar}\``);

  let result = addEnvVars(content);
  content = result.content;

  result = addHelper(content, dbVar, paramStyle, apiStyle);
  content = result.content;

  result = addLockoutCheck(content, dbVar, paramStyle);
  content = result.content;

  result = addIncrementReset(content, dbVar, paramStyle, apiStyle);
  content = result.content;

  fs.writeFileSync(authFile, content, 'utf-8');
  logger.success(`Patched ${path.relative(targetDir, authFile)} with account lockout`);

  const migrationPath = patchSchemaFile(targetDir, dbType);

  logger.info('Add these to your .env file for lockout configuration:');
  logger.info('  MAX_FAILED_ATTEMPTS=5');
  logger.info('  LOCKOUT_DURATION_MINUTES=30');

  return { patched: true, authFile, migrationPath, dbType };
}

module.exports = { patchExisting, findEntryPoint, findAuthRouteFile, findSchemaFile, detectSchemaStyle, detectDatabaseType, detectDbVariable, detectParamStyle, detectApiStyle, isAlreadyPatched, isSchemaAlreadyPatched, writeMigration, patchSchemaFile };
