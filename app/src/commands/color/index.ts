/**
 * color命令 - 颜色配置
 */

import { Command } from '@modules/commands/types';

/**
 * color命令实现
 */
const color: Command = {
  type: 'prompt',
  name: 'color',
  description: 'Manage color settings',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are a color manager. Follow these steps:

      1. If no arguments are provided, show the current color settings
      2. If "list" is provided, list all available color schemes
      3. If "dark" is provided, set dark mode
      4. If "light" is provided, set light mode
      5. If "custom" is provided, guide the user through customizing colors
      6. If "reset" is provided, reset to default color settings

      Provide clear instructions and feedback on color changes.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default color;
