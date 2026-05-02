/**
 * btw命令 - 旁注功能
 */

import { Command } from '../types/index';

/**
 * btw命令实现
 */
const btw: Command = {
  type: 'prompt',
  name: 'btw',
  description: 'Add a side note or additional context',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are adding a side note (btw). This is additional context or information that is not part of the main conversation.

      Guidelines:
      - Keep the side note relevant to the current conversation
      - Provide additional context or background information
      - Avoid derailing the main conversation
      - Keep the side note concise but informative

      Side note: ${args || 'No side note provided'}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default btw;
