const { spawn, execSync } = require('child_process');
const { logger } = require('./logger');

const DB_DRIVERS = {
  sqlite: 'better-sqlite3',
  postgres: 'pg'
};

function getNpmCommand() {
  try {
    execSync('npm.cmd --version', { stdio: 'ignore' });
    return 'npm.cmd';
  } catch {
    return 'npm';
  }
}

function install(cwd, missingDeps, answers) {
  return new Promise((resolve, reject) => {
    const dbDriver = DB_DRIVERS[answers.database];
    const allDeps = [...missingDeps];

    if (dbDriver && !allDeps.includes(dbDriver)) {
      allDeps.push(dbDriver);
    }

    if (allDeps.length === 0) {
      logger.success('All dependencies already installed');
      return resolve();
    }

    logger.info(`Installing ${allDeps.length} packages: ${allDeps.join(', ')}`);
    logger.info('');

    const args = ['install', ...allDeps, '--save', '--progress=false'];
    const npmCmd = getNpmCommand();

    const child = spawn(npmCmd, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let output = '';

    child.stdout.on('data', data => {
      output += data.toString();
    });

    child.stderr.on('data', data => {
      const line = data.toString().trim();
      if (line && !line.startsWith('npm WARN')) {
        output += line + '\n';
      }
    });

    child.on('close', code => {
      if (code === 0) {
        logger.success('Dependencies installed successfully');
        resolve();
      } else {
        logger.error('npm install failed');
        logger.error(`Exit code: ${code}`);
        reject(new Error(`npm install exited with code ${code}`));
      }
    });

    child.on('error', err => {
      logger.error(`Failed to start npm: ${err.message}`);
      reject(err);
    });
  });
}

module.exports = { install };
