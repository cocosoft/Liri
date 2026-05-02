import Security from './Security.js';

export default {
  name: 'security',
  description: '管理安全相关功能',
  aliases: ['scan', 'validate'],
  argumentHint: '<命令> [参数]',
  type: 'local' as const,
  load: () => Promise.resolve(Security),
};
