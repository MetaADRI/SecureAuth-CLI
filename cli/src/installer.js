const { execSync } = require('child_process');
const { logger } = require('./logger');

const DB_DRIVERS = {
  sqlite: 'better-sqlite3',
  postgres: 'pg'
};

function install(cwd, missingDeps, answers) {
  const dbDriver = DB_DRIVERS[answers.database];
  const allDeps = [...missingDeps];

  if (dbDriver && !allDeps.includes(dbDriver)) {
    allDeps.push(dbDriver);
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
