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
 * UnifiedDreamCycle — 统一五阶段梦境管线
 *
 * 阶段 0: Gather — 收集对话、知识库、记忆、SOUL/USER 当前状态
 * 阶段 1: Analyze — LLM 分析提取关键信息、检测人格/偏好变化
 * 阶段 2: Generate — 生成新记忆、知识更新、SOUL/USER 补丁
 * 阶段 3: Write — 批量写入记忆、知识库、SOUL.md/USER.md
 * 阶段 4: Index — 刷新索引、发布事件、通知 Buddy
 */

import type {
  DreamCycleRecord,
  DreamCycleStatus,
  DreamTriggerSource,
} from './types.js';
import { mirrorCycleToDb } from './DreamCycleDb.js';
import { SessionContentGatherer } from './gather/SessionContentGatherer.js';
import { KnowledgeScanner } from './gather/KnowledgeScanner.js';
import { PersonalityReflector } from './reflect/PersonalityReflector.js';
import { DreamPersistence } from './DreamPersistence.js';
import {
  abortAutoDream,
  computeDreamXp,
  executeAutoDream,
  runKnowledgeRain,
} from '@openliri/infra/chronos';
import {
  resolveDataSubDir,
  resolveSoulPath,
  resolveUserProfilePath,
  resolvePyappHome,
} from '@openliri/infra/environment';
import { globalEventBus, SystemEvents } from '@openliri/kernel';
import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import { AppError, ErrorCategory, ErrorSeverity } from '@openliri/infra/error';
import { broadcastEvent } from '@modules/infrastructure';
import { DreamTransaction, fileTx, TxOperation } from './DreamTransaction.js';
import { join } from 'path';
import { mkdir, writeFile, unlink } from 'fs/promises';

const logger = getLogger('dream:unifiedDreamCycle');

/** 首次运行回溯天数 */
const INITIAL_BACKTRACK_DAYS = 7;
/** 梦境周期超时（毫秒） */
const _CYCLE_TIMEOUT_MS = 120_000;
/** 连续失败告警阈值 */
const _CONSECUTIVE_FAILURE_ALERT_THRESHOLD = 3;

export class UnifiedDreamCycle {
  private gatherer: SessionContentGatherer;
  private scanner: KnowledgeScanner;
  private reflector: PersonalityReflector;
  private persistence: DreamPersistence;
  private cycleLock: Promise<DreamCycleRecord> | null = null;

  constructor(persistence: DreamPersistence) {
    this.gatherer = new SessionContentGatherer();
    this.scanner = new KnowledgeScanner();
    this.reflector = new PersonalityReflector();
    this.persistence = persistence;
  }

  /** 执行完整梦境周期 */
  async execute(source: DreamTriggerSource): Promise<DreamCycleRecord> {
    if (this.cycleLock) {
      throw new Error('DREAM_CYCLE_BUSY');
    }

    this.cycleLock = this._doExecute(source);
    try {
      return await this.cycleLock;
    } finally {
      this.cycleLock = null;
    }
  }

  /** 查询是否正在执行 */
  get isRunning(): boolean {
    return this.cycleLock !== null;
  }

