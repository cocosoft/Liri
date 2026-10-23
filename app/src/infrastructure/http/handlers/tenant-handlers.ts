/**
 * tenant-handlers.ts — 租户管理 HTTP 入口（多租户 P5 收尾）
 *
 * `DELETE /v1/tenants/:tenantId` ⇒ 全量清除该租户可定位的数据
 * （见 `runtime/tenantPurge.ts`：先断流 → 清共享库归属行 → 删分区目录）。
 *
 * 鉴权口径与 `/v1/skills`、`/v1/apikeys` 一致：**admin 写操作**
 * （无 `Authorization` 头的本地回环按基线放行；见 `route-table.ts` 的统一拦截）。
 *
 * 为什么 handler 只做三件事（校验 / 调清除 / 审计）：清除本身的顺序与安全约束
 * 全部下沉在 `purgeTenant`，此处不再复写任何删除逻辑（避免出现两套顺序）。
 */

import type http from 'http';

import { getLogger } from '@modules/monitoring';
import { getRequestPrincipal } from '@openliri/kernel/identity/requestScope.js';
import {
  purgeTenant,
  validatePurgeableTenantId,
  type TenantPurgeReport,
} from '@modules/runtime/tenantPurge.js';
import { json, sendError } from './handler-utils';

const logger = getLogger('http:tenants');

/** 清除执行器（可注入 ⇒ handler 的错误分支与审计可单测，不依赖真实文件系统） */
export type TenantPurger = (tenantId: string) => Promise<TenantPurgeReport>;

/**
 * 删除租户 `DELETE /v1/tenants/:tenantId`
 *
 * - `tenantId` 为空 / `local` ⇒ **400**（请求不合法，未触碰任何数据）；
 * - 清除过程失败 ⇒ **500**（`purgeTenant` 内部已把可重跑的失败记入 `report.blocked`，
 *   只有"连报告都出不来"的异常才会到这里）；
 * - 成功 ⇒ **200** + 清除报告（`removed` / `blocked` / `notPurged` 如实返回），
 *   并附带 `unboundUsers` / `revokedTokens`（见下方"账号解绑"）。
 *
 * **账号解绑（多租户 P3）**：租户被删后，仍钉在该租户上的账号会拿到"指向已删租户"
 * 的身份并**重建空分区** ⇒ 删除成功后把它们的归属解绑回本地租户、撤销其活动 token
 *（只改归属，**不删账号、不改密码**）。解绑失败**不推翻**已完成的数据清除，但会在
 * 响应里如实给出 `unboundError`（不谎报 0）。
 */
export async function handleDeleteTenant(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  rawTenantId: string,
  purger: TenantPurger = purgeTenant
): Promise<void> {
  const check = validatePurgeableTenantId(decodeTenantId(rawTenantId));
  if (!check.ok) {
    json(res, 400, { error: { message: check.message } });
    return;
  }

  try {
    const report = await purger(check.tenantId);
    const unbound = await unbindAccountsSafely(check.tenantId);
    await recordPurgeAudit(report, unbound);
    json(res, 200, {
      ...report,
      unboundUsers: unbound.unboundUsers,
      revokedTokens: unbound.revokedTokens,
      ...(unbound.unboundError ? { unboundError: unbound.unboundError } : {}),
    });
  } catch (error) {
    sendError(res, error);
  }
}

/** 账号解绑结果（失败时给出 `unboundError`，不静默吞掉） */
interface UnbindAccountsResult {
  unboundUsers: string[];
  revokedTokens: number;
  unboundError?: string;
}

/**
 * 解绑该租户下的账号（失败只留痕：数据清除已完成，不能因为解绑失败而谎报 500）
 *
 * 动态 import：与审计同口径，避免 handler 组合根在启动期静态依赖 auth 模块。
 */
async function unbindAccountsSafely(
  tenantId: string
): Promise<UnbindAccountsResult> {
  try {
    const { unbindTenantAccounts } = await import('./auth-handlers');
    return unbindTenantAccounts(tenantId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warning('删除租户后解绑账号失败', { tenantId, error: message });
    return { unboundUsers: [], revokedTokens: 0, unboundError: message };
  }
}

/** URL 片段解码（非法百分号编码 ⇒ 原样使用，交由校验判空/判 `local`） */
function decodeTenantId(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * 审计落盘：删除租户是**跨身份的系统级破坏操作**，必须留痕。
 *
 * 归属取**调用时身份**（`record` 内部按 `currentOwnerKey()` 写入）—— 本地/无鉴权
 * 回环调用 ⇒ 落 `data/logs/enterprise-audit`，与既有审计同口径。
 */
async function recordPurgeAudit(
  report: TenantPurgeReport,
  unbound: UnbindAccountsResult
): Promise<void> {
  try {
    const { EnterpriseAuditService, AuditEventType } =
      await import('../../../config/enterprise/audit/EnterpriseAuditService.js');
    await EnterpriseAuditService.getInstance().record({
      type: AuditEventType.USER_MANAGEMENT,
      severity: 'critical',
      actor: getRequestPrincipal().userId,
      action: 'tenant.purge',
      resource: report.tenantId,
      details: {
        ownerPrefix: report.ownerPrefix,
        removed: report.removed,
        blocked: report.blocked,
        notPurged: report.notPurged,
        // 账号归属变更属同一次管理动作的一部分，必须同一条留痕
        unboundUsers: unbound.unboundUsers,
        revokedTokens: unbound.revokedTokens,
        ...(unbound.unboundError ? { unboundError: unbound.unboundError } : {}),
      },
      success: report.blocked.length === 0 && !unbound.unboundError,
      ...(report.blocked.length > 0
        ? { failureReason: `存在 ${report.blocked.length} 项未完成（可重跑）` }
        : {}),
    });
  } catch (error) {
    // 审计失败不推翻已完成的数据清除（清除不可逆，回滚语义不成立）——但必须留下日志
    logger.warning('租户清除审计落盘失败', {
      tenantId: report.tenantId,
      error: String(error),
    });
  }
}
