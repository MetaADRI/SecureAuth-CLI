const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');
const { detect } = require('./detector');
const { printReport } = require('./reporter');
const { install } = require('./installer');
const { writeEnvFile } = require('./generator');
const { scaffold } = require('./scaffolder');
const {
  askProjectType,
  askProjectName,
  askDatabase,
  askPort,
  askJwtSecret,
  askFeatures,
  askConfirm
} = require('./questions');

const FEATURE_LABELS = {
  ddos: 'DDoS Protection',
  admin: 'Admin Dashboard',
  accountLockout: 'Account Lockout'
};

function printSuccess(answers, filesCreated) {
  const features = answers.features && answers.features.length > 0
    ? answers.features.map(f => '    ' + logger.bullet() + ' ' + (FEATURE_LABELS[f] || f)).join('\n')
    : '    (none selected — core auth only)';

  logger.box(`
${logger.checkmark()} SecureAuth installed successfully!

  Files generated:  ${filesCreated}
  Database:         ${answers.database}
  Port:             ${answers.port}

  Features enabled:
${features}

${logger.separator('Quick Start')}

  ${logger.bold('npm start')}
  ${logger.arrow()} http://localhost:${answers.port}

${logger.separator('API Endpoints')}

  ${logger.dim('Auth')}
    POST /api/register       Register + 2FA setup
    POST /api/login          Login (step 1 — password)
    POST /api/verify-2fa     Login (step 2 — TOTP code)
    POST /api/refresh        Refresh access token

  ${logger.dim('Protected')}
    GET  /api/dashboard      User dashboard
    GET  /api/login-history  Login history${answers.features && answers.features.includes('admin') ? `

  ${logger.dim('Admin')}
    GET  /api/admin/users    List all users
    GET  /api/admin/logs     System audit logs
    GET  /api/admin/stats    System statistics` : ''}

  ${logger.dim('System')}
    GET  /api/health         Health check

${logger.separator('Demo Credentials')}

  ${logger.bold('User:')}  demo@secureauth.com / Demo@123
  ${logger.bold('Admin:')} admin@secureauth.com / AdminPassword123!

${logger.separator('Next Steps')}

  1. Review .env and customize settings
  2. Run ${logger.bold('npm start')}
  3. Open ${logger.underline('http://localhost:' + answers.port)}
  4. Register at POST /api/register
`);
}

async function init() {
  logger.banner();

  const targetDir = process.cwd();

  const report = detect(targetDir);
  printReport(report);
  logger.info('');

  const projectType = report.hasPackageJson
    ? 'existing'
    : await askProjectType();

  const answers = { projectName: report.projectName };

  if (projectType === 'new') {
    answers.projectName = await askProjectName();
  }

  answers.database = await askDatabase();
  answers.port = await askPort(3000);
  answers.jwtSecret = await askJwtSecret();
  logger.info(logger.dim('Not sure which features to pick? Visit https://secureauth106293.netlify.app/ for guidance.'));
  answers.features = await askFeatures();

  logger.info('');
  const confirmed = await askConfirm();
  if (!confirmed) {
    logger.warn('Installation cancelled.');
    return;
  }

  logger.success('Starting SecureAuth installation...');
  logger.info(`Project:   ${answers.projectName}`);
  logger.info(`Database:  ${answers.database}`);
  logger.info(`Port:      ${answers.port}`);
  logger.info(`Features:  ${answers.features.join(', ') || 'none'}`);

  logger.info('');

  await install(targetDir, report.missingDeps, answers);

  const filesCreated = scaffold(targetDir, answers);

  writeEnvFile(targetDir, answers);

  printSuccess(answers, filesCreated);
}

module.exports = { init };
