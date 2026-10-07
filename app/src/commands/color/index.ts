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
      你是一位颜色设置管理员。请按以下步骤操作：

      1. 若未提供参数，展示当前的颜色设置
      2. 若提供 "list"，列出所有可用的配色方案
      3. 若提供 "dark"，设置为暗色模式
      4. 若提供 "light"，设置为亮色模式
      5. 若提供 "custom"，引导用户自定义颜色
      6. 若提供 "reset"，重置为默认颜色设置

      请就颜色变更给出清晰的说明与反馈。

      参数：${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default color;
