/**
 * 权限决策的**遥测与审计**（P1 拆分，2026-11-12）
 *
 * 从 `PermissionManager.ts` 原样搬出：OTel 决策/细粒度 deny 计数器（惰性创建）与
 * 安全审计落盘。计数器改为**模块级惰性单例**（原本也是进程级单例实例的字段），
 * 语义不变；判定逻辑不在此文件。
 */
import { metrics } from '@opentelemetry/api';
import type { Counter } from '@opentelemetry/api';

import { logSecurityAuditEvent, truncateCommand } from '@openliri/infra/security';
import type { SecurityAuditEvent } from '@openliri/infra/security';

import { permissionMetrics } from '../metrics/PermissionMetricsStore';
import {
  PermissionDecision,
  PermissionDecisionType,
} from '../types/PermissionDecision';
import { checkReadonlyCommand } from '../classifiers/readonly-command-allowlist';
import { ruleLabel } from './moduleScope';

// 本文件无自有 logger：审计走 logSecurityAuditEvent，计数器走 OTel meter。

/**
 * 「无规则匹配 ⇒ 默认放行」的 reason 文本（历史调用方未带结构化标记时的兼容判据）。
 *
 * 新调用方（`modeHandlers` 的默认放行出口）会同时带 `context.ruleCoverage='uncovered'`；
 * 两者任一命中即视为"未覆盖"，避免只靠字符串判断（2026-11-13 G4 A 方案）。
 */
const DEFAULT_ALLOW_REASON = 'No matching rules, default allowing';

/**
 * 命令类别（2026-11-13，G4 观察期 A 方案）：
 * 无命令入参 ⇒ `non-shell`；否则复用权限层的只读分类器（**单一事实源**，CS01）。
 */
function resolveCommandClass(
  command: string | undefined
): 'read-only' | 'write-or-exec' | 'non-shell' {
  if (!command) return 'non-shell';
  return checkReadonlyCommand(command).allowed ? 'read-only' : 'write-or-exec';
}

  /**
   * OTel 决策计数器（惰性初始化；Meter 未就绪时 noop 兜底）
   */
let decisionCounter: Counter | null = null;

  /**
   * 确保决策计数器已创建
   */
  function ensureDecisionCounter(): void {
    if (decisionCounter) return;
    try {
      decisionCounter = metrics
        .getMeter('liri-permission')
        .createCounter('Liri.permission.decisions', {
          description: '权限决策计数（allow/deny/ask）',
        });
    } catch {
      // @ignore-catch: metrics 未初始化时不启用计数
    }
  }

  /**
   * 记录权限决策指标（每次决策 +1）
   * @param toolName 工具名称
   * @param type 决策类型
   */
  export function recordDecisionMetric(
    toolName: string,
    type: PermissionDecisionType
  ): void {
    ensureDecisionCounter();
    decisionCounter?.add(1, {
      decision: String(type),
      tool: toolName,
    });
    permissionMetrics.record('decision', {
      decision: String(type),
      tool: toolName,
    });
  }

  /**
   * OTel 细粒度 RBAC deny 计数器（惰性初始化；Meter 未就绪时 noop 兜底）
   *
   * 2026-11-11（P2-5）：原为「角色 deny」计数器，但判定链已覆盖用户 / 资源绑定
   * ⇒ 改名并按**真实命中主体**（`role:` / `user:` / `resource:`）打标。
   */
