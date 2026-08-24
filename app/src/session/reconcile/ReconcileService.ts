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
 * ReconcileService — 双写一致性对账（事件溯源单一化 Phase D D-1，方案 T-D）
 *
 * 比对 events（事件日志）与 messages（投影）的一致性，产出漂移报告 + 修复计划。
 * 仲裁规则：
 * - 投影有、事件无（非 summary / 非修剪缺口）→ 反向补全候选（events 半写）
 * - 事件有、投影无 → projection-missing（events 为准）
 * - content 不一致 → 漂移（比对基准：事件 text 拼接 vs 投影 content）
 * - 压缩半状态：投影含压缩区间内消息 → 用 summary 替换候选（半状态自愈）
 *
 * 自动修复默认关闭（仅检测 + 告警 + 修复计划，评审 v0.2#3/#4 + v0.3#7）。
 */

import { getLogger } from '@modules/monitoring/logs/Logger.js';
import { handleError } from '@modules/error';
import { promises as fs } from 'fs';
import type { LiriEvent } from '../../chat/types/events';
import {
  deriveMessagesFromEvents,
  type CompactionRange,
  type DerivedMessage,
} from '../storage/EventMessageDeriver';
import type { EventLogStorage } from '../storage/EventLogStorage';

const logger = getLogger('session:reconcile');

/** 漂移类型 */
export type ReconcileDriftKind =
  | 'event-missing' // 投影有、事件无（反向补全候选）
  | 'projection-missing' // 事件有、投影无（events 为准）
  | 'content-mismatch' // 事件 text 拼接 vs 投影 content 不一致
  | 'compaction-half-state'; // 压缩半状态：投影含压缩区间内消息

/** 单条漂移记录 */
export interface ReconcileDrift {
  messageId: string;
  kind: ReconcileDriftKind;
  detail: string;
}

/** 反向补全候选（events 半写但投影完整，用 convertMessage 反推补写） */
export interface BackfillCandidate {
  messageId: string;
  lastEventSeq: number;
}

/** 对账报告 */
export interface ReconcileReport {
  sessionId: string;
  ok: boolean;
  drifts: ReconcileDrift[];
  backfillCandidates: BackfillCandidate[];
  repairPlan: string[];
}

/** 对账服务数据依赖（注入以便单测） */
export interface ReconcileDeps {
  getEventLog: (sessionId: string) => EventLogStorage;
  getProjections: (sessionId: string) => Promise<DerivedMessage[]>;
  getSessionMeta: (
    sessionId: string
  ) => Promise<Record<string, unknown> | undefined>;
}

/** 修剪区间（metadata.trajectoryTrims 条目） */
interface TrimRange {
  startSeq: number;
  endSeq: number;
}

export class ReconcileService {
  constructor(private readonly deps: ReconcileDeps) {}