  /**
   * 执行 AutoDream 并施加周期超时（2026-11-25 第 3 批）。
   *
   * 原实现：`_CYCLE_TIMEOUT_MS` 声明后从未使用 ⇒ 整合卡死时周期无限挂起，且
   * `abortAutoDream()` 因控制器从未创建而恒空转。现超时即真正中止本轮整合并抛错，
   * 由调用方按 partial 记录（`errors` 里保留超时原因）。
   */
  private async runAutoDream(source: DreamTriggerSource): Promise<boolean> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        executeAutoDream({ force: source === 'manual' }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            abortAutoDream();
            reject(
              new AppError(
                `梦境整合超时（${_CYCLE_TIMEOUT_MS}ms），已中止本轮整合`,
                ErrorCategory.EXECUTION,
                ErrorSeverity.MEDIUM,
                'DREAM_TIMEOUT'
              )
            );
          }, _CYCLE_TIMEOUT_MS);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ──── 内部实现 ────

  private async _doExecute(
    source: DreamTriggerSource
  ): Promise<DreamCycleRecord> {
    const cycleId = `dream_${Date.now()}`;
    const snapshotTime = Date.now();
    const startedAt = Date.now();
    const errors: string[] = [];
    const insights: string[] = [];

    let status: DreamCycleStatus = 'completed';

    // 统计
    let sessionsScanned = 0;
    let sessionsProcessed = 0;
    let knowledgeFilesProcessed = 0;
    let memoriesCreated = 0;
    let memoriesRefined = 0;
    let knowledgeFilesUpdated = 0;
    let soulUpdated = false;
    let userProfileUpdated = false;
    let soulConflicts = 0;
    let userConflicts = 0;
    let coldArchived = 0;
    const processedSessionIds: string[] = [];
    const processedKnowledgeFiles: string[] = [];
    /**
     * AutoDream 是否真正执行过（false = 被门槛/节流/锁跳过）。
     * 跳过时本周期不会再收到 `DREAM_*`，需在**周期收尾**按最终状态补发一条，
     * 否则伙伴日志/统计与梦境周期不一致（方案 B）。
     */
    let autoDreamRan = false;
    /**
     * 是否**尝试执行**过 AutoDream（区别于"被门槛跳过"）。
     * true + `autoDreamRan=false` ⇒ 执行抛错/超时（不是跳过）⇒ 补发失败事件。
     */
    let autoDreamAttempted = false;

    // ──── 检查点 ────
    const checkpointDir = join(resolveDataSubDir('dream'), 'checkpoints');
    const checkpointPath = join(checkpointDir, `checkpoint_${cycleId}.json`);
    let _checkpointPhase:
      | 'gathered'
      | 'analyzed'
      | 'generated'
      | 'written_all' = 'gathered';

    try {
      // ── 阶段 0: Gather ──
      try {
        broadcastEvent('dream:phase:changed', {
          cycleId,
          phase: 'gather',
          progress: 0.1,
        });
      } catch {
        /* SSE 不可用 */
        void handleError(new Error(''), {
          module: 'dream:cycle',
          action: 'broadcastPhaseChanged',
        });
      }

      await this.writeCheckpoint(checkpointPath, {
        cycleId,
        phase: 'gathered',
        timestamp: Date.now(),
        snapshotTime,
      });

      const lastAt = this.persistence.getLastCompletedAt();
      const sinceMs =
        lastAt > 0
          ? lastAt
          : snapshotTime - INITIAL_BACKTRACK_DAYS * 24 * 60 * 60 * 1000;

      // 扫描挂起会话
      const pendingDir = join(resolveDataSubDir('dream'), 'pending_sessions');

      // 收集会话
      const digests = await this.gatherer.scanNewSessions(sinceMs, pendingDir);
      sessionsScanned = digests.length;

      // 筛选高价值会话
      const highValueDigests = digests.filter(
        (d) => d.messageCount > 10 && (d.hasToolCalls || d.hasCodeBlocks)
      );
      const sessionContents: string[] = [];

      for (const digest of highValueDigests) {
        try {
          const content = await this.gatherer.readSessionContent(
            digest.sessionId,
            {
              strategy: 'recent',
              maxTokens: 8192,
            }
          );
          if (content) {
            sessionContents.push(content);
            processedSessionIds.push(digest.sessionId);
          }
        } catch (e) {
          errors.push(`读取会话 ${digest.sessionId} 失败: ${String(e)}`);
          void handleError(e, {
            module: 'dream:cycle',
            action: 'readSessionContent',
          });
        }
      }
      sessionsProcessed = sessionContents.length;

      // 扫描知识库
      const knowledgeFiles = await this.scanner.scanChanges(sinceMs);
      knowledgeFilesProcessed = knowledgeFiles.length;
      for (const f of knowledgeFiles) {
        processedKnowledgeFiles.push(f.fileName);
      }

      // 读取 SOUL/USER
      const soulContent = await this.reflector.readCurrentSoul();
      const userContent = await this.reflector.readCurrentUserProfile();

      // 记录洞察
      if (digests.length >= 5) {
        insights.push(`扫描到 ${digests.length} 个新会话`);
      }
      if (highValueDigests.length < digests.length) {
        insights.push(`其中 ${highValueDigests.length} 个高价值会话被深入分析`);
      }
      if (knowledgeFiles.length > 0) {
        insights.push(`发现 ${knowledgeFiles.length} 个知识文件变更`);
      }

      // ── 阶段 1-2: Analyze + Generate (委托给 AutoDream) ──
      try {
        broadcastEvent('dream:phase:changed', {
          cycleId,
          phase: 'analyze',
          progress: 0.3,
        });
      } catch {
        /* SSE 不可用 */
        void handleError(new Error(''), {
          module: 'dream:cycle',
          action: 'broadcastPhaseChanged',
        });
      }

      _checkpointPhase = 'analyzed';
      await this.writeCheckpoint(checkpointPath, {
        cycleId,
        phase: 'analyzed',
        timestamp: Date.now(),
        snapshotTime,
      });

      try {
        // 方案 B（2026-11-25）：手动触发强制本轮整合（跳过 AutoDream 的 4h/节流/会话数门槛）。
        // AutoDream 被跳过时它不会发 DREAM_* ⇒ 由周期收尾统一补发（见 buildRecord 之后），
        // 这样补发事件的 status/统计与周期**最终结果**一致（不再提前宣告"完成"）。
        // 2026-11-25 第 3 批：加周期超时（超时 ⇒ 中止 AutoDream，按 partial 记录）。
        autoDreamAttempted = true;
        autoDreamRan = await this.runAutoDream(source);
      } catch (e) {
        errors.push(`AutoDream 执行失败: ${String(e)}`);
        void handleError(e, {
          module: 'dream:cycle',
          action: 'executeAutoDream',
        });
        status = errors.length > 0 ? 'partial' : 'failed';
        if (status === 'failed') {
          return this.buildRecord(
            cycleId,
            source,
            status,
            snapshotTime,
            startedAt,
            Date.now(),
            sessionsScanned,
            sessionsProcessed,
            knowledgeFilesProcessed,
            memoriesCreated,
            memoriesRefined,
            knowledgeFilesUpdated,
            soulUpdated,
            userProfileUpdated,
            soulConflicts,
            userConflicts,
            processedSessionIds,
            processedKnowledgeFiles,
            insights,
            errors
          );
        }
      }

      // ── 阶段 1-2 结果：人格/偏好分析（真实观测 → SOUL/USER 纠偏输入）──
      // 2026-11-25 第 4 批（记录 #2）：原实现把字面 `'{}'` 当分析结果传给
      // `analyzeSoulAlignment` / `analyzeUserProfileChanges` ⇒ needsUpdate 恒 false、
      // SOUL/USER 永不更新。现用本轮高价值会话 + 当前 SOUL/USER 生成真实分析；
      // 无会话片段时不调用模型（零成本），失败/无 provider ⇒ `'{}'`（不更新，不伪造）。
      let personalityAnalysis = '{}';
      if (sessionContents.length > 0) {
        personalityAnalysis = await this.reflector.analyzeWithModel({
          soul: soulContent,
          user: userContent,
          sessionExcerpts: sessionContents,
        });
      }

      _checkpointPhase = 'generated';
      await this.writeCheckpoint(checkpointPath, {
        cycleId,
        phase: 'generated',
        timestamp: Date.now(),
        snapshotTime,
      });

      // ── 阶段 3: Write ──
      try {
        broadcastEvent('dream:phase:changed', {
          cycleId,
          phase: 'write',
          progress: 0.6,
        });
      } catch {
        /* SSE 不可用 */
        void handleError(new Error(''), {
          module: 'dream:cycle',
          action: 'broadcastPhaseChanged',
        });
      }

      // SOUL/USER 纠偏（事务化：备份 → 写入 → 失败回滚）
      const txOps: TxOperation[] = [];
      const soulAnalysis = this.reflector.analyzeSoulAlignment(
        soulContent,
        personalityAnalysis
      );
      if (
        soulAnalysis.needsUpdate &&
        soulAnalysis.confidence >= 0.8 &&
        soulAnalysis.suggestedPatch
      ) {
        txOps.push(
          fileTx(resolveSoulPath(), async () => {
            const result = await this.reflector.writeSoulPatch(
              soulAnalysis.suggestedPatch!,
              soulAnalysis.reason || '梦境纠偏'
            );
            if (result.conflict) {
              soulConflicts++;
              errors.push('SOUL.md 乐观锁冲突：用户手动编辑了文件');
              // 冲突 = 事务失败：整批回滚并标记周期 failed（不做部分生效）
              throw new AppError(
                'SOUL.md 乐观锁冲突：用户手动编辑了文件',
                ErrorCategory.DATA,
                ErrorSeverity.HIGH,
                'DREAM_SOUL_CONFLICT'
              );
            }
            if (result.written) {
              soulUpdated = true;
              insights.push('SOUL.md 已自动更新');
            } else if (!result.conflict) {
              // 写入失败（writeSoulPatch 内部吞错）→ 事务回滚
              throw new AppError(
                'SOUL.md 写入失败',
                ErrorCategory.DATA,
                ErrorSeverity.HIGH,
                'DREAM_SOUL_WRITE_FAILED'
              );
            }
          })
        );
      } else if (soulAnalysis.needsUpdate && soulAnalysis.confidence >= 0.5) {
        const suggestionsPath = join(
          resolvePyappHome(),
          'knowledge',
          'raw',
          `personality_suggestions_soul_${Date.now()}.md`
        );
        txOps.push(
          fileTx(suggestionsPath, async () => {
            await this.reflector.writeSuggestionsFile(
              soulAnalysis.suggestedPatch || '',
              'soul',
              suggestionsPath
            );
          })
        );
      }

      const userAnalysis = this.reflector.analyzeUserProfileChanges(
        userContent,
        personalityAnalysis
      );
      if (
        userAnalysis.needsUpdate &&
        userAnalysis.confidence >= 0.8 &&
        userAnalysis.suggestedPatch
      ) {
        txOps.push(
          fileTx(resolveUserProfilePath(), async () => {
            const result = await this.reflector.writeUserPatch(
              userAnalysis.suggestedPatch!,
              userAnalysis.reason || '梦境纠偏'
            );
            if (result.conflict) {
              userConflicts++;
              errors.push('USER.md 乐观锁冲突：用户手动编辑了文件');
              // 冲突 = 事务失败：整批回滚并标记周期 failed（不做部分生效）
              throw new AppError(
                'USER.md 乐观锁冲突：用户手动编辑了文件',
                ErrorCategory.DATA,
                ErrorSeverity.HIGH,
                'DREAM_USER_CONFLICT'
              );
            }
            if (result.written) {
              userProfileUpdated = true;
              insights.push('USER.md 已自动更新');
            } else if (!result.conflict) {
              // 写入失败（writeUserPatch 内部吞错）→ 事务回滚
              throw new AppError(
                'USER.md 写入失败',
                ErrorCategory.DATA,
                ErrorSeverity.HIGH,
                'DREAM_USER_WRITE_FAILED'
              );
            }
          })
        );
      } else if (userAnalysis.needsUpdate && userAnalysis.confidence >= 0.5) {
        const suggestionsPath = join(
          resolvePyappHome(),
          'knowledge',
          'raw',
          `personality_suggestions_user_${Date.now()}.md`
        );
        txOps.push(
          fileTx(suggestionsPath, async () => {
            await this.reflector.writeSuggestionsFile(
              userAnalysis.suggestedPatch || '',
              'user',
              suggestionsPath
            );
          })
        );
      }

      if (txOps.length > 0) {
        try {
          await DreamTransaction.run(txOps);
        } catch (error) {
          // 事务失败：备份已回滚（或保留快照供人工恢复），周期标记 failed
          errors.push(`梦境 Write 事务失败: ${String(error)}`);
          status = 'failed';
          throw error;
        }
      }

      // 清理 pending_sessions
      await this.cleanupPendingSessions(pendingDir, processedSessionIds);

      // ── 阶段 4: Write_All Checkpoint + Index ──
      try {
        broadcastEvent('dream:phase:changed', {
          cycleId,
          phase: 'index',
          progress: 0.85,
        });
      } catch {
        /* SSE 不可用 */
        void handleError(new Error(''), {
          module: 'dream:cycle',
          action: 'broadcastPhaseChanged',
        });
      }

      _checkpointPhase = 'written_all';

      // 运行知识雨
      try {
        await runKnowledgeRain();
        knowledgeFilesUpdated = knowledgeFiles.length;
      } catch (e) {
        errors.push(`知识雨失败: ${String(e)}`);
        void handleError(e, {
          module: 'dream:cycle',
          action: 'runKnowledgeRain',
        });
        status = 'partial';
      }

      // 自动触发记忆回写
      try {
        const memoryResult = await this.triggerMemoryDream();
        memoriesCreated += memoryResult.created;
        memoriesRefined += memoryResult.refined;
        insights.push('记忆回写已完成');
      } catch (e) {
        errors.push(`记忆回写失败: ${String(e)}`);
        // 2026-11-25 修复：与知识雨一致，回写失败 ⇒ 周期状态降为 partial
        // （原实现仍记 completed，出现"周期完成 + 伙伴加经验 + 记忆未写"的不一致）
        status = 'partial';
        void handleError(e, {
          module: 'dream:cycle',
          action: 'triggerMemoryDream',
        });
      }

      // 清理旧数据
      try {
        const pruned = await this.persistence.pruneOldCycles();
        if (pruned > 0) {
          insights.push(`清理了 ${pruned} 条旧梦境周期记录`);
        }
      } catch (e) {
        errors.push(`旧记录清理失败: ${String(e)}`);
        void handleError(e, {
          module: 'dream:cycle',
          action: 'pruneOldCycles',
        });
      }

      // 冷存储归档：60 天无更新的记忆移入冷存储
      try {
        const { pruneOldMemories } = await import('./ColdStorage.js');
        const { getMemoryManager } =
          await import('@openliri/infra/memory/MemoryManager');
        const mm = getMemoryManager();
        coldArchived = await pruneOldMemories(mm);
        if (coldArchived > 0) {
          insights.push(`已将 ${coldArchived} 条旧记忆移入冷存储`);
        }
      } catch (e) {
        errors.push(`冷存储归档失败: ${String(e)}`);
        void handleError(e, {
          module: 'dream:cycle',
          action: 'coldStorageArchive',
        });
      }

      // Write checkpoint
      await this.writeCheckpoint(checkpointPath, {
        cycleId,
        phase: 'written_all',
        timestamp: Date.now(),
        snapshotTime,
      });

      // 发布事件
      globalEventBus.publish(SystemEvents.USER_INTERACTION, {
        source: 'dream:completed',
        cycleId,
        success: status === 'completed',
      });
      try {
        // 2026-11-25 第 3 批：XP 与伙伴侧同源（`computeDreamXp` = 会话×10 + 洞察×5）。
        // 原实现这里是 `会话×10 + 记忆×5 + 洞察×3`，与伙伴成长对同一个梦算出两个数字。
        const xpGained = computeDreamXp({
          sessions: sessionsProcessed,
          insights: insights.length,
        });
        broadcastEvent('dream:cycle:completed', {
          cycleId,
          status,
          sessionsProcessed,
          memoriesCreated,
          insights: insights.slice(0, 5),
          xp: xpGained,
        });
      } catch {
        /* SSE 不可用 */
        void handleError(new Error(''), {
          module: 'dream:cycle',
          action: 'broadcastCycleCompleted',
        });
      }

      logger.info(`梦境周期完成: ${cycleId}`, {
        status,
        sessionsProcessed,
        memoriesCreated,
      });
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      errors.push(`梦境周期异常: ${errMsg}`);
      status = 'failed';
      handleError(e, { module: 'dream:cycle', action: 'executeDreamCycle' });
      try {
        broadcastEvent('dream:cycle:failed', { cycleId, error: errMsg });
      } catch {
        /* SSE 不可用 */
        void handleError(new Error(''), {
          module: 'dream:cycle',
          action: 'broadcastCycleFailed',
        });
      }
      logger.error(
        `梦境周期失败: ${cycleId}`,
        e instanceof Error ? e : new Error(errMsg)
      );
    }

    const completedAt = Date.now();

    // 2026-11-25 第 3 批（记录 #10）：AutoDream 被门槛/节流/锁跳过时，本轮**没有真正做梦**。
    // 原实现让 `status` 停在初值 `completed` 并补发 `DREAM_COMPLETED` ⇒ 伙伴把空转周期
    // 计入"完成次数"并发经验。现回写为 `skipped`，并补发独立的 `dream:skipped`（只进日志、
    // 不成长）；尝试过但抛错/超时的周期按失败补发（同样不计完成）。
    const skippedByGate = !autoDreamRan && !autoDreamAttempted;
    if (skippedByGate && status === 'completed') {
      status = 'skipped';
    }

    const record = this.buildRecord(
      cycleId,
      source,
      status,
      snapshotTime,
      startedAt,
      completedAt,
      sessionsScanned,
      sessionsProcessed,
      knowledgeFilesProcessed,
      memoriesCreated,
      memoriesRefined,
      knowledgeFilesUpdated,
      soulUpdated,
      userProfileUpdated,
      soulConflicts,
      userConflicts,
      processedSessionIds,
      processedKnowledgeFiles,
      insights,
      errors
    );

    // 持久化
    await this.persistence.saveCycle(record);

    // 方案 B（2026-11-25）：AutoDream 被门槛/节流/锁跳过时不会有 `DREAM_*`，
    // 这里按周期**最终状态**补发一条伙伴事件 ⇒ 每次梦都进伙伴日志，
    // 且失败周期不会被误记为"完成"。第 3 批：跳过走独立 `dream:skipped`
    // （只进日志、不计完成次数/经验），尝试过但失败的走 `DREAM_FAILED`。
    if (!autoDreamRan) {
      const failed = record.status === 'failed' || autoDreamAttempted;
      const skipped = !failed && record.status === 'skipped';
      const eventName = failed
        ? SystemEvents.DREAM_FAILED
        : skipped
          ? SystemEvents.DREAM_SKIPPED
          : SystemEvents.DREAM_COMPLETED;
      const eventType = failed
        ? 'dream:failed'
        : skipped
          ? 'dream:skipped'
          : 'dream:completed';
      globalEventBus.publish(eventName, {
        type: eventType,
        taskId: cycleId,
        summary: failed
          ? `梦境周期失败：${record.errors[0] ?? '未知错误'}`
          : skipped
            ? `本轮自动整合未执行（门槛/节流跳过）：扫描 ${record.sessionsScanned} 条会话`
            : `梦境周期完成：整理 ${record.sessionsProcessed} 条会话，产出 ${record.insights.length} 条洞察`,
        sessionsCount: skipped ? 0 : record.sessionsProcessed,
        insightsGenerated: skipped ? 0 : record.insights.length,
        timestamp: Date.now(),
      });
    }

    // 3-4（2026-09-03）：SQL 镜像到 app.db dream_cycles（按时间窗/触发源 SQL 可查询）；
    // fire-and-forget，镜像失败由内部 handleError 降级，不阻塞周期收尾
    void mirrorCycleToDb(record);

    // 记录监控指标
    const { recordCycleMetrics } = await import('./DreamMetrics.js');
    await recordCycleMetrics({
      source,
      status,
      durationMs: completedAt - startedAt,
      memoriesCreated,
      memoriesRefined,
      coldArchived,
      soulUpdated,
      userProfileUpdated,
      soulConflicts,
    });

    // 清理检查点
    try {
      await unlink(checkpointPath);
    } catch {
      /* ignore */
      void handleError(new Error('清理检查点文件失败'), {
        module: 'dream:cycle',
        action: 'unlinkCheckpoint',
      });
    }

    return record;
  }

  private buildRecord(
    cycleId: string,
    source: DreamTriggerSource,
    status: DreamCycleStatus,
    snapshotTime: number,
    startedAt: number,
    completedAt: number,
    sessionsScanned: number,
    sessionsProcessed: number,
    knowledgeFilesProcessed: number,
    memoriesCreated: number,
    memoriesRefined: number,
    knowledgeFilesUpdated: number,
    soulUpdated: boolean,
    userProfileUpdated: boolean,
    soulConflicts: number,
    userConflicts: number,
    processedSessionIds: string[],
    processedKnowledgeFiles: string[],
    insights: string[],
    errors: string[]
  ): DreamCycleRecord {
    return {
      cycleId,
      startedAt,
      completedAt,
      triggerSource: source,
      status,
      snapshotTime,
      sessionsScanned,
      sessionsProcessed,
      knowledgeFilesProcessed,
      memoriesCreated,
      memoriesRefined,
      knowledgeFilesUpdated,
      soulUpdated,
      userProfileUpdated,
      processedSessionIds,
      processedKnowledgeFiles,
      memoryCount: memoriesCreated,
      insights,
      errors,
      soulConflicts,
      userConflicts,
    };
  }

  private async writeCheckpoint(
    path: string,
    checkpoint: {
      cycleId: string;
      phase: string;
      timestamp: number;
      snapshotTime: number;
    }
  ): Promise<void> {
    await mkdir(join(resolveDataSubDir('dream'), 'checkpoints'), {
      recursive: true,
    });
    await writeFile(path, JSON.stringify(checkpoint), 'utf-8');
  }

  private async cleanupPendingSessions(
    dir: string,
    processed: string[]
  ): Promise<void> {
    try {
      const { readdir } = await import('fs/promises');
      const files = await readdir(dir);
      for (const file of files) {
        const sessionId = file.replace('.json', '');
        if (processed.includes(sessionId)) {
          await unlink(join(dir, file));
        }
      }
    } catch (err) {
      // pending 目录不存在 = 无挂起会话，属正常状态，不报 error
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'ENOENT') {
        void handleError(new Error('清理挂起会话失败'), {
          module: 'dream:cycle',
          action: 'cleanupPendingSessions',
        });
      }
    }
  }

  /** 自动触发记忆回写 (AutoDream → MemoryDreamService) */
  private async triggerMemoryDream(): Promise<{
    created: number;
    refined: number;
  }> {
    try {
      const { getMemoryManager } =
        await import('@openliri/infra/memory/MemoryManager');
      const mm = getMemoryManager();
      const { runMemoryDream } =
        await import('@openliri/infra/memory/consolidation/MemoryDreamService');
      const result = await runMemoryDream(mm);
      logger.info('梦境后记忆回写完成', {
        refined: result.refinedCount,
        knowledgeSynced: result.knowledgeSynced,
      });
      return mapMemoryDreamStats(result);
    } catch (e) {
      logger.warn('梦境后记忆回写失败', { error: String(e) });
      void handleError(e, {
        module: 'dream:cycle',
        action: 'triggerMemoryDreamInternal',
      });
      throw e;
    }
  }
}

/**
 * 梦后记忆回写结果 → 周期统计（2026-11-25 修复：此前 `memoriesCreated/memoriesRefined`
 * 声明后从未自增、`runMemoryDream` 返回值被丢弃 ⇒ 前端日志 / analytics / 伙伴 XP 记忆项恒 0）。
 *
 * 口径：`created` = 知识文件同步导入的记忆条数；`refined` = 精炼后写回的条数。
 */
export function mapMemoryDreamStats(result: {
  refinedCount: number;
  knowledgeSynced: number;
}): { created: number; refined: number } {
  const created = Number.isFinite(result.knowledgeSynced)
    ? Math.max(0, Math.floor(result.knowledgeSynced))
    : 0;
  const refined = Number.isFinite(result.refinedCount)
    ? Math.max(0, Math.floor(result.refinedCount))
    : 0;
  return { created, refined };
}
