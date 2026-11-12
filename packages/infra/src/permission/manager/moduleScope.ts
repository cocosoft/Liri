/**
 * 权限管理器的**模块级共享面**（P1 拆分，2026-11-12）
 *
 * 从 `PermissionManager.ts` 原样搬出：日志去重状态、角色并集归一、拒绝文案/解除入口、
 * 进程默认档解析、三层模式优先级。**零逻辑改动**，供 `PermissionManager`、
 * `manager/modeHandlers`、`manager/decisionTelemetry` 共用。
 */
import { configManager } from '@openliri/infra/config';
import { getLogger } from '@openliri/infra/monitoring';

import {
  PERMISSION_MODES,
  PermissionMode,
  normalizePermissionMode,
} from '../PermissionMode';
import type { PermissionDenyInfo } from '../types/PermissionDecision';
import { PermissionRuleSource } from '../types/PermissionRule';

export const logger = getLogger('permission:manager');

/**
 * P0-3（2026-10-27，权限归一化）：三处"静默放行"的可观测去重状态。
 * - `defaultAllowWarnedTools`：`defaultBehavior=allow` 无规则命中（按工具去重，避免刷屏）
 * - `bypassObservabilityLogged`：`bypass` 模式无条件放行（进程内只记一次）
 */
export const defaultAllowWarnedTools = new Set<string>();
let bypassObservabilityLogged = false;

/**
 * P2-6（2026-11-11）：细粒度 RBAC 的角色集合（**并集**）。
 *
 * - 有 `userRoles` ⇒ 用它（去空白 / 去重 / 保序）；
 * - 否则回落到 `userRole` 单值（旧调用方 / CLI 行为不变）；
 * - 都没有 ⇒ 空数组 ⇒ 角色绑定不参与判定（不臆造角色）。
 *
 * 为什么不在 `getEffectivePermissionRole` 里做：`userRole` 仍是**主角色**，
 * 风险策略等单值消费方依赖它；只有 RBAC 需要并集。
 */
export function resolveFineGrainedRoles(
  userRoles: string[] | undefined,
  userRole: string | undefined
): string[] {
  const raw = userRoles?.length ? userRoles : userRole ? [userRole] : [];
  return Array.from(
    new Set(raw.map((role) => role.trim()).filter((role) => role.length > 0))
  );
}

/**
 * P3（2026-11-07，方案 §2.3-4）：会话权限档**自动放行**的「每会话每来源一次」提示。
 *
 * 为什么需要：放宽档（bypass / auto / dontAsk）不产生审批卡，若日志与审计不标注来源，
 * 事后无法区分「用户批准」与「档位自动放行」。按 (sessionId, source) 去重，避免长任务刷屏；
 * 条目上限 500 后整体清空（只影响提示频率，不影响判定）。
 */
const autoAllowedNoticeKeys = new Set<string>();

export function logAutoAllowedOnce(
  source: string,
  toolName: string,
  sessionId?: string
): void {
  const key = `${sessionId ?? '-'}::${source}`;
  if (autoAllowedNoticeKeys.has(key)) return;
  if (autoAllowedNoticeKeys.size > 500) autoAllowedNoticeKeys.clear();
  autoAllowedNoticeKeys.add(key);
  logger.info('permission:auto_allowed（会话权限档自动放行，非用户逐条批准）', {
    source,
    toolName,
    sessionId,
  });
}

/**
 * F-01（2026-10-28）：把 `decision.rule` 归一为**可读标签**。
 *
 * `PermissionDecision.rule` 声明为 `any`，实际常是规则**对象**；原实现 `String(rule)`
 * 直接得到 `"[object Object]"`，该串被写进审计 `matchedRules` ⇒ 安全仪表盘
 * 「越权拦截类别 Top」里出现一个叫 `[object Object]` 的类别（真机实测 211 次）。
 * 现按 id → ruleId → name → pattern → type 取第一个非空字符串，取不到则回落 `rule`。
 */
export function ruleLabel(rule: unknown): string {
  if (typeof rule === 'string') return rule;
  if (rule && typeof rule === 'object') {
    const r = rule as Record<string, unknown>;
    for (const key of ['id', 'ruleId', 'name', 'pattern', 'type'] as const) {
      const v = r[key];
      if (typeof v === 'string' && v.trim()) return v;
    }
    return 'rule';
  }
  return String(rule);
}

/**
 * LRO-07（2026-10-26）：规则拒绝时告诉调用方「这条规则怎么解除」。
 *
 * 为什么必须有：deny 文案此前只写来源（且来源还被伪造成 `userSettings`），既没给出
 * 「去哪删」也没给出「删哪条」⇒ 用户只能翻盘，模型只会重复同一个被拒调用
 * （真机实测：`file_write` 连续 6 次全被拒，元数据里连 ruleId 都没有）。
 *
 * 分档依据是**真实可删性**：`ruleStore`（`tool_rules.json`）可经面板 / API 删除；
 * settings 来源是配置文件维护的只读视图，只能改文件。
 */
