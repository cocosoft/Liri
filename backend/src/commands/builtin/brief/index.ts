import { briefCommand } from './Brief.js';

export const brief = {
  name: 'brief',
  description: '生成代码或文档的摘要',
  aliases: ['summary', 'overview'],
  argumentHint: '<文件路径>',
  type: 'local' as const,
  load: () => Promise.resolve(briefCommand),
};

export { briefCommand };
