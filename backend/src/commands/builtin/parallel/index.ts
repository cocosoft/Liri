import Parallel, { parallelCommand } from './Parallel.js';

export const parallel = {
  name: 'parallel',
  description: '并行执行多个工具操作',
  aliases: ['async', 'multi'],
  argumentHint: '[选项] <工具1> <输入1> ; <工具2> <输入2> ; ...',
  type: 'local' as const,
  load: () => Promise.resolve(Parallel),
};

export { parallelCommand };