  /**
   * 对账单个会话
   *
   * 默认只检测 + 告警 + 生成修复计划（不执行写操作）。
   *
   * @param opts.sinceSeq 增量对账（评审 v0.4#13）：只比对 lastEventSeq > sinceSeq 的投影
   *（只比新增），控制大会话成本；不传则全量比对。调用方负责全量抽样（每 N 次全量一次）。
   */
  async reconcileSession(
    sessionId: string,
    opts?: { sinceSeq?: number }
  ): Promise<ReconcileReport> {
    const drifts: ReconcileDrift[] = [];
    const backfillCandidates: BackfillCandidate[] = [];
    const sinceSeq = opts?.sinceSeq;

    try {
      const eventLog = this.deps.getEventLog(sessionId);

      // 坏行检测（规格 D-1 验收：events 损坏 → 以投影为准 + 告警，不反向补全）：
      // 原始文件非空行数 > 有效事件数 → 存在坏行/损坏行，事件流不可信。
      // 必须在 eventLog.read() 之前数原始行数——read() 触发 D4 torn repair，
      // 会抢先截断损坏行（保守视为 torn），repair 之后数不到坏行。
      let rawLineCount = 0;
      try {
        const raw = await fs.readFile(eventLog.getFilePath(), 'utf-8');
        rawLineCount = raw
          .split('\n')
          .filter((l) => l.trim().length > 0).length;
      } catch {
        // 文件不存在/读取失败 → 视为无坏行（投影兜底）
      }

      const events = await eventLog.read();
      const projections = await this.deps.getProjections(sessionId);
      const meta = await this.deps.getSessionMeta(sessionId);

      const badLineCount = Math.max(0, rawLineCount - events.length);
      const eventsDamaged = badLineCount > 0;
      if (eventsDamaged) {
        drifts.push({
          messageId: '',
          kind: 'event-missing',
          detail: `事件日志含 ${badLineCount} 条坏行（有效 ${events.length} / 原始 ${events.length + badLineCount}），events 损坏 → 以投影为准 + 告警`,
        });
      }

      const compactionRanges =
        (meta?.trajectoryCompactions as CompactionRange[] | undefined) ?? [];
      const trimRanges =
        (meta?.trajectoryTrims as TrimRange[] | undefined) ?? [];

      // 事件侧消息 id 集合（用于反向补全判定）
      const eventMessageIds = new Set<string>();
      for (const ev of events) {
        const mid = (ev.data as { messageId?: unknown }).messageId;
        if (typeof mid === 'string') eventMessageIds.add(mid);
      }

      // 事件派生消息（压缩区间由 metadata 提供，跳过 summary）
      const derived = deriveMessagesFromEvents(events, projections, {
        compactionRanges,
      });
      const summaryMessageIds = new Set(
        compactionRanges
          .map((r) => r.summaryMessageId)
          .filter((id): id is string => typeof id === 'string')
      );
      const derivedById = new Map<string, DerivedMessage>();
      for (const d of derived) {
        if (summaryMessageIds.has(d.id)) continue;
        if (d.lastEventSeq === 0) continue; // 纯投影兜底（非事件派生，跳过内容比对）
        derivedById.set(d.id, d);
      }

      // ① 投影侧检查：投影有、事件无 → 反向补全候选（排除 summary / 修剪缺口）
      for (const p of projections) {
        // 增量对账（评审 v0.4#13）：只比对 lastEventSeq > sinceSeq 的新增投影
        if (sinceSeq !== undefined && (p.lastEventSeq ?? 0) <= sinceSeq)
          continue;
        if (summaryMessageIds.has(p.id)) continue;
        // 修剪缺口排除（评审 v0.3#3）：投影 lastEventSeq 落在修剪区间 → 合法缺口
        if (this.isInTrimRange(p.lastEventSeq, trimRanges)) continue;

        if (!eventMessageIds.has(p.id)) {
          // 坏行场景：事件流不可信 → 仅提示，不生成反向补全候选（以投影为准）
          if (eventsDamaged) {
            drifts.push({
              messageId: p.id,
              kind: 'event-missing',
              detail: `投影消息 ${p.id} 无对应事件，但事件日志已损坏（${badLineCount} 坏行）→ 以投影为准`,
            });
            continue;
          }
          drifts.push({
            messageId: p.id,
            kind: 'event-missing',
            detail: `投影消息 ${p.id} 无对应事件（lastEventSeq=${p.lastEventSeq ?? '?'}），events 半写，需反向补全`,
          });
          backfillCandidates.push({
            messageId: p.id,
            lastEventSeq: p.lastEventSeq ?? 0,
          });
          continue;
        }

        // content 比对基准（评审 v0.4#3）：事件 text 拼接 vs 投影 content
        const eventMsg = derivedById.get(p.id);
        if (eventMsg && typeof eventMsg.content === 'string') {
          const eventText = eventMsg.content.trim();
          const projText = (
            typeof p.content === 'string' ? p.content : ''
          ).trim();
          if (
            eventText.length > 0 &&
            projText.length > 0 &&
            eventText !== projText
          ) {
            drifts.push({
              messageId: p.id,
              kind: 'content-mismatch',
              detail: `事件 text 拼接与投影 content 不一致（事件=${eventText.length}字符 / 投影=${projText.length}字符）`,
            });
          }
        }
      }

      // ② 事件侧检查：事件有、投影无 → projection-missing
      for (const d of derivedById.values()) {
        const hasProjection = projections.some((p) => p.id === d.id);
        if (!hasProjection) {
          drifts.push({
            messageId: d.id,
            kind: 'projection-missing',
            detail: `事件消息 ${d.id} 无投影（lastEventSeq=${d.lastEventSeq}），events 为准待重建投影`,
          });
        }
      }

      // ③ 压缩半状态自愈检测（评审 v0.3#7 + v0.4#4）：投影含压缩区间内消息 → 用 summary 替换
      for (const range of compactionRanges) {
        if (!range.summaryMessageId) continue;
        const inRange = projections.filter(
          (p) =>
            typeof p.lastEventSeq === 'number' &&
            p.lastEventSeq >= range.startSeq &&
            p.lastEventSeq <= range.endSeq
        );
        if (inRange.length > 0) {
          drifts.push({
            messageId: range.summaryMessageId,
            kind: 'compaction-half-state',
            detail: `压缩区间 [${range.startSeq},${range.endSeq}] 内仍有 ${inRange.length} 条投影消息（${inRange.map((m) => m.id).join(',')}），需用 summary(${range.summaryMessageId}) 替换`,
          });
        }
      }

      // ④ 生成修复计划（默认不执行）
      const repairPlan = this.buildRepairPlan(
        backfillCandidates,
        compactionRanges,
        drifts
      );

      if (drifts.length > 0) {
        logger.warn('session:reconcile 检测到漂移', {
          sessionId,
          driftCount: drifts.length,
          backfillCount: backfillCandidates.length,
          kinds: drifts.reduce(
            (acc, d) => {
              acc[d.kind] = (acc[d.kind] ?? 0) + 1;
              return acc;
            },
            {} as Record<string, number>
          ),
        });
      } else {
        logger.info('session:reconcile 会话一致，无漂移', { sessionId });
      }

      return {
        sessionId,
        ok: drifts.length === 0,
        drifts,
        backfillCandidates,
        repairPlan,
      };
    } catch (e) {
      await handleError(e, {
        module: 'session:reconcile',
        action: 'reconcileSession',
        context: { sessionId },
      }).catch(() => {});
      return {
        sessionId,
        ok: false,
        drifts: [
          {
            messageId: '',
            kind: 'content-mismatch',
            detail: `对账执行失败：${String(e)}`,
          },
        ],
        backfillCandidates,
        repairPlan: [],
      };
    }
  }

