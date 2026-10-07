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
 * plan命令 - 计划生成
 */

import { Command } from '@modules/commands';

/**
 * plan命令实现
 */
const plan: Command = {
  type: 'prompt',
  name: 'plan',
  description: 'Generate a plan for a task or project',
  loadedFrom: 'builtin',
  async getPromptForCommand(
    args: string
  ): Promise<Array<{ type: 'text'; text: string }>> {
    const prompt = `
      你是一位规划师。请针对用户描述的任务或项目生成一份详细的计划。

      指导原则：
      - 将任务拆解为可管理的步骤
      - 包含时间安排与依赖关系
      - 识别潜在挑战与应对方案
      - 提供清晰、可执行的步骤
      - 用分节和项目符号组织计划

      任务或项目：${args || '未提供具体任务或项目'}
    `;

    return [{ type: 'text', text: prompt }];
  },
};

export default plan;
