/**
 * commit-push-pr 命令
 * 提交、推送并创建 PR 的工作流命令
 */
import type {
  Command,
  CommandContext,
  CommandResult,
} from '@modules/commands/types';

/**
 * commit-push-pr 命令定义
 */
const commitPushPrCommand: Command = {
  type: 'prompt',
  name: 'commit-push-pr',
  description: '提交、推送并创建 Pull Request',
  aliases: ['pr-create', 'commit-pr'],
  argumentHint: '[提交说明]',
  loadedFrom: 'builtin',
  load: async () => ({
    async execute(
      _args: string,
      _context: CommandContext
    ): Promise<CommandResult> {
      return {
        success: true,
        type: 'text',
        message: [
          '🚀 commit-push-pr 命令',
          '',
          '此命令为 AI Git 工作流提示命令，需要在对话中由 AI 模型执行。',
          '它会自动执行提交代码、推送到远程并创建 Pull Request 的完整流程。',
          '',
          '用法:',
          '  /commit-push-pr                   执行完整 Git 工作流',
          '  /commit-push-pr "修复了登录问题"   附带提交说明',
          '',
          '提示: 在对话中直接输入 /commit-push-pr 即可启动 Git 工作流。',
        ].join('\n'),
      };
    },
  }),
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const userInstructions = args?.trim()
      ? `\n\n## 用户的额外指令\n\n${args.trim()}`
      : '';

    const prompt = `你是一个 Git 工作流助手。你的任务是执行完整的 commit-push-PR 工作流。

## 步骤

1. **分析当前状态**：
   - 运行 \`git status\` 查看当前变更
   - 运行 \`git branch --show-current\` 查看当前分支
   - 运行 \`git diff --stat\` 查看变更文件概览
   - 检查是否有上游分支 (\`git log --oneline origin/HEAD..HEAD\`)

2. **创建提交**：
   - 如果有未暂存的变更，使用 \`git add\` 暂存相关文件
   - 使用 \`git commit\` 创建提交，提交信息应遵循 Conventional Commits 规范
   - 提交信息格式: \`<type>(<scope>): <description>\`
   - 类型: feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert

3. **推送分支**：
   - 使用 \`git push -u origin <branch>\` 推送到远程
   - 如果推送失败，检查远程分支状态并解决冲突

4. **创建 Pull Request**：
   - 使用 \`gh pr create\` 创建 PR
   - PR 标题应简洁明了（不超过 70 字符）
   - PR 描述应包含：
     - 变更摘要（2-3 个要点）
     - 测试计划（检查清单）
     - 相关 Issue 链接（如有）

## Git 安全协议

- 绝不更新 git 配置
- 绝不使用 \`--no-verify\`、\`--no-gpg-sign\` 等跳过 hooks，除非用户明确要求
- 绝不使用 \`git push --force\` 到 main/master 分支
- 不要提交可能包含敏感信息的文件（.env, credentials.json 等）
- 绝不使用需要交互输入的 git 命令（如 \`git rebase -i\`、\`git add -i\`）

${userInstructions}`;

    return [{ type: 'text', text: prompt }];
  },
};

export { commitPushPrCommand };
