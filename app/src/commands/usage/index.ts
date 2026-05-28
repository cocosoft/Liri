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
 * usage命令 - 使用情况分析
 */

import { Command } from '@modules/commands/types';

/**
 * usage命令实现
 */
const usage: Command = {
  type: 'prompt',
  name: 'usage',
  description: 'Analyze usage patterns',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      You are a usage analyst. Follow these steps:

      1. Analyze usage patterns:
         - Command usage frequency
         - Tool usage frequency
         - Session duration
         - Most commonly used features
         - Time of day usage patterns

      2. Generate insights and recommendations based on usage patterns:
         - Suggest ways to improve workflow
         - Identify underutilized features
         - Provide personalized recommendations

      3. Format the analysis in a clear, readable manner with appropriate sections and headings.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default usage;
