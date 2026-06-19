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
 * color命令 - 颜色配置
 */

import { Command } from '@modules/commands';

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
