const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');
const { detect } = require('./detector');
const { printReport } = require('./reporter');
const { install } = require('./installer');
const { writeEnvFile } = require('./generator');
const { scaffold } = require('./scaffolder');
const { patchExisting } = require('./patcher');
const {
  askProjectType,
  askProjectName,
  askDatabase,
  askPort,
  askJwtSecret,
  askFeatures,
  askInstallMode,
  askConfirm
} = require('./questions');

const FEATURE_LABELS = {
  ddos: 'DDoS Protection',
  admin: 'Admin Dashboard',
  accountLockout: 'Account Lockout'
};

function printSuccess(answers, filesCreated, patchResult) {
  const features = answers.features && answers.features.length > 0
    ? answers.features.map(f => '    ' + logger.bullet() + ' ' + (FEATURE_LABELS[f] || f)).join('\n')
    : '    (none selected — core auth only)';

  const isPatch = answers.installMode === 'patch';
  const filesLine = isPatch
    ? `  Mode:             Patch existing login route`
    : `  Files generated:  ${filesCreated}`;

  const patchLines = isPatch && patchResult && patchResult.patched
    ? `
  Auth route:       ${patchResult.authFile ? path.relative(process.cwd(), patchResult.authFile) : 'n/a'}
  Lockout module:   ${patchResult.modulePath ? path.relative(process.cwd(), patchResult.modulePath) : 'n/a'}
`
    : '';

  const nextSteps = isPatch
    ? `
${logger.separator('Next Steps')}

  1. Review .env (MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MINUTES)
  2. Run ${logger.bold('npm start')}
  3. Try logging in with a wrong password ${answers.features && answers.features.includes('accountLockout') ? '5 times' : ''} to verify lockout
  4. Correct password after lock expiry (or reset locked_until in the DB)
`
    : `
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
`;

  logger.box(`
${logger.checkmark()} SecureAuth installed successfully!

${filesLine}
  Database:         ${answers.database}
  Port:             ${answers.port}
${patchLines}
  Features enabled:
${features}
${nextSteps}`);
}

async function init(defaults) {
  logger.banner();

  const targetDir = process.cwd();

  const report = detect(targetDir);
  printReport(report);
  logger.info('');

  const projectType = report.hasPackageJson
    ? 'existing'
    : await askProjectType(defaults);

  const answers = { projectName: report.projectName };

  if (projectType === 'new') {
    answers.projectName = await askProjectName(defaults);
  }

  answers.database = await askDatabase(defaults);
  answers.port = await askPort(3000, defaults);
  answers.jwtSecret = await askJwtSecret(defaults);
  logger.info(logger.dim('Not sure which features to pick? Visit https://secureauth106293.netlify.app/ for guidance.'));
  answers.features = await askFeatures(defaults);

  if (projectType === 'existing') {
    answers.installMode = await askInstallMode(defaults);
  } else {
    answers.installMode = 'scaffold';
  }

  // Auto-detect SQLite when the host app already uses it
  if (projectType === 'existing' && answers.database === 'sqlite') {
    // keep user choice
  }

  logger.info('');
  const confirmed = await askConfirm(defaults);
  if (!confirmed) {
    logger.warn('Installation cancelled.');
    return;
  }

  logger.success('Starting SecureAuth installation...');
  logger.info(`Project:   ${answers.projectName}`);
  logger.info(`Database:  ${answers.database}`);
  logger.info(`Port:      ${answers.port}`);
  logger.info(`Features:  ${answers.features.join(', ') || 'none'}`);
  if (projectType === 'existing') {
    logger.info(`Mode:      ${answers.installMode === 'patch' ? 'Patch existing login route' : 'Add alongside existing auth'}`);
  }

  logger.info('');

  try {
    await install(targetDir, report.missingDeps, answers);

    let filesCreated = 0;
    let patchResult = null;

    if (answers.installMode === 'patch') {
      patchResult = patchExisting(targetDir, answers);
      writeEnvFile(targetDir, answers);
      printSuccess(answers, 0, patchResult);

      if (!patchResult || !patchResult.patched) {
        logger.warn('Patch mode finished with warnings — check messages above.');
        process.exitCode = 1;
      }
    } else {
      filesCreated = scaffold(targetDir, answers);
      // If user also wanted lockout on an existing app "alongside", still try patching if lockout selected
      if (projectType === 'existing' && answers.features.includes('accountLockout')) {
        logger.info('Also applying account lockout to existing login route (if found)...');
        patchResult = patchExisting(targetDir, answers);
      }
      writeEnvFile(targetDir, answers);
      printSuccess(answers, filesCreated, patchResult);
    }
  } catch (err) {
    logger.error('Installation failed: ' + (err && err.message ? err.message : String(err)));
    process.exitCode = 1;
  }
}

module.exports = { init };
