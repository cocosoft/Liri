/**
 * fast命令 - 快速模式聊�? */

import { Command } from '../types/index';

/**
 * fast命令实现
 */
const fast: Command = {
  type: 'prompt',
  name: 'fast',
  description: 'Chat in fast mode with shorter responses',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are in fast mode. Provide concise, to-the-point responses to the user's query.

      Guidelines:
      - Keep responses short and focused
      - Get straight to the point
      - Avoid unnecessary explanations
      - Use bullet points when appropriate
      - Respond quickly and efficiently

      User query: ${args || 'No specific query provided'}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default fast;
