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
 * resolveModelRoute — 统一模型路由解析辅助函数
 *
 * 为所有模型消费点提供单一入口，内部优先走 SmartRouter，
 * SmartRouter 不可用时回退到 ModelRouter 静态路由。
 *
 * 用法：
 *   import { resolveModelRoute, RouteKey } from './resolveModelRoute';
 *   const model = await resolveModelRoute(RouteKey.CHAT);
 */

import { RouteKey, ROUTE_TO_TASK } from './routes.js';
import type { RouteKey as RouteKeyType } from './routes.js';

import { handleError } from '@modules/error/handleError.js';

/** 延迟获取 ModelRouter 实例，避免循环依赖（resolveModelRoute → modelRouter → @modules/ai → BaseAIProvider → resolveModelRoute） */
async function getModelRouter() {
  const { ModelRouter } = await import('../modelRouter.js');
  return ModelRouter.getInstance();
}

/**
 * 纯函数：仅在"**用户显式设置过**"的任务类型上采用分工表里的模型。
 *
 * 抽出为纯函数以便回归测试直接断言优先级规则（O46 v2 三条断言）。
 *
 * @param taskType 任务类型（由 RouteKey 映射而来）
 * @param explicitKeys 用户显式保存过的任务类型集合（来源标记）
 * @param tasks 分工表（可能含系统自动填充的条目）
 * @returns 可采用的模型 id；不满足条件返回 undefined（调用方继续走 SmartRouter）
 */
export function pickExplicitTaskModel(
  taskType: string,
  explicitKeys: readonly string[],
  tasks: Record<string, string | undefined>
): string | undefined {
  if (!explicitKeys.includes(taskType)) return undefined;
  const model = tasks[taskType];
  return typeof model === 'string' && model.length > 0 ? model : undefined;
}

/**
 * 解析指定 route 对应的模型名
 *
 * 优先级：**用户显式分工**（仅用户显式保存过的 key）→ SmartRouter 动态路由 → ModelRouter 静态兜底。
 *
 * @param route - 路由键
 * @param options - 可选：message（chat 类需要）、sessionId
 * @returns 模型名
 */
export async function resolveModelRoute(
  route: RouteKeyType,
  options?: { message?: string; sessionId?: string }
): Promise<string> {
  const taskType = ROUTE_TO_TASK[route];

  // O46 修复（2026-09-13，v2）：**用户显式分工优先于智能路由**，但**仅限用户显式设置过的 key**。
  // v1 只看"分工表里有条目"，而 `runAutoDiscover()` 会自动填充 9 个 chat 类任务
  // （default/chat/coding/agent/…）→ 会把系统自动填充误判为用户意图、令智能路由被静默大面积绕过。
  // 现按来源标记（`models.taskOverrides`，由用户保存入口写）判定；未显式设置则交 SmartRouter。
  try {
    const router = await getModelRouter();
    const explicitKeys = await router.getExplicitTaskKeys();
    const picked = pickExplicitTaskModel(
      taskType,
      explicitKeys,
      // TaskModelConfig 无索引签名，纯函数按 Record 读取即可（只按键取值）
      router.getTasks() as unknown as Record<string, string | undefined>
    );
    if (picked) {
      return picked;
    }
  } catch (err) {
    // 读取用户分工失败不应阻断路由：记录后继续走智能路由
    handleError(err, { module: 'ai:router', action: 'explicitTaskRoute' });
  }

  try {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    const coreAPI = getCoreAPI();
    const smartRouter = coreAPI.getSmartRouter();

    if (smartRouter) {
      const decision = await smartRouter.resolve(route, {
        message: options?.message,
        sessionId: options?.sessionId,
      });
      // SmartRouter 返回有效模型 → 直接使用；返回空 → fall through 到 modelRouter
      if (decision.model) {
        return decision.model;
      }
    }
  } catch (err) {
    // SmartRouter 不可用时静默回退到 ModelRouter
    handleError(err, { module: 'ai:router', action: 'smartRouter.resolve' });
  }

  const mr = await getModelRouter();
  return mr.resolveAsync(taskType);
}

export { RouteKey };
export type { RouteKey as RouteKeyType };
