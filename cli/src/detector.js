const fs = require('fs');
const path = require('path');

const REQUIRED_DIRS = ['controllers', 'routes', 'middleware', 'models', 'utils', 'database'];
const SECUREAUTH_DEPS = [
  'express', 'jsonwebtoken', 'helmet',
  'express-rate-limit', 'express-slow-down', 'speakeasy',
  'qrcode', 'dotenv', 'cors', 'uuid'
];

const BCRYPT_ALIASES = ['bcryptjs', 'bcrypt'];

function detect(dir) {
  const report = {
    hasPackageJson: false,
    hasExpress: false,
    hasExpressInstalled: false,
    hasSecureAuthDirs: false,
    hasEnvFile: false,
    existingDirs: [],
    missingDirs: [],
    installedDeps: [],
    missingDeps: [],
    packageJson: null,
    projectName: path.basename(dir)
  };

  const pkgPath = path.join(dir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    report.hasPackageJson = true;
    try {
      report.packageJson = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    } catch {
      return report;
    }

    const allDeps = {
      ...report.packageJson.dependencies,
      ...report.packageJson.devDependencies
    };
    report.installedDeps = Object.keys(allDeps);

    report.hasExpress = 'express' in allDeps;
    report.hasExpressInstalled = false;

    const nodeModulesExpress = path.join(dir, 'node_modules', 'express');
    if (fs.existsSync(nodeModulesExpress)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(nodeModulesExpress, 'package.json'), 'utf-8'));
        report.hasExpressInstalled = true;
      } catch {}
    }

    const hasBcrypt = BCRYPT_ALIASES.some(d => d in allDeps);
    report.missingDeps = SECUREAUTH_DEPS.filter(d => {
      if (d === 'bcryptjs') return !hasBcrypt;
      return !(d in allDeps);
    });
  }

  const existingDirs = [];
  const missingDirs = [];
  for (const d of REQUIRED_DIRS) {
    const full = path.join(dir, d);
    if (fs.existsSync(full) && fs.statSync(full).isDirectory()) {
      existingDirs.push(d);
    } else {
      missingDirs.push(d);
    }
  }
  report.existingDirs = existingDirs;
  report.missingDirs = missingDirs;
  report.hasSecureAuthDirs = missingDirs.length === 0;

  report.hasEnvFile = fs.existsSync(path.join(dir, '.env'));

  return report;
}

module.exports = { detect };