  /** 判断 seq 是否落在修剪区间（合法缺口，T-D 不误报） */
  private isInTrimRange(seq: number | undefined, trims: TrimRange[]): boolean {
    if (typeof seq !== 'number') return false;
    return trims.some((t) => seq >= t.startSeq && seq <= t.endSeq);
  }

  /** 生成修复计划文本（自动修复默认关闭，仅产出计划） */
  private buildRepairPlan(
    backfillCandidates: BackfillCandidate[],
    compactionRanges: CompactionRange[],
    drifts: ReconcileDrift[]
  ): string[] {
    const plan: string[] = [];
    if (backfillCandidates.length > 0) {
      plan.push(
        `反向补全：对 ${backfillCandidates.length} 条投影消息用 MessageToEventMigrator.convertMessage 补写事件（复用 lastEventSeq=${backfillCandidates[0]?.lastEventSeq ?? 0}，幂等由 append seq 守卫保证，跳过已修剪区间）`
      );
    }
    for (const range of compactionRanges) {
      const halfState = drifts.filter(
        (d) =>
          d.kind === 'compaction-half-state' &&
          d.messageId === range.summaryMessageId
      );
      if (halfState.length > 0) {
        plan.push(
          `压缩半状态自愈：用 summary(${range.summaryMessageId}) 替换区间 [${range.startSeq},${range.endSeq}] 内投影消息（替换而非添加）`
        );
      }
    }
    if (drifts.some((d) => d.kind === 'projection-missing')) {
      plan.push('投影缺失：以 events 为准重建投影（事件派生结果覆盖投影）');
    }
    if (plan.length === 0 && drifts.length > 0) {
      plan.push('漂移待人工评估（自动修复默认关闭）');
    }
    return plan;
  }
}
