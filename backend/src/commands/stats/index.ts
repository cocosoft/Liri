/**
 * stats命令 - 系统统计信息
 */

import { Command } from '../types/index';

/**
 * stats命令实现
 */
const stats: Command = {
  type: 'prompt',
  name: 'stats',
  description: 'Show system statistics',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are a system statistician. Follow these steps:

      1. Generate system statistics:
         - Memory usage
         - CPU usage
         - Disk usage
         - Network usage
         - Process information

      2. Generate project statistics:
         - Number of files
         - Lines of code
         - Commit history
         - Test coverage if applicable

      3. Format the statistics in a clear, readable manner with appropriate sections and headings.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default stats;
