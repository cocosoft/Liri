/**
 * tag命令 - Git标签管理
 */

import { Command } from '../types/index';

/**
 * tag命令实现
 */
const tag: Command = {
  type: 'prompt',
  name: 'tag',
  description: 'Manage Git tags',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are a Git tag manager. Follow these steps:

      1. If no arguments are provided, run git tag to show all tags
      2. If "-l" or "--list" is provided followed by a pattern, run git tag -l <pattern> to list tags matching the pattern
      3. If a tag name is provided, run git tag <tag> to create a lightweight tag
      4. If "-a" is provided followed by a tag name, run git tag -a <tag> -m "tag message" to create an annotated tag
      5. If "-d" is provided followed by a tag name, run git tag -d <tag> to delete a tag
      6. If "-p" or "--pretty" is provided followed by a tag name, run git show <tag> to show tag details

      Provide the output of the Git commands and explain what you did.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default tag;
