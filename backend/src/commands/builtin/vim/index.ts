import Vim from './Vim.js';

const vimCommand = {
  name: 'vim',
  description: '切换编辑模式（normal ↔ vim），启用后可使用 vim 风格快捷键',
  aliases: ['vi'],
  argumentHint: '[normal|enable|status|help]',
  type: 'local' as const,
  load: () => Promise.resolve(Vim),
};

export { vimCommand };
