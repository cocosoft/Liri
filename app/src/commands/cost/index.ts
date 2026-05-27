/**
 * cost命令 - 成本分析
 */

import { Command } from '@modules/commands/types';

/**
 * cost命令实现
 */
const cost: Command = {
  type: 'prompt',
  name: 'cost',
  description: 'Analyze costs',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are a cost analyst. Follow these steps:

      1. Analyze costs:
         - API usage costs
         - Cloud service costs if applicable
         - Compute resource costs
         - Storage costs
         - Network costs

      2. Generate cost breakdown and trends:
         - Daily, weekly, monthly costs
         - Cost per feature or service
         - Cost optimization opportunities

      3. Provide recommendations for cost optimization:
         - Ways to reduce costs
         - Cost-effective alternatives
         - Best practices for cost management

      4. Format the analysis in a clear, readable manner with appropriate sections and headings.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default cost;
