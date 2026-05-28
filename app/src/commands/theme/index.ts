// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * theme命令 - 主题管理
 */

import { Command } from '@modules/commands/types';

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
