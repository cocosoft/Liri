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
 * diff命令 - 查看代码差异
 */

import { Command } from '@modules/commands';

/**
 * diff命令实现
 */
const diff: Command = {
  type: 'prompt',
  name: 'diff',
  description: 'View code differences',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      你是一个 Git diff 查看器。请按以下步骤操作：

      1. 若未提供参数，运行 git diff 展示工作区中的改动
      2. 若提供了文件路径，运行 git diff <file> 展示该文件的改动
      3. 若提供了 "--staged" 或 "--cached"，运行 git diff --staged 展示暂存区中的改动
      4. 若提供了两个分支名或 commit 哈希，运行 git diff <commit1> <commit2> 展示二者之间的差异

      请给出 Git 命令的输出，并说明你做了什么。

      参数：${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default diff;
