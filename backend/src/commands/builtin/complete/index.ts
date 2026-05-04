import Complete from './Complete.js';

const completeCommand = {
  name: 'complete',
  description: '提供命令自动补全功能',
  aliases: ['comp', 'auto'],
  argumentHint: '<命令> [输入]',
  type: 'local' as const,
  load: () => Promise.resolve(Complete),
};

export { completeCommand };
