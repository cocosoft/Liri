import Cache from './Cache.js';

const cacheCommand = {
  name: 'cache',
  description: '管理工具执行缓存',
  aliases: ['tool-cache'],
  argumentHint: '<命令> [工具名称]',
  type: 'local' as const,
  load: () => Promise.resolve(Cache),
};

export { cacheCommand };
