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
import { getRequestPrincipal } from '@modules/core/identity/requestScope.js';
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
 * - 成功 ⇒ **200** + 清除报告（`removed` / `blocked` / `notPurged` 如实返回）。
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
    await recordPurgeAudit(report);
    json(res, 200, report);
  } catch (error) {
    sendError(res, error);
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
async function recordPurgeAudit(report: TenantPurgeReport): Promise<void> {
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
      },
      success: report.blocked.length === 0,
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
