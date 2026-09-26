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
 * 路径屏蔽的**执行守卫**（A7 防泄题）—— 两处执行收口共用同一份判定与文案。
 *
 * **为什么需要"两处"（2026-09-26 实测更正）**：本项目有**两条**互不调用的工具执行收口，
 * 早先我以为只有一条（错误，已更正）：
 * 1. **Agent 路径**：`ChatManager → ToolExecutionService → ToolRegistry.executeTool`
 *    —— 评测中被测 Agent 走的正是这条（`chat/services/ToolExecutionService.ts`）；
 * 2. **HTTP/CoreAPI 路径**：`POST /v1/tools/:name/execute → CoreAPIImpl.executeTool →
 *    ToolManager.executeTool → optimizedExecuteTool` —— 不经过 `ToolRegistry.executeTool`。
 *
 * 只挡其中一条就等于"换个入口即可读答案"。故判定与拒绝文案**收在本题**，两处各调一次
 * （`guardShieldedToolCall`）—— 逻辑与文案只有一份，不会各自漂移。
 *
 * 判据本体（清单解析 / 比较针展开 / 命中判定）见 `pathShield.ts`；**能力边界亦见那里**
 * （不是通用沙箱：不挡变量/通配拼路径、symlink、祖先目录批量读）。
 */
import { getLogger } from '@modules/monitoring';
import {
  ENV_SHIELDED_PATHS,
  findShieldedHit,
  loadShieldPlan,
} from './pathShield';
import {
  ErrorLevel,
  ToolExecutionStatus,
  createToolResult,
  type ToolResult,
} from './types/ToolResult';

const logger = getLogger('tools:shieldGuard');

/**
 * 命中被屏蔽路径 ⇒ 返回**拒绝结果**（调用方直接将其作为工具结果返回，**不得再执行工具**）；
 * 未命中 ⇒ `null`（调用方继续正常执行）。
 */
export function guardShieldedToolCall(
  toolName: string,
  input: unknown
): ToolResult | null {
  const plan = loadShieldPlan();
  if (plan.needles.length === 0) return null; // 未启用屏蔽 ⇒ 零行为

  const hit = findShieldedHit(input, plan);
  if (!hit) return null;

  logger.warn('工具调用被拒绝：参数引用被屏蔽路径（评测防泄题）', {
    toolName,
    shieldedPath: hit,
  });
  const reason = `该调用被拒绝：参数引用了被屏蔽路径 ${hit}（本进程已启用路径屏蔽 ${ENV_SHIELDED_PATHS}）`;
  return createToolResult(null, {
    success: false,
    status: ToolExecutionStatus.FAILURE,
    error: reason,
    errorLevel: ErrorLevel.FATAL,
    newMessages: [{ role: 'system', content: `Error: ${reason}` }],
  });
}
