import CommitCommand from './Commit.js';

const commitCommand = {
  name: 'commit',
  description: '智能Git提交 - 分析变更、安全协议、智能引导',
  aliases: ['git-commit'],
  argumentHint: '[选项] [提交信息]',
  type: 'local' as const,
  load: () => Promise.resolve(CommitCommand),
};

export { commitCommand };
