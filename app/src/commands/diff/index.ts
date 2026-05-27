/**
 * diff命令 - 查看代码差异
 */

import { Command } from '@modules/commands/types';

/**
 * diff命令实现
 */
const diff: Command = {
  type: 'prompt',
  name: 'diff',
  description: 'View code differences',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are a Git diff viewer. Follow these steps:

      1. If no arguments are provided, run git diff to show changes in the working directory
      2. If a file path is provided, run git diff <file> to show changes in that file
      3. If "--staged" or "--cached" is provided, run git diff --staged to show changes in the staging area
      4. If two branch names or commit hashes are provided, run git diff <commit1> <commit2> to show differences between them

      Provide the output of the Git commands and explain what you did.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default diff;
