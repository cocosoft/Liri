import Commit from './Commit.js';

const commitCommand = {
  name: 'commit',
  description: '执行Git提交操作',
  aliases: ['git-commit'],
  argumentHint: '<提交信息>',
  type: 'local' as const,
  load: () => Promise.resolve(Commit),
};

export { commitCommand };
