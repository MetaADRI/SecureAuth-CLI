const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { logger } = require('./logger');

const DB_DRIVERS = {
  sqlite: 'better-sqlite3',
  postgres: 'pg'
};

function isDepInstalled(cwd, name) {
  const pkgPath = path.join(cwd, 'package.json');
  if (!fs.existsSync(pkgPath)) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const all = { ...pkg.dependencies, ...pkg.devDependencies };
    if (!(name in all)) return false;
    return fs.existsSync(path.join(cwd, 'node_modules', name));
  } catch {
    return false;
  }
}

function install(cwd, missingDeps, answers) {
  const dbDriver = DB_DRIVERS[answers.database];
  const allDeps = [...(missingDeps || [])];

  if (dbDriver && !isDepInstalled(cwd, dbDriver) && !allDeps.includes(dbDriver)) {
    // Only add driver if not already in package.json + node_modules
    const pkgPath = path.join(cwd, 'package.json');
    let hasInPkg = false;
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const all = { ...pkg.dependencies, ...pkg.devDependencies };
        hasInPkg = dbDriver in all;
      } catch {}
    }
    if (!hasInPkg) {
      allDeps.push(dbDriver);
    }
  }

  // Scaffolded SecureAuth templates use bcryptjs
  if (answers.installMode !== 'patch' && !isDepInstalled(cwd, 'bcryptjs') && !isDepInstalled(cwd, 'bcrypt')) {
    if (!allDeps.includes('bcryptjs')) allDeps.push('bcryptjs');
  }

  if (allDeps.length === 0) {
    logger.success('All dependencies already installed');
    return Promise.resolve();
  }

  logger.info(`Installing ${allDeps.length} packages: ${allDeps.join(', ')}`);

  try {
    execSync(`npm install ${allDeps.join(' ')} --save --progress=false`, {
      cwd,
      stdio: 'inherit',
      shell: true
    });
    logger.info('');
    logger.success('Dependencies installed successfully');
    return Promise.resolve();
  } catch (err) {
    logger.error('npm install failed');
    logger.error(`Exit code: ${err.status}`);
    return Promise.reject(err);
  }
}

module.exports = { install };
