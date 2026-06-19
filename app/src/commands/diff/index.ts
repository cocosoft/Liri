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
      You are a Git diff viewer. Follow these steps:

      1. If no arguments are provided, run git diff to show changes in the working directory
      2. If a file path is provided, run git diff <file> to show changes in that file
      3. If "--staged" or "--cached" is provided, run git diff --staged to show changes in the staging area
      4. If two branch names or commit hashes are provided, run git diff <commit1> <commit2> to show differences between them

      Provide the output of the Git commands and explain what you did.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default diff;
