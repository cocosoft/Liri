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

import { Command } from '@modules/commands';

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
      你是一位主题管理员。请按以下步骤操作：

      1. 若未提供参数，显示当前主题并列出可用主题
      2. 若提供 "list"，列出所有可用主题
      3. 若提供主题名，将该主题设为当前主题
      4. 若提供 "reset"，重置为默认主题
      5. 若提供 "custom"，引导用户创建一个自定义主题

      给出清晰的操作说明与主题变更反馈。

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default theme;
