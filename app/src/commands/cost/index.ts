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
 * cost命令 - 成本分析
 */

import { Command } from '@modules/commands';

/**
 * cost命令实现
 */
const cost: Command = {
  type: 'prompt',
  name: 'cost',
  description: 'Analyze costs',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      你是一位成本分析师。请按以下步骤操作：

      1. 分析成本：
         - API 用量成本
         - 云服务成本（若适用）
         - 算力资源成本
         - 存储成本
         - 网络成本

      2. 生成成本构成与趋势：
         - 日 / 周 / 月度成本
         - 各功能或服务的成本
         - 成本优化机会

      3. 给出成本优化建议：
         - 降低成本的途径
         - 性价比更高的替代方案
         - 成本管理最佳实践

      4. 用清晰易读的方式组织分析，配以恰当的分节与标题。

      参数：${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default cost;
