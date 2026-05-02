import Brief from './Brief.js';

export default {
  name: 'brief',
  description: '生成代码或文档的摘要',
  aliases: ['summary', 'overview'],
  argumentHint: '<文件路径>',
  type: 'local' as const,
  load: () => Promise.resolve(Brief),
};
