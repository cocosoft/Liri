/**
 * plan命令 - 计划生成
 */

import { Command } from '@modules/commands/types';

/**
 * plan命令实现
 */
const plan: Command = {
  type: 'prompt',
  name: 'plan',
  description: 'Generate a plan for a task or project',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are a planner. Generate a detailed plan for the task or project described by the user.

      Guidelines:
      - Break down the task into manageable steps
      - Include timelines and dependencies
      - Identify potential challenges and solutions
      - Provide clear, actionable steps
      - Format the plan with sections and bullet points

      Task or project: ${args || 'No specific task or project provided'}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default plan;
