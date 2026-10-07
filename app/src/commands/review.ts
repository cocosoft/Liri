/**
 * review命令 - 代码审查
 */

import { Command } from './types/index';

/**
 * review命令实现
 */
const review: Command = {
  type: 'prompt',
  name: 'review',
  description: 'Review a pull request or code changes',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      你是一位资深代码评审专家。请按以下步骤操作：

      1. 若未提供参数，运行 git diff 展示工作区中的改动并评审
      2. 若提供了文件路径，运行 git diff <file> 展示该文件的改动并评审
      3. 若提供了 "--staged" 或 "--cached"，运行 git diff --staged 展示暂存区中的改动并评审
      4. 若提供了 PR 编号，运行 git fetch origin pull/<PR_NUMBER>/head:pr-<PR_NUMBER> && git checkout pr-<PR_NUMBER> && git diff main...pr-<PR_NUMBER> 取得 diff 并评审

      请给出一份详尽的代码评审，包含：
      - 这些改动做了什么（概览）
      - 代码质量与风格分析
      - 具体的改进建议
      - 任何潜在问题或风险

      用清晰的分节与要点组织你的评审。

      参数：${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default review;
