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
 * 统一循环工厂（阶段 2，2026-09-01）
 *
 * 流式/非流式循环的统一创建入口（收敛目标：调用点不再直接 new 具体子类）：
 * - mode='stream' → ReActToolLoop（流式主路径：streamMessageFlow）
 * - mode='batch'  → TAORLoop（非流式委托：sendMessage / PDCA 步骤 / PlanDrivenLoop）
 *
 * 说明：两个循环的构造参数正交（stream 需 ToolLoopContext+ToolLoopInput，
 * batch 需 QueryEngine+TAORLoopConfig），故用 discriminated union 分发。
 * 当前为"统一入口"层；真正合并为同一条代码路径（outputMode 单类实现）
 * 属后续深化（需双跑对照验证），本工厂是未来合并的单一开关点。
 */
import { ReActToolLoop } from './ReActToolLoop.js';
import { createTAORLoop } from '@modules/query';
import type { TAORLoop } from '@modules/query';
import type { ReActLoop, ReActLoopConfig } from '@modules/query';
import type { QueryEngine } from '@modules/query';
import type { TAORLoopConfig } from '@modules/query';
import type { ToolLoopContext, ToolLoopInput } from './ToolLoopRunner.js';

/** 统一循环工厂参数（discriminated union：按 mode 区分构造所需依赖） */
export type ChatAgentLoopOptions =
  | {
      mode: 'stream';
      ctx: ToolLoopContext;
      input: ToolLoopInput;
      config?: Partial<ReActLoopConfig>;
    }
  | { mode: 'batch'; queryEngine: QueryEngine; config: TAORLoopConfig };

export function createChatAgentLoop(options: {
  mode: 'stream';
  ctx: ToolLoopContext;
  input: ToolLoopInput;
  config?: Partial<ReActLoopConfig>;
}): ReActToolLoop;
export function createChatAgentLoop(options: {
  mode: 'batch';
  queryEngine: QueryEngine;
  config: TAORLoopConfig;
}): TAORLoop;
export function createChatAgentLoop(options: ChatAgentLoopOptions): ReActLoop {
  if (options.mode === 'stream') {
    return new ReActToolLoop(options.ctx, options.input, options.config);
  }
  return createTAORLoop(options.queryEngine, options.config);
}
