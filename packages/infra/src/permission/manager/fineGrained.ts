/**
 * 细粒度 RBAC（D 体系）规则判定（P1 拆分，2026-11-12）
 *
 * 从 `PermissionManager.checkFineGrainedRules` 原样搬出：角色 / 用户 / 资源三类绑定
 * 同权收集，按 deny > ask > allow 三档返回；判定顺序、文案与 fail-closed 语义
 * **逐字不变**。差异只有一处 —— 拒绝跟踪器改为经 `FineGrainedDeps` 显式传入。
 */
import { handleError } from '@openliri/infra/error';

import { getFineGrainedPermissionManager } from '../FineGrainedPermissionManager';
import {
  describeFineGrainedDenySubject,
  type FineGrainedDenySource,
} from '../denyAttribution';
import {
  OperationType,
  PermissionAction,
  RoleType,
  type PermissionRule as FineGrainedRule,
} from '../Permission';
import type { DenialTracker } from '../trackers/DenialTracker';
import {
  createAllowDecision,
  createAskDecision,
  createDenyDecision,
  PermissionDecision,
} from '../types/PermissionDecision';
import { recordFineGrainedDeny } from './decisionTelemetry';

/** 细粒度判定可见的实例状态（拆分前是 `this.denialTracker`） */
export interface FineGrainedDeps {
  denialTracker: DenialTracker;
}

/**
 * E↔A 打通：查询 D 体系（FineGrained）中**本次请求生效主体**的规则
 *
 * 三类绑定同权（2026-11-11 补齐 user / resource，并接入 allow / ask）：
 * - **角色**：`roleObj.permissions` + `rules.json` 里 `roleId = roleObj.id` 的规则；
 * - **用户**：`rules.json` 里 `userId = context.userId` 的规则；
 * - **资源**：`rules.json` 里 `resourceId = toolName` 且未绑定角色/用户的规则
 *   （工具类资源以工具名为标识）。
 *
 * 返回**一次读取**得到的决策三档（deny > ask > allow）：
 * - `deny` 由调用方在**所有 ask/allow 之前**返回（安全排序：deny 永远优先）；
 * - `ask` 在工具级 ask 规则之后、allow 规则之前返回（ask 不越过 allow）；
 * - `allow` 在所有 ask 与显式 allow 规则之后返回（安全兜底：ask 仍优先于 allow）。
 *
 * 只认 `operation ∈ {all, execute}`：工具调用以 execute 参与判定。
 *
 * 多租户 P0：角色/用户由**调用方显式传入**（`context.userRoles` / `context.userRole` /
 * `context.userId`），方法内不读任何进程级字段 ⇒ 并发请求各自判定、互不覆盖（2026-11-03 收敛）。
 * 本地身份由调用方经 `getEffectivePermissionRole()` 映射为 `admin`（2026-11-11 裁定）。
 * 存储走进程内单例（P2-4）；deny 指标按**真实命中主体**归因（P2-5，见 `denyAttribution`）。
 * 角色按**并集**参与（P2-6）：每个角色的 `roleObj.permissions` + `rules.json` 绑定都收集。
 */
export async function checkFineGrainedRules(
  deps: FineGrainedDeps,
  toolName: string,
  userId: string | undefined,
  effectiveRoles: string[],
  sessionId?: string
): Promise<{
  deny?: PermissionDecision;
  ask?: PermissionDecision;
  allow?: PermissionDecision;
}> {
  try {
    // P2-4（2026-11-11）：走**进程内单例**。存储的 mtime 读缓存是实例字段，
    // 每次判定都新建管理器会让缓存永不命中（且构造函数固定 4 次 existsSync + 一条 INFO）。
    const storage = getFineGrainedPermissionManager().getStorage();
    // 规则与**来源**一起采集：归因要按真实绑定的那一路打标（P2-5），事后猜不准。
    const collected: Array<{
      rule: FineGrainedRule;
      source: FineGrainedDenySource;
    }> = [];

    for (const roleName of effectiveRoles) {
      const roleObj = await storage.getRoleByName(roleName as RoleType);
      if (!roleObj) continue;
      for (const rule of roleObj.permissions) {
        collected.push({ rule, source: 'role' });
      }
      for (const rule of await storage.getRulesByRole(roleObj.id)) {
        collected.push({ rule, source: 'role' });
      }
    }

    if (userId) {
      for (const rule of await storage.getRulesByUser(userId)) {
        collected.push({ rule, source: 'user' });
      }
    }

    // 资源规则：同一份 `rules.json` 里，角色/用户绑定的规则也用 resourceId = 工具名，
    // 必须排除它们，否则“给 guest 绑定”会通过资源通道命中所有人（多租户串权）。
    const resourceRules = (await storage.getRulesByResource(toolName)).filter(
      (rule) => !rule.roleId && !rule.userId
    );
    for (const rule of resourceRules) {
      collected.push({ rule, source: 'resource' });
    }

    const pickRule = (
      action: PermissionAction
    ): (typeof collected)[number] | undefined =>
      collected
        .filter(
          ({ rule }) =>
            rule.action === action &&
            (rule.operation === OperationType.ALL ||
              rule.operation === OperationType.EXECUTE) &&
            rule.resourceId === toolName
        )
        // 与 D 体系一致：priority 数值越小优先级越高
        .sort((a, b) => a.rule.priority - b.rule.priority)[0];

    const denyHit = pickRule(PermissionAction.DENY);
    if (denyHit) {
      deps.denialTracker.trackDenial(toolName, sessionId);
      recordFineGrainedDeny(
        toolName,
        describeFineGrainedDenySubject(
          denyHit.rule,
          denyHit.source,
          effectiveRoles[0]
        )
      );
      return {
        deny: createDenyDecision(
          `Denied by fine-grained rule: ${denyHit.rule.id}`
        ),
      };
    }

    const askHit = pickRule(PermissionAction.ASK);
    const allowHit = pickRule(PermissionAction.ALLOW);
    return {
      ...(askHit
        ? {
            ask: createAskDecision(
              `Asked by fine-grained rule: ${askHit.rule.id}`
            ),
          }
        : {}),
      ...(allowHit
        ? {
            allow: createAllowDecision(
              `Allowed by fine-grained rule: ${allowHit.rule.id}`
            ),
          }
        : {}),
    };
  } catch (error) {
    // P1-3（2026-11-11）：**fail-closed**。规则文件不可读 / 解析失败时，无法证明
    // “没有任何 deny 绑定”；继续按 A 规则放行等于让 RBAC deny 静默失效
    // （安全域不接受「读不到就当没配」）。
    //
    // 代价与取证：`FilePermissionStorage` 的写是 read-modify-write（无跨实例锁），
    // 并发写窗口内可能出现瞬时解析失败 ⇒ 此时工具会被拒一次，恢复写入后自动恢复；
    // 若长期被拒，按提示检查 `permissions/*.json` 是否为合法 JSON。
    void handleError(error, {
      module: 'permission:manager',
      action: 'check_fine_grained_rules',
    });
    return {
      deny: createDenyDecision(
        'Denied: fine-grained RBAC rules unavailable ' +
          '(permissions/*.json unreadable). Fix the JSON files to re-enable tools.'
      ),
    };
  }
}
