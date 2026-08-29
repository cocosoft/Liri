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
 * PermissionInterceptor — 权限读时拦截能力层（T3.1）
 *
 * 对齐论文 §6.3：在 DependencyRegistry 的 key 解析路径上挂 intercept 元数据，
 * 工具调用/通道发送/模型请求从运行上下文读取拦截元数据。
 *
 * 能力层先行：不替换现有 permission/ 检查器（保持兼容），
 * 仅提供 set/check/intercept 三能力供各领域消费方接入。
 *
 * 错误归一化：拦截层拒绝复用 PermissionResult.createDenyDecision
 * （behavior: DENY + message），与既有检查器拒绝结构完全一致，
 * 避免"两个拒绝入口、两套错误信息"。
 */

import { dependencyRegistry, DepRegistry } from '@modules/context';
import { createDenyDecision } from '../PermissionResult.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('permission:intercept');

export interface InterceptMeta {
  /** 存在即拒绝（读时拦截触发条件） */
  denyReason?: string;
  /** 附加提示文案 */
  hint?: string;
}

/** 拦截元数据注册 key 命名空间 */
const INTERCEPT_KEY = (key: string) => `perm:intercept:${key}`;

export class PermissionInterceptor {
  private reg: DepRegistry;

  constructor(reg: DepRegistry = dependencyRegistry) {
    this.reg = reg;
  }

  /** 注册/更新某资源的拦截元数据（经 DependencyRegistry 发布） */
  set(key: string, meta: InterceptMeta): void {
    this.reg.provide(INTERCEPT_KEY(key), meta);
    logger.debug('拦截元数据已设置', { key, denyReason: meta.denyReason });
  }

  /** 读取某资源的拦截元数据（读时拦截路径） */
  check(key: string): InterceptMeta | undefined {
    return this.reg.inject<InterceptMeta>(INTERCEPT_KEY(key));
  }

  /**
   * 读时拦截判定：meta 含 denyReason → 返回统一 deny 决策；否则 undefined。
   * 决策结构与既有检查器 createDenyDecision 完全一致（错误归一化）。
   */
  intercept(key: string) {
    const meta = this.check(key);
    if (meta?.denyReason) {
      // 安全审计：拒绝事件必须可追溯（资源 + 原因）
      logger.warning('权限读时拦截拒绝', {
        key,
        denyReason: meta.denyReason,
        hint: meta.hint,
      });
      return createDenyDecision(`操作被权限拦截：${meta.denyReason}`, {
        type: 'config',
        source: 'permission:intercept',
      });
    }
    return undefined;
  }

  /** 移除拦截元数据（经 DependencyRegistry withdraw） */
  clear(key: string): void {
    this.reg.withdraw(INTERCEPT_KEY(key));
    logger.debug('拦截元数据已移除', { key });
  }
}

/** 全局单例 */
export const permissionInterceptor = new PermissionInterceptor();
