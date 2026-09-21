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
 * N-46（2026-09-20，用户决策㈠）：**显式配置优先**的 route 集合。
 *
 * 这五类 route 在 `SmartRouter.resolve` 中走 Judge/档位解析（见其 `:247-276` 注释），
 * 因而「模型管理→任务分工」对它们的改动**原先不生效**（数出同源缺口）。现在：
 * 若用户在任务分工里**显式保存过**（`ai_app_model_configs.source === 'user'`），
 * 以任务分工为准；未显式配置的仍由 SmartRouter 档位决定。
 */
const EXPLICIT_CONFIG_PREFERRED_ROUTES: ReadonlySet<RouteKeyType> = new Set([
  RouteKey.CHAT,
  RouteKey.CODING,
  RouteKey.TRANSLATION,
  RouteKey.AGENT,
  RouteKey.SCHEDULED,
]);

/**
 * 解析指定 route 对应的模型名
 *
 * 优先级（N-46 后）：
 *   1. **用户显式配置**（仅 chat 类 route）——「任务分工」`source='user'` 时以其为准；
 *   2. SmartRouter 动态路由；
 *   3. ModelRouter 静态路由（任务分工兜底 / 旧格式）。
 *
 * @param route - 路由键
 * @param options - 可选：message（chat 类需要）、sessionId
 * @returns 模型名
 */
export async function resolveModelRoute(
  route: RouteKeyType,
  options?: { message?: string; sessionId?: string }
): Promise<string> {
  // 层 1（N-46）：用户显式配置优先 —— 仅 chat 类 route，且仅当该任务被**用户**保存过。
  // 未命中/解析不出模型名（UUID 未预载）时不返回 UUID，落到下方档位解析，避免下游
  // `getByModel(UUID)` 匹配失败（与 ModelRouter.resolve 的口径一致）。
  if (EXPLICIT_CONFIG_PREFERRED_ROUTES.has(route)) {
    try {
      const taskType = ROUTE_TO_TASK[route];
      const { appModelConfigService } =
        await import('../models/AppModelConfigService.js');
      await appModelConfigService.initialize();
      const cfg = await appModelConfigService.getConfig(taskType);
      if (cfg?.source === 'user' && cfg.model) {
        const mr = await getModelRouter();
        const configured = mr.resolve(taskType);
        if (configured) return configured;
      }
    } catch (err) {
      handleError(err, { module: 'ai:router', action: 'explicitTaskConfig' });
    }
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
  return mr.resolveAsync(ROUTE_TO_TASK[route]);
}

export { RouteKey };
export type { RouteKey as RouteKeyType };
