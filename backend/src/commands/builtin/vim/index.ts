import Vim from './Vim.js';

const vimCommand = {
  name: 'vim',
  description: '打开Vim编辑器编辑文件',
  aliases: ['vi'],
  argumentHint: '<文件路径>',
  type: 'local' as const,
  load: () => Promise.resolve(Vim),
};

export { vimCommand };
