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
 * btw命令 - 旁注功能
 */

import { Command } from '@modules/commands';

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
      你正在添加一条侧注（btw）。它是额外的上下文或信息，不属于主对话的一部分。

      指导原则：
      - 保持侧注与当前对话相关
      - 提供额外的上下文或背景信息
      - 避免把主对话带偏
      - 侧注要简明但有信息量

      侧注：${args || '未提供侧注内容'}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default btw;
