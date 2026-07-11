#!/usr/bin/env node

const { init } = require('../src/index');

const args = process.argv.slice(2);
const command = args[0];
const defaults = args.includes('--defaults') || args.includes('--yes');

switch (command) {
  case 'init':
    init(defaults).catch((err) => {
      console.error('SecureAuth failed:', err && err.message ? err.message : err);
      process.exit(1);
    });
    break;
  case '--help':
  case '-h':
  default:
    console.log(`
  SecureAuth CLI - Enterprise authentication for Express apps

  Usage:
    npx @metaadri/secureauth init              Interactive install
    npx @metaadri/secureauth init --defaults   Non-interactive (recommended for CI)
    npx @metaadri/secureauth init --yes        Same as --defaults
    npx @metaadri/secureauth --help            Show this help message

  Local development (from a cloned repo):
    node path/to/cli/bin/cli.js init
    npm link   (inside cli/) then: secureauth init

  Environment variables (with --defaults):
    SECUREAUTH_DB=sqlite|postgres
    SECUREAUTH_PORT=3000
    SECUREAUTH_JWT_SECRET=<your-secret>
    SECUREAUTH_FEATURES=ddos,admin,accountLockout

  Example — install only account lockout on an existing SQLite app:
    set SECUREAUTH_DB=sqlite
    set SECUREAUTH_FEATURES=accountLockout
    npx @metaadri/secureauth init --yes
    `);
    break;
}
