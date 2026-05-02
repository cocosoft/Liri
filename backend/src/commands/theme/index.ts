/**
 * theme命令 - 主题管理
 */

import { Command } from '../types/index';

/**
 * theme命令实现
 */
const theme: Command = {
  type: 'prompt',
  name: 'theme',
  description: 'Manage UI themes',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are a theme manager. Follow these steps:

      1. If no arguments are provided, show the current theme and list available themes
      2. If "list" is provided, list all available themes
      3. If a theme name is provided, set that theme as the current theme
      4. If "reset" is provided, reset to the default theme
      5. If "custom" is provided, guide the user through creating a custom theme

      Provide clear instructions and feedback on theme changes.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default theme;
