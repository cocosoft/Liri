import Advisor from './Advisor.js';

export default {
  name: 'advisor',
  description: '提供代码建议和优化建议',
  aliases: ['advise', 'suggest'],
  argumentHint: '<命令> [目标]',
  type: 'local' as const,
  load: () => Promise.resolve(Advisor),
};
