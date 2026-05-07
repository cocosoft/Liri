import Security from './Security.js';

const securityCommand = {
  name: 'security',
  description: '管理安全相关功能。子命令: check, deep, scan, validate, sanitize, status, patterns, classify',
  aliases: ['sec'],
  argumentHint: '<子命令> [参数] [--json]',
  type: 'local' as const,
  load: () => Promise.resolve(Security),
};

export { securityCommand };
