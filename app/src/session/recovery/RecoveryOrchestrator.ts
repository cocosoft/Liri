/**
 * 恢复编排层（P2-7 / 2026-09-25）
 *
 * 背景：本仓的"恢复/重建"曾是**三套彼此不知情**的机制 —— yield 回放由启动序列单独装配、
 * session 崩溃恢复内联在（**懒调用**的）`SessionGateway.initialize()` 内、lineage **当时完全不重建**
 * （P3-1 后已改为**启动期从盘重建**，见 ④ 步骤）⇒ 时机不对称（用户不触发会话路径则崩溃会话永不恢复），
 * 且无人能回答"本次启动重建了什么、失败了几项"（`CrashRecoveryResult` 的结构化信息被各调用点丢成一行日志）。
 *
 * 本层只做两件事：**固定顺序编排** + **聚合汇报**；不含任何策略 / 重试 / Schema。
 *
 * 分层约束（关键）：`chat` 已依赖 `session`，故本层**不得** import 任何业务模块 ——
 * 各步骤通过 {@link RecoveryPorts} **由上层注入**，避免形成 `session ↔ chat` 环依赖（R06-008）。
 *
 * MIT License - Copyright (c) 2026 Liri
 */

import { getLogger } from '@modules/monitoring';
import type { CrashRecoveryResult } from './CrashRecoveryManager';
import type {
  LineageRebuildDroppedEdge,
  LineageRebuildStats,
} from '../lineage/sessionLineage';

const logger = getLogger('session:recovery:orchestrator');

/** ② 会话派生状态重建统计 */
export interface SessionRebuildStats {
  /** 处理的会话数（全量 = 全部会话数；单会话 = 1） */
  scopes: number;
  /** 重建/回填的 FTS 文档数（全量 = 索引文档总量；单会话 = 该会话消息数） */
  ftsDocs: number;
  /** `roundCount` 被修正的会话数 */
  roundCountFixed: number;
  failures: Array<{ sessionId?: string; error: string }>;
}

/** ③ yield 恢复统计 */
export interface YieldRecoveryStats {
  /** 重建的等待条目数 */
  restored: number;
  /** 恢复器是否已装配（装配内含结算 outbox 回放） */
  resumerInstalled: boolean;
}

/**
 * 各步骤的可注入实现（由上层 `ChatManager` 组装真实实现）。
 *
 * 编排层只依赖本接口 ⇒ 零业务 import、可被独立单测（注入桩即测顺序与降级）。
 */
export interface RecoveryPorts {
  /** ① session 崩溃恢复（实现方需自保证"只真正执行一次"） */
  sessionCrash: { recover(): Promise<CrashRecoveryResult> };
  /** ② 会话派生状态重建（全量 / 单会话） */
  sessionState: {
    rebuild(opts?: { sessionId?: string }): Promise<SessionRebuildStats>;
  };
  /** ③ yield 等待集重建 + 回放装配 */
  yieldRecovery: { bootstrap(): Promise<YieldRecoveryStats> };
  /** ④ lineage：**启动期从盘重建**（P3-1 裁定 A）+ 现状描述 */
  lineage: {
    describe(): { size: number };
    /** 从盘重建血缘链（幂等）；实现方负责取数（编排层不碰存储，维持 R06-008 无环） */
    rebuild(): Promise<LineageRebuildStats>;
  };
}

/** 编排报告 —— 本次启动"重建了什么 / 跳过什么 / 失败什么"的**聚合视图** */
export interface RecoveryReport {
  startedAt: number;
  costMs: number;
  sessionCrash: {
    totalChecked: number;
    recovered: number;
    failed: number;
    paused: number;
  } | null;
  /** 未执行 ⇒ `null`（未执行原因见 `skipped`） */
  sessionState: SessionRebuildStats | null;
  yieldRecovery: YieldRecoveryStats | null;
  lineage: { size: number; rebuilt: boolean; reason: string };
  skipped: Array<{ step: string; reason: string }>;
  failures: Array<{ step: string; error: string }>;
}

/** ④ lineage **尚未执行**时的占位原因（执行后必被真实结果覆盖） */
const LINEAGE_PENDING_REASON = '尚未执行血缘重建';

