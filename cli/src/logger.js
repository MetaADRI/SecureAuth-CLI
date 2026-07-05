const chalk = require('chalk');

const logger = {
  info(msg) {
    console.log(chalk.blue('ℹ'), msg);
  },
  success(msg) {
    console.log(chalk.green('✔'), msg);
  },
  warn(msg) {
    console.log(chalk.yellow('⚠'), msg);
  },
  error(msg) {
    console.log(chalk.red('✖'), msg);
  },
  banner() {
    console.log(`
${chalk.cyan('╔══════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold('SecureAuth CLI')}                    ${chalk.cyan('║')}
${chalk.cyan('║')}  Enterprise Authentication for Express   ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════╝')}
`);
  },
  box(content) {
    const lines = content.split('\n');
    const width = 70;
    const top = chalk.cyan('╔' + '═'.repeat(width - 2) + '╗');
    const bottom = chalk.cyan('╚' + '═'.repeat(width - 2) + '╝');
    console.log('\n' + top);
    for (const line of lines) {
      const stripped = line.replace(/\u001b\[[0-9;]*m/g, '');
      const padding = width - 4 - stripped.length;
      console.log(chalk.cyan('║') + ' ' + line + ' '.repeat(Math.max(0, padding)) + chalk.cyan('║'));
    }
    console.log(bottom + '\n');
  },

  bullet() {
    return chalk.cyan('•');
  },
  checkmark() {
    return chalk.green('✔');
  },
  separator(label) {
    const line = '─'.repeat(30);
    return chalk.dim(line + ' ' + label + ' ' + line);
  },
  bold(text) {
    return chalk.bold(text);
  },
  dim(text) {
    return chalk.dim(text);
  },
  arrow() {
    return chalk.cyan('→');
  },
  underline(text) {
    return chalk.underline(text);
  }
};

module.exports = { logger };
