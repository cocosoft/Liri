/**
 * 定时任务的归属（多租户 P3 · 资源隔离）
 *
 * 为什么 cron 不像其他 store 那样 DB-per-tenant：调度器是**进程级单例**，
 * 一次 tick 必须看到所有作业才能统一调度（并发上限 3 / 超时 / 投递队列都是进程资源）。
 * 因此隔离落在 `cron_jobs.owner_key` 列（`<tenantId>:<userId>`），由三处共同守住：
 *   ① **创建**：写入当前请求身份（本地身份不写 ⇒ 桌面/CLI 行为零变更）；
 *   ② **读写**：已认证身份只能看到/改到自己的作业，越权按 404 处理（不泄露存在性）；
 *   ③ **执行**：调度器按 `owner_key` **重建身份作用域**后再跑作业 —— 工具 cwd（P3）、
 *      存储（P1）、事件投递（P2）才都会落到作业归属者名下。
 *
 * 无归属（`ownerKey` 缺失 / 无法解析）⇒ 视为本地作业：读写放行、执行不加作用域，
 * 与改造前完全一致。
 */
import {
  canAccessOwnerKey,
  currentOwnerKey,
  getRequestPrincipal,
  principalFromKey,
  runWithPrincipal,
} from '@openliri/kernel/identity/requestScope';
import type { Principal } from '@openliri/kernel/identity/principal';

/** 当前身份的任务归属键（本地身份 ⇒ `undefined` ⇒ 不写列、不做过滤） */
export function currentCronOwnerKey(
  principal: Principal = getRequestPrincipal()
): string | undefined {
  return currentOwnerKey(principal);
}

/**
 * 该身份能否读写这个作业。
 *
 * fail-closed：本地身份恒放行（单用户基线）；已认证身份必须 `ownerKey` **全等**，
 * 无归属的作业（历史数据 / 本地创建）一律拒绝 —— 远端身份不得操作本机任务。
 */
export function canAccessCronJob(
  job: { ownerKey?: string } | null | undefined,
  principal: Principal = getRequestPrincipal()
): boolean {
  if (!job) return false;
  return canAccessOwnerKey(job.ownerKey, principal);
}

/**
 * 在作业归属者的身份作用域内执行（无归属 ⇒ 原样执行，零变更）。
 *
 * 键由 `currentCronOwnerKey()` 写入（`<tenantId>:<userId>`），逆运算见
 * `core/identity/requestScope.ts#principalFromKey`（只此一处实现）。
 */
export function runInCronOwnerScope<T>(
  job: { ownerKey?: string },
  fn: () => T
): T {
  const principal = principalFromKey(job.ownerKey);
  return principal ? runWithPrincipal(principal, fn) : fn();
}
