const { logger } = require('./logger');

function printReport(report) {
  logger.info(`Project: ${report.projectName}`);

  if (!report.hasPackageJson) {
    logger.warn('No package.json found — will scaffold from scratch');
    return;
  }

  if (report.hasExpress) {
    logger.success('Express detected in dependencies');

    if (report.hasExpressInstalled) {
      logger.success('Express is already installed in node_modules');
    } else {
      logger.warn('Express declared but not installed — will install');
    }
  } else {
    logger.warn('Express not found — will add it');
  }

  if (report.missingDeps.length === 0) {
    logger.success('All SecureAuth dependencies already installed');
  } else {
    logger.info(`${report.missingDeps.length} packages to install: ${report.missingDeps.join(', ')}`);
  }

  if (report.hasSecureAuthDirs) {
    logger.success('All SecureAuth folders already exist');
  } else {
    if (report.existingDirs.length > 0) {
      logger.info(`Found folders: ${report.existingDirs.join(', ')}`);
    }
    logger.info(`Will create: ${report.missingDirs.join(', ')}`);
  }

  if (report.hasEnvFile) {
    logger.warn('.env file exists — will not overwrite');
  } else {
    logger.info('No .env file — will create one');
  }
}

module.exports = { printReport };
