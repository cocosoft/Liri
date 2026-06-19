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
      You are a Git tag manager. Follow these steps:

      1. If no arguments are provided, run git tag to show all tags
      2. If "-l" or "--list" is provided followed by a pattern, run git tag -l <pattern> to list tags matching the pattern
      3. If a tag name is provided, run git tag <tag> to create a lightweight tag
      4. If "-a" is provided followed by a tag name, run git tag -a <tag> -m "tag message" to create an annotated tag
      5. If "-d" is provided followed by a tag name, run git tag -d <tag> to delete a tag
      6. If "-p" or "--pretty" is provided followed by a tag name, run git show <tag> to show tag details

      Provide the output of the Git commands and explain what you did.

      Arguments: ${args}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default tag;
