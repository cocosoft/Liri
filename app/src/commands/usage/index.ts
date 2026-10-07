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

import { Command } from '@modules/commands';

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
      你是一位用量分析师。请按以下步骤操作：

      1. 分析用量模式：
         - 命令使用频率
         - 工具使用频率
         - 会话时长
         - 最常用的功能
         - 不同时段的用量模式

      2. 基于用量模式生成洞察与建议：
         - 提出改进工作流的方式
         - 识别未被充分利用的功能
         - 给出个性化的推荐

      3. 用清晰易读的方式组织分析结果，配以恰当的分节与标题。

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default usage;
