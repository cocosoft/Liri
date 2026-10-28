/**
 * LLM 跟踪器单例
 * 提供全局访问入口
 */

import { LLMTracker } from './LLMTracker.js';
import { resolveTenantDbPath } from '@modules/environment';
// 租户级 DB（基础设施专项 §6.1 期 3）：库按**租户**分，用户靠 `owner_key` 行级隔离
import {
  getRequestPrincipal,
  isLocalPrincipal,
  principalKeyOf,
} from '@openliri/kernel/identity/requestScope.js';
import { registerScopedResource } from '@openliri/kernel/identity/scopedResources.js';

/**
 * 全局 LLM 跟踪器实例（**本地身份 / 无请求作用域**使用）
 */
export const llmTracker = new LLMTracker();

/** 租户级库实例缓存（键 = `tenantId`；库按租户分，用户靠 `owner_key` 行级隔离） */
const scopedTrackers = new Map<string, LLMTracker>();

/**
 * 获取 LLM 跟踪器实例。
 *
 * 租户级 DB：本地身份 ⇒ 原全局实例（零变更）；已认证身份 ⇒ 该**租户**的实例
 * （`tenants/<t>/app.db`），同租户内不同用户共用连接、按 `owner_key` 行级隔离；
 * 创建时**同步**开库建表（`recordLLMCall` 是同步热路径，异步初始化会让首批记录丢失）。
 */
export function getLLMTracker(): LLMTracker {
  const principal = getRequestPrincipal();
  if (!isLocalPrincipal(principal)) {
    const key = principal.tenantId;
    const existing = scopedTrackers.get(key);
    if (existing) return existing;
    const scoped = new LLMTracker();
    scoped.openScopedSync(resolveTenantDbPath(principal));
    scopedTrackers.set(key, scoped);
    // 多租户 P5：登记 closer（关连接 + 摘除本模块缓存），删租户时统一释放文件句柄。
    // 登记键用**创建者**的 `<tenant>:<user>`（purge 按 `<tenant>:` 前缀关闭）。
    registerScopedResource(principalKeyOf(principal), () => {
      scoped.close();
      scopedTrackers.delete(key);
    });
    return scoped;
  }
  return llmTracker;
}

/** 仅测试：关掉并清空租户级实例缓存（**仅供测试**；生产不调用） */
export function resetLLMTrackerForTest(): void {
  for (const tracker of scopedTrackers.values()) tracker.close();
  scopedTrackers.clear();
}