/** 把净化丢弃的边压成"原因×条数"摘要（报告可读性；不逐一列出 id 以免报告膨胀） */
function describeDropped(
  dropped: readonly LineageRebuildDroppedEdge[]
): string {
  const byReason = new Map<string, number>();
  for (const edge of dropped) {
    byReason.set(edge.reason, (byReason.get(edge.reason) ?? 0) + 1);
  }
  return [...byReason.entries()]
    .map(([reason, count]) => `${reason}×${count}`)
    .join(', ');
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class RecoveryOrchestrator {
  private readonly ports: RecoveryPorts;

  constructor(ports: RecoveryPorts) {
    this.ports = ports;
  }

  /**
   * 按固定顺序编排恢复并返回聚合报告。
   *
   * **顺序**：`sessionCrash` →（可选）`sessionState` → `yieldRecovery` → `lineage.describe()`。
   * 理由：yield 回放会经内部 `streamMessage` **写会话与事件** ⇒ 必须在会话存储与索引就绪之后
   * （与既有 `main.ts` 启动序列一致）。
   *
   * **失败语义**：任一步抛错 ⇒ 记入 `failures` 并**继续后续步骤**（启动期不应因单个子系统失败而中断）；
   * 本方法**不向调用方抛错**（返回报告，由调用方按 `failures` 决策）。
   *
   * **幂等**：本方法可重复调用；各步骤的幂等由其实现方保证（`sessionCrash` 只执行一次、
   * `yieldRecovery` 复用既有幂等装配、`sessionState` 为纯重建）。
   *
   * @param opts.rebuildState 是否执行会话派生状态全量重建（默认 `false`：避免拖慢启动）
   */
  async bootstrap(opts?: { rebuildState?: boolean }): Promise<RecoveryReport> {
    const startedAt = Date.now();
    const report: RecoveryReport = {
      startedAt,
      costMs: 0,
      sessionCrash: null,
      sessionState: null,
      yieldRecovery: null,
      lineage: { size: 0, rebuilt: false, reason: LINEAGE_PENDING_REASON },
      skipped: [],
      failures: [],
    };

    // ① session 崩溃恢复（幂等：实现方只真正执行一次）
    try {
      const crash: CrashRecoveryResult =
        await this.ports.sessionCrash.recover();
      report.sessionCrash = {
        totalChecked: crash.totalChecked,
        recovered: crash.recoveredSessions,
        failed: crash.failedSessions,
        paused: crash.pausedSessions,
      };
    } catch (err) {
      report.failures.push({ step: 'sessionCrash', error: errText(err) });
    }

    // ② 会话派生状态重建（默认跳过 —— 避免每次启动都做全量 FTS 重建）
    if (opts?.rebuildState) {
      try {
        report.sessionState = await this.ports.sessionState.rebuild();
      } catch (err) {
        report.failures.push({ step: 'sessionState', error: errText(err) });
      }
    } else {
      report.skipped.push({
        step: 'sessionState',
        reason:
          '未启用（默认不在启动期执行全量重建，避免拖慢启动；按需传 rebuildState=true）',
      });
    }

    // ③ yield 等待集重建 + 回放装配
    try {
      report.yieldRecovery = await this.ports.yieldRecovery.bootstrap();
    } catch (err) {
      report.failures.push({ step: 'yieldRecovery', error: errText(err) });
    }

    // ④ lineage：**从盘重建**（P3-1 裁定 A）
    //    成功 ⇒ rebuilt=true 并带出"登记 N 条 / 丢弃 M 条（按原因计数）"；
    //    失败 ⇒ **如实** rebuilt=false（行为回到"链为空 ⇒ 相关判定 fail-closed"），**不谎报已重建**。
    try {
      const stats = await this.ports.lineage.rebuild();
      report.lineage = {
        size: stats.size,
        rebuilt: true,
        reason:
          `已从盘重建：扫描 ${stats.scanned} 条会话 ⇒ 登记 ${stats.registered} 条边` +
          (stats.dropped.length > 0
            ? `；净化丢弃 ${stats.dropped.length} 条（${describeDropped(stats.dropped)}）`
            : ''),
      };
    } catch (err) {
      let size = 0;
      try {
        size = this.ports.lineage.describe().size;
      } catch {
        // @ignore-catch describe 仅用于报告规模；失败不掩盖主错误（主错误已记入 failures）
      }
      report.lineage = {
        size,
        rebuilt: false,
        reason: `重建失败：${errText(err)}（链为空 ⇒ 相关判定 fail-closed）`,
      };
      report.failures.push({ step: 'lineage', error: errText(err) });
    }

    report.costMs = Date.now() - startedAt;

    // 单个汇总条目（对齐 §1.8：WARN 级始终输出）
    const summary = {
      costMs: report.costMs,
      sessionCrash: report.sessionCrash,
      sessionState: report.sessionState
        ? {
            scopes: report.sessionState.scopes,
            ftsDocs: report.sessionState.ftsDocs,
            roundCountFixed: report.sessionState.roundCountFixed,
            failures: report.sessionState.failures.length,
          }
        : 'skipped',
      yieldRecovery: report.yieldRecovery,
      lineage: { size: report.lineage.size, rebuilt: report.lineage.rebuilt },
    };
    if (report.failures.length > 0) {
      logger.warn('恢复编排部分失败', {
        ...summary,
        failures: report.failures,
      });
    } else {
      logger.info('恢复编排完成', summary);
    }

    return report;
  }
}
