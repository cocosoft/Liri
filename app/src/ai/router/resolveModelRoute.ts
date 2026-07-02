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

/** 延迟获取 ModelRouter 实例，避免循环依赖（resolveModelRoute → modelRouter → @modules/ai → BaseAIProvider → resolveModelRoute） */
async function getModelRouter() {
  const { ModelRouter } = await import('../modelRouter.js');
  return ModelRouter.getInstance();
}

/**
 * 解析指定 route 对应的模型名
 *
 * 优先通过 SmartRouter 动态路由，不可用时回退 ModelRouter 静态路由。
 *
 * @param route - 路由键
 * @param options - 可选：message（chat 类需要）、sessionId
 * @returns 模型名
 */
export async function resolveModelRoute(
  route: RouteKeyType,
  options?: { message?: string; sessionId?: string }
): Promise<string> {
  try {
    const { getCoreAPI } = await import('@modules/runtime/api/CoreAPIImpl.js');
    const coreAPI = getCoreAPI();
    const smartRouter = coreAPI.getSmartRouter();

    if (smartRouter) {
      const decision = await smartRouter.resolve(route, {
        message: options?.message,
        sessionId: options?.sessionId,
      });
      return decision.model;
    }
  } catch {
    // SmartRouter 不可用时静默回退到 ModelRouter
  }

  const mr = await getModelRouter();
  return mr.resolve(ROUTE_TO_TASK[route]);
}

export { RouteKey };
export type { RouteKey as RouteKeyType };
