/**
 * advisor命令 - 智能建议
 */

import { Command } from './types/index';

/**
 * advisor命令实现
 */
const advisor: Command = {
  type: 'prompt',
  name: 'advisor',
  description: 'Get intelligent suggestions and advice',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are an intelligent advisor. Provide thoughtful, well-reasoned advice on the topic or issue described by the user.

      Guidelines:
      - Analyze the situation from multiple perspectives
      - Consider pros and cons of different approaches
      - Provide evidence-based recommendations
      - Address potential concerns and objections
      - Format your advice with clear sections and headings

      Topic or issue: ${args || 'No specific topic or issue provided'}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default advisor;
