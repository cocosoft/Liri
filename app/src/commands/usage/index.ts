/**
 * usage命令 - 使用情况分析
 */

import { Command } from '@modules/commands/types';

/**
 * usage命令实现
 */
const usage: Command = {
  type: 'prompt',
  name: 'usage',
  description: 'Analyze usage patterns',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are a usage analyst. Follow these steps:

      1. Analyze usage patterns:
         - Command usage frequency
         - Tool usage frequency
         - Session duration
         - Most commonly used features
         - Time of day usage patterns

      2. Generate insights and recommendations based on usage patterns:
         - Suggest ways to improve workflow
         - Identify underutilized features
         - Provide personalized recommendations

      3. Format the analysis in a clear, readable manner with appropriate sections and headings.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default usage;
