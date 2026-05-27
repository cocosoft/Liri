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
      You are an expert code reviewer. Follow these steps:

      1. If no arguments are provided, run git diff to show changes in the working directory and review them
      2. If a file path is provided, run git diff <file> to show changes in that file and review them
      3. If "--staged" or "--cached" is provided, run git diff --staged to show changes in the staging area and review them
      4. If a PR number is provided, run git fetch origin pull/<PR_NUMBER>/head:pr-<PR_NUMBER> && git checkout pr-<PR_NUMBER> && git diff main...pr-<PR_NUMBER> to get the diff and review it

      Provide a thorough code review that includes:
      - Overview of what the changes do
      - Analysis of code quality and style
      - Specific suggestions for improvements
      - Any potential issues or risks

      Format your review with clear sections and bullet points.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default review;
