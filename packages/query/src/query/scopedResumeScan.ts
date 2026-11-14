/**
 * scopedResumeScan — 启动期**按身份**跑一次恢复扫描的作用域编排（多租户 P5）
 *
 * 为什么需要单独一层：
 *   - `resumeManager` 是模块级单例，其存储按"当前请求身份"惰性解析（第二十二批）；
 *     启动期**没有任何请求作用域** ⇒ 只能由调用方显式重建身份作用域，否则恒落宿主库。
 *   - "用哪些身份扫"（租户清单来自 auth 用户表）属于**启动编排**，不属于 ResumeManager。
 *
 * 为什么用**临时**存储而不是全局 `resumeManager`：后者会把每个身份的存储缓存在 Map 里
 * ⇒ 启动期扫 N 个用户就常驻 N 个 sqlite 句柄。这里扫完即关（`finally`），句柄不累积。
 *
 * 副作用边界：本模块只负责"身份作用域 + 存储生命周期"，扫描/恢复语义仍全在 ResumeManager。
 */
import type { Principal } from '@openliri/kernel/identity/principal.js';
import { runWithPrincipal } from '@openliri/kernel/identity/requestScope.js';
import { DBTAORCheckpointStorage } from './DBTAORCheckpointStorage.js';
import { ResumeManager } from './ResumeManager.js';

/** 可恢复的身份（到"人"这一级：存储路径是 `tenants/<t>/users/<u>/`） */
export interface ResumableIdentity {
  tenantId: string;
  userId: string;
}

/**
 * 在 `identity` 的请求作用域内执行 `fn`，并为其提供**临时**的恢复管理器。
 *
 * @param fn 收到一个绑定到该身份分区 `app.db` 的 `ResumeManager`；其存储在本函数返回前关闭
 */
export async function withScopedResumeManager(
  identity: ResumableIdentity,
  fn: (manager: ResumeManager) => Promise<void>
): Promise<void> {
  // 角色留空：启动期扫描不属于任何登录会话，权限判定回退进程级角色（与 principalFromKey 同口径）
  const principal: Principal = {
    tenantId: identity.tenantId,
    userId: identity.userId,
    roles: [],
  };

  await runWithPrincipal(principal, async () => {
    // 必须在作用域内构造：`DBTAORCheckpointStorage` 的缺省路径按当前身份解析
    const storage = new DBTAORCheckpointStorage();
    try {
      await fn(new ResumeManager(storage));
    } finally {
      storage.close();
    }
  });
}
