#!/usr/bin/env node

const { init } = require('../src/index');

const command = process.argv[2];

switch (command) {
  case 'init':
    init();
    break;
  case '--help':
  case '-h':
  default:
    console.log(`
  SecureAuth CLI - Enterprise authentication for Express apps

  Usage:
    npx secureauth init    Add SecureAuth to your project
    npx secureauth --help  Show this help message
    `);
    break;
}
