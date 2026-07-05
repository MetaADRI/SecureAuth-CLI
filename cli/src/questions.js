const { prompt } = require('enquirer');

async function askProjectType(defaults) {
  if (defaults) return 'existing';
  const { type } = await prompt({
    type: 'select',
    name: 'type',
    message: 'What kind of project is this?',
    choices: [
      { name: 'existing', message: 'Existing Express project — add SecureAuth to it' },
      { name: 'new', message: 'New project — scaffold from scratch' }
    ]
  });
  return type;
}

async function askProjectName(defaults) {
  if (defaults) return 'my-secure-app';
  const { name } = await prompt({
    type: 'input',
    name: 'name',
    message: 'What is your project name?',
    initial: 'my-secure-app',
    required: true,
    validate: v => /^[a-z0-9-]+$/.test(v) || 'Use lowercase letters, numbers, and hyphens only'
  });
  return name;
}

async function askDatabase(defaults) {
  if (defaults) return process.env.SECUREAUTH_DB || 'sqlite';
  const { db } = await prompt({
    type: 'select',
    name: 'db',
    message: 'Which database do you want to use?',
    choices: [
      { name: 'sqlite', message: 'SQLite — Zero config, best for development' },
      { name: 'postgres', message: 'PostgreSQL — Production-grade, requires a running server' }
    ],
    initial: 0
  });
  return db;
}

async function askPort(defaultPort, defaults) {
  if (defaults) return parseInt(process.env.SECUREAUTH_PORT || String(defaultPort), 10);
  const { port } = await prompt({
    type: 'input',
    name: 'port',
    message: 'Which port should the server run on?',
    initial: String(defaultPort),
    required: true,
    validate: v => /^\d+$/.test(v) || 'Enter a valid port number'
  });
  return parseInt(port, 10);
}

async function askJwtSecret(defaults) {
  const autoSecret = require('crypto').randomBytes(32).toString('hex');
  if (defaults) return process.env.SECUREAUTH_JWT_SECRET || autoSecret;
  const { choice } = await prompt({
    type: 'select',
    name: 'choice',
    message: 'JWT Secret — auto-generate or enter your own?',
    choices: [
      { name: 'auto', message: `Auto-generate a secure secret` },
      { name: 'manual', message: 'Enter my own secret' }
    ]
  });
  if (choice === 'auto') return autoSecret;
  const { secret } = await prompt({
    type: 'invisible',
    name: 'secret',
    message: 'Enter your JWT secret:',
    required: true,
    validate: v => v.length >= 32 || 'Secret must be at least 32 characters'
  });
  return secret;
}

async function askFeatures(defaults) {
  if (defaults) {
    const env = process.env.SECUREAUTH_FEATURES;
    if (env) return env.split(',').map(s => s.trim());
    return ['ddos', 'accountLockout'];
  }
  const { features } = await prompt({
    type: 'multiselect',
    name: 'features',
    message: 'Select additional features to enable:',
    choices: [
      { name: 'ddos', message: 'DDoS Protection — Rate limiting + IP blocking' },
      { name: 'admin', message: 'Admin Dashboard — User management panel' },
      { name: 'accountLockout', message: 'Account Lockout — Brute-force protection' }
    ],
    initial: [0, 2]
  });
  return features;
}

async function askConfirm(defaults) {
  if (defaults) return true;
  const { confirmed } = await prompt({
    type: 'toggle',
    name: 'confirmed',
    message: 'Ready to install SecureAuth?',
    enabled: 'Yes',
    disabled: 'No'
  });
  return confirmed;
}

module.exports = {
  askProjectType,
  askProjectName,
  askDatabase,
  askPort,
  askJwtSecret,
  askFeatures,
  askConfirm
};