let fineGrainedDenyCounter: Counter | null = null;

  /**
   * 确保细粒度 deny 计数器已创建
   */
  function ensureFineGrainedDenyCounter(): void {
    if (fineGrainedDenyCounter) return;
    try {
      fineGrainedDenyCounter = metrics
        .getMeter('liri-permission')
        .createCounter('Liri.permission.fine_grained_denies', {
          description: '细粒度 RBAC 拒绝次数（tool+命中主体维度）',
        });
    } catch {
      // @ignore-catch: metrics 未初始化时不启用计数
    }
  }

  /**
   * 记录细粒度 RBAC deny 指标（每次命中 +1）
   * @param toolName 工具名称
   * @param subject 命中主体标签（`role:<id>` / `user:<id>` / `resource:<id>`）
   */
  export function recordFineGrainedDeny(toolName: string, subject: string): void {
    ensureFineGrainedDenyCounter();
    fineGrainedDenyCounter?.add(1, {
      tool: toolName,
      subject,
    });
    permissionMetrics.record('fine_grained_deny', {
      tool: toolName,
      subject,
    });
  }

  /**
   * 由决策构造安全审计事件（**纯函数**，M0-②，2026-11-12）。
   *
   * 为什么单独抽出：`sessionContext.sessionId` 此前硬编码 `'permission-manager'`
   * ⇒ 审计与围栏（G4）无法把 deny 归因到**会话**。归因语义需要可单测，
   * 故把"构造"与"落盘"分开：本函数不做任何 IO。
   *
   * 缺失会话 ⇒ `'unknown'`（显式未知）：不复制来源标签冒充会话，也不臆造 id。
   * @param decision 权限决策
   * @param toolName 工具名称
   * @param input 工具输入
   * @param sessionId 本次判定的真实会话 id（来自 `PermissionContext.sessionId`）
   */
  export function buildAuditEvent(
    decision: PermissionDecision,
    toolName: string,
    input: Record<string, unknown>,
    sessionId?: string
  ): SecurityAuditEvent {
    const rawCommand =
      typeof input.command === 'string' && input.command.length > 0
        ? input.command
        : undefined;
    const command = rawCommand || toolName;
    // 2026-11-13（G4 A 方案）：把「未覆盖」从 `riskLevel=high` 里拆出来（结构化字段）。
    const uncovered =
      decision.type === PermissionDecisionType.ALLOW &&
      (decision.context?.['ruleCoverage'] === 'uncovered' ||
        decision.reason === DEFAULT_ALLOW_REASON);
    return {
      timestamp: new Date(),
      command,
      originalCommand: command,
      truncatedResult: truncateCommand(command),
      sessionContext: {
        // 空串 / 纯空白视同缺失：审计行里给一个"看着像会话"的空值比 'unknown' 更难排查
        sessionId: sessionId?.trim() || 'unknown',
        taskDescription: decision.reason,
        currentMode: 'auto',
      },
      matchedRules: decision.rule ? [ruleLabel(decision.rule)] : [],
      behavior:
        decision.type === PermissionDecisionType.ALLOW
          ? 'allow'
          : decision.type === PermissionDecisionType.DENY
            ? 'deny'
            : 'ask',
      decision:
        decision.type === PermissionDecisionType.ALLOW
          ? 'auto_allowed'
          : decision.type === PermissionDecisionType.DENY
            ? 'auto_denied'
            : 'pending',
      // P0-2：默认放行（无规则匹配空转）标记为高危，便于发现权限空转
      riskLevel:
        decision.type === PermissionDecisionType.DENY || uncovered
          ? 'high'
          : 'medium',
      ruleCoverage: uncovered ? 'uncovered' : 'matched',
      commandClass: resolveCommandClass(rawCommand),
    };
  }

  /**
   * 审计权限决策：将每次权限决策记录到安全审计日志
   * @param decision 权限决策
   * @param toolName 工具名称
   * @param input 工具输入
   * @param sessionId M0-②（2026-11-12）：真实会话 id（缺失 ⇒ 事件里为 `'unknown'`）
   */
  export function auditDecision(
    decision: PermissionDecision,
    toolName: string,
    input: Record<string, unknown>,
    sessionId?: string
  ): void {
    try {
      logSecurityAuditEvent(
        buildAuditEvent(decision, toolName, input, sessionId)
      );
    } catch (err) {
      // 审计日志异常不应影响主流程
    }
  }
