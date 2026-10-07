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
 * tag命令 - Git标签管理
 */

import { Command } from '@modules/commands';

/**
 * tag命令实现
 */
const tag: Command = {
  type: 'prompt',
  name: 'tag',
  description: 'Manage Git tags',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      你是一位 Git 标签管理员。请按以下步骤操作：

      1. 若未提供参数，运行 git tag 显示所有标签
      2. 若提供 "-l" 或 "--list" 后跟模式，运行 git tag -l <pattern> 列出匹配该模式的标签
      3. 若提供标签名，运行 git tag <tag> 创建一个轻量标签
      4. 若提供 "-a" 后跟标签名，运行 git tag -a <tag> -m "tag message" 创建一个附注标签
      5. 若提供 "-d" 后跟标签名，运行 git tag -d <tag> 删除一个标签
      6. 若提供 "-p" 或 "--pretty" 后跟标签名，运行 git show <tag> 显示标签详情

      给出 Git 命令的输出，并说明你做了什么。

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default tag;