export function resolveRuleRemovalHint(
  ruleId: string | undefined,
  source: string | undefined
): string {
  if (source === PermissionRuleSource.RULE_STORE) {
    return ruleId
      ? `在「设置 → 权限管理 → 工具权限规则」删除该规则，或 DELETE /v1/permissions/rules/${ruleId}`
      : '在「设置 → 权限管理 → 工具权限规则」删除对应规则';
  }
  if (source) {
    return `在设置文件的 permissions 段修改（来源 ${source} 由配置文件维护，面板不可删除）`;
  }
  return '在「设置 → 权限管理 → 工具权限规则」删除对应规则';
}

/**
 * LRO-07（2026-10-26）：把 deny 决策的 `context` 收敛成**跨层 DTO**。
 *
 * 只搬运真实存在且为字符串的字段（缺省不臆造）；没有任何可回传字段 ⇒ `undefined`
 * （避免给上层一个空对象冒充"有依据"）。
 */
export function buildDenyInfo(
  context: Record<string, unknown> | undefined
): PermissionDenyInfo | undefined {
  if (!context) return undefined;
  const info: PermissionDenyInfo = {};
  if (typeof context.ruleId === 'string') info.ruleId = context.ruleId;
  if (typeof context.sourceKind === 'string') {
    info.sourceKind = context.sourceKind;
  }
  if (typeof context.inputFingerprint === 'string') {
    info.inputFingerprint = context.inputFingerprint;
  }
  if (typeof context.removableVia === 'string') {
    info.removableVia = context.removableVia;
  }
  if (context.matchScope === 'tool' || context.matchScope === 'fingerprint') {
    info.matchScope = context.matchScope;
  }
  return Object.keys(info).length > 0 ? info : undefined;
}

/**
 * P1-1（2026-11-04）：从 `PERMISSION_MODE` 解析**进程默认权限档**。
 *
 * 背景：方案 §1.1 实测该环境变量**全仓无读取点**（配了不生效，与 `JWT_SECRET` / `CORS_ORIGIN`
 * 同类"配置幻觉"）。这里把它接成 `PermissionManager` 的初始模式；会话级 / UI 仍可经
 * `setMode()` 覆盖。三层优先级已收敛到 `resolveEffectiveMode()`（2026-11-11）。
 *
 * - 未设置 / 空串 ⇒ `default`（与改造前逐字一致）；
 * - 大小写不敏感（`DEFAULT` / `PLAN` 都能认）；
 * - 收缩前的旧值（`ask` / `alwaysAsk` / `acceptEdits` / `strict`）经
 *   `normalizePermissionMode` 归一（2026-11-11），旧 `.env` 不会因升级而失效；
 * - 其余非法值 ⇒ 回退 `default` 并告警（不阻断启动，fail-safe）。
 */
export function resolveInitialPermissionMode(): PermissionMode {
  const raw = configManager.env('PERMISSION_MODE', '')?.trim();
  if (!raw) return PermissionMode.DEFAULT;

  const matched = normalizePermissionMode(raw);
  if (!matched) {
    logger.warning(
      `PERMISSION_MODE=${raw} 不是合法权限模式，已回退 default（合法值：${PERMISSION_MODES.join(' / ')}）`
    );
    return PermissionMode.DEFAULT;
  }
  return matched;
}

/**
 * 权限档**三层优先级**的唯一解析点（2026-11-11 收敛）。
 *
 * 1. 请求级：`PermissionContext.permissionMode`（执行入口把会话元数据 `permission_mode`
 *    放进来；CLI / 后台 / 未设置时为 undefined）；
 * 2. 实例级：`setMode()` 写入的档（初值来自 `PERMISSION_MODE`，见构造器）；
 * 3. 兜底：实例档的初值 `PermissionMode.DEFAULT`（构造器已赋值，故这里无需再兜一次）。
 *
 * 判定分支与审计标签（`permission-mode:auto` 等）**必须共用本函数** —— 否则会出现
 * "判定按会话档、标签按进程档"的错配。
 */
export function resolveEffectiveMode(
  requestMode: PermissionMode | undefined,
  instanceMode: PermissionMode
): PermissionMode {
  return requestMode ?? instanceMode;
}

/**
 * bypass 档「无条件放行且未校验 killswitch」的**进程内一次性**告警。
 *
 * 原为 `PermissionManager#handleBypassPermissions` 内联读写的模块级布尔；搬运到
 * `manager/` 后不再可能跨文件直接改写它，故收敛为这里的唯一写入口（语义不变）。
 */
export function logBypassObservabilityOnce(): void {
  if (bypassObservabilityLogged) return;
  bypassObservabilityLogged = true;
  logger.warn('权限模式为 bypass：无条件放行且未校验 killswitch', {
    reasonCode: 'bypass_no_killswitch',
  });
}
