import Parallel from './Parallel.js';

export default {
  name: 'parallel',
  description: '并行执行多个工具',
  aliases: ['async', 'multi'],
  argumentHint: '<工具1> <输入1> ; <工具2> <输入2> ; ...',
  type: 'local' as const,
  load: () => Promise.resolve(Parallel),
};
