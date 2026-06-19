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
 * Subagent 命令模块入口
 * 管理多个 Agent 定义，支持从不同源加载 .md 配置文件
 */
import type { Command } from '@modules/commands';

const subagentCommand: Command = {
  type: 'local',
  name: 'subagent',
  description: '管理多个 Agent 实例，支持从不同源加载',
  aliases: ['agent', 'agents'],
  argumentHint: '[list|info|create|delete|--json|help]',
  whenToUse: '当你需要管理多个 Agent 实例时',
  load: () => import('./Subagent.js').then((m) => m.default),
};

// 保留 agentCommand 别名导出以兼容旧引用
export { subagentCommand };
export { subagentCommand as agentCommand };
export default subagentCommand;
