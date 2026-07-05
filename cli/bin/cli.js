#!/usr/bin/env node

const { init } = require('../src/index');

const args = process.argv.slice(2);
const command = args[0];
const defaults = args.includes('--defaults') || args.includes('--yes');

switch (command) {
  case 'init':
    init(defaults);
    break;
  case '--help':
  case '-h':
  default:
    console.log(`
  SecureAuth CLI - Enterprise authentication for Express apps

  Usage:
    npx secureauth init              Add SecureAuth to your project (interactive)
    npx secureauth init --defaults   Add SecureAuth with all default options (non-interactive)
    npx secureauth init --yes        Same as --defaults
    npx secureauth --help            Show this help message

  Environment variables (with --defaults):
    SECUREAUTH_DB=sqlite|postgres
    SECUREAUTH_PORT=3000
    SECUREAUTH_JWT_SECRET=<your-secret>
    SECUREAUTH_FEATURES=ddos,admin,accountLockout
    `);
    break;
}
