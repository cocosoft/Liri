import type { Command } from '../../types/index.js';

const history: Command = {
  type: 'action',
  name: 'history',
  description: '管理命令历史记录',
  aliases: ['hist', 'hst'],
  argumentHint: '[show|clear|search] [参数]',
  userInvocable: true,
  loadedFrom: 'builtin',
  load: async () => {
    const module = await import('./History.js');
    return module.default;
  },
};

export default history;
