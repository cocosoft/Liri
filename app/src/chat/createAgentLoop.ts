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
import {
  TokenBudgetController,
  TokenBudgetStatus,
  getDefaultTokenBudget,
} from '@modules/core/tokenBudget/TokenBudgetController.js';
import type { BudgetControllerLike } from '@modules/query';

/** L1（2026-09-06）：流式循环预算记账接口——骨架 BudgetControllerLike 的流式扩展。
 *  由 ReActToolLoop 每轮 LLM 响应后调用 chargeContextEstimate（ReActLoop 骨架仅消费
 *  canExecute/needsGraceCall，charge 为 ReActToolLoop 私有契约，运行时结构匹配）。 */
export interface StreamBudgetLike extends BudgetControllerLike {
  chargeContextEstimate(estimatedTokens: number): void;
}

/**
 * L1（2026-09-06）：构造流式预算（复用 TAORLoop 的 TokenBudget 语义）——
 * total = 模型上下文窗口；按当前上下文估算增量扣减（delta，compact 回落后只降基线不退款）；
 * canExecute = 预算未 EXCEEDED；needsGraceCall = 每 run 仅一次优雅最终轮（对齐 dailyBudget 语义）。
 * 无 model 时不臆造预算（CS03），返回 undefined → 骨架 budget 分支不生效（维持现状）。
 */
export function createStreamBudget(
  model: string | undefined
): StreamBudgetLike | undefined {
  if (!model) return undefined;
  const def = getDefaultTokenBudget(model);
  const controller = new TokenBudgetController(
    model,
    {
      total: def.total,
      remaining: def.remaining,
      maxOutputTokens: def.maxOutputTokens,
    },
    def.total
  );
  let lastEstimate = 0;
  let graceGranted = false;
  return {
    canExecute: () => controller.checkBudget() !== TokenBudgetStatus.EXCEEDED,
    needsGraceCall: () => {
      if (graceGranted) return false;
      graceGranted = true;
      return true;
    },
    chargeContextEstimate(estimatedTokens: number) {
      // delta 语义对齐 TAORLoop observe（L1347-1352）：只按增量扣减，compact 回落不退款
      if (estimatedTokens > lastEstimate) {
        controller.consumeTokens(estimatedTokens - lastEstimate);
      }
      lastEstimate = estimatedTokens;
    },
  };
}

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
    // L1（2026-09-06）：流式默认注入骨架预算——token 级硬停补齐 batch 对等保护。
    // 调用方显式传 config.budget 时优先（不覆盖显式配置）。
    const model = (options.ctx.options?.model as string | undefined) ?? '';
    const budget = createStreamBudget(model);
    const config = budget
      ? { ...options.config, budget: options.config?.budget ?? budget }
      : options.config;
    return new ReActToolLoop(options.ctx, options.input, config);
  }
  return createTAORLoop(options.queryEngine, options.config);
}
