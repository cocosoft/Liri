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

import type { DreamCycleRecord, DreamTriggerSource } from './types';
import { SessionContentGatherer } from './gather/SessionContentGatherer';
import { KnowledgeScanner } from './gather/KnowledgeScanner';
import { PersonalityReflector } from './reflect/PersonalityReflector';
import { DreamPersistence } from './DreamPersistence';
import {
  executeAutoDream,
  runKnowledgeRain,
} from '../chronos/autoDream/AutoDream';
import { resolveDataSubDir } from '@modules/core';
import { globalEventBus, SystemEvents } from '@modules/core';
import { Logger, LogLevel } from '@modules/monitoring';
import { broadcastEvent } from '@modules/infrastructure/http/LocalHTTPServiceSSE.js';
import { join } from 'path';
import { mkdir, writeFile, unlink } from 'fs/promises';

const logger = new Logger({
  module: 'dream:unifiedDreamCycle',
  level: LogLevel.INFO,
});

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

  // ──── 内部实现 ────

  private async _doExecute(
    source: DreamTriggerSource
  ): Promise<DreamCycleRecord> {
    const cycleId = `dream_${Date.now()}`;
    const snapshotTime = Date.now();
    const startedAt = Date.now();
    const errors: string[] = [];
    const insights: string[] = [];

    let status: 'completed' | 'partial' | 'failed' = 'completed';

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
      }

      _checkpointPhase = 'analyzed';
      await this.writeCheckpoint(checkpointPath, {
        cycleId,
        phase: 'analyzed',
        timestamp: Date.now(),
        snapshotTime,
      });

      try {
        await executeAutoDream();
      } catch (e) {
        errors.push(`AutoDream 执行失败: ${String(e)}`);
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
      }

      // SOUL/USER 纠偏
      const soulAnalysis = this.reflector.analyzeSoulAlignment(
        soulContent,
        '{}'
      );
      if (
        soulAnalysis.needsUpdate &&
        soulAnalysis.confidence >= 0.8 &&
        soulAnalysis.suggestedPatch
      ) {
        const result = await this.reflector.writeSoulPatch(
          soulAnalysis.suggestedPatch,
          soulAnalysis.reason || '梦境纠偏'
        );
        if (result.conflict) {
          soulConflicts++;
          errors.push('SOUL.md 乐观锁冲突：用户手动编辑了文件');
        } else if (result.written) {
          soulUpdated = true;
          insights.push('SOUL.md 已自动更新');
        }
      } else if (soulAnalysis.needsUpdate && soulAnalysis.confidence >= 0.5) {
        await this.reflector.writeSuggestionsFile(
          soulAnalysis.suggestedPatch || '',
          'soul'
        );
      }

      const userAnalysis = this.reflector.analyzeUserProfileChanges(
        userContent,
        '{}'
      );
      if (
        userAnalysis.needsUpdate &&
        userAnalysis.confidence >= 0.8 &&
        userAnalysis.suggestedPatch
      ) {
        const result = await this.reflector.writeUserPatch(
          userAnalysis.suggestedPatch,
          userAnalysis.reason || '梦境纠偏'
        );
        if (result.conflict) {
          userConflicts++;
          errors.push('USER.md 乐观锁冲突：用户手动编辑了文件');
        } else if (result.written) {
          userProfileUpdated = true;
          insights.push('USER.md 已自动更新');
        }
      } else if (userAnalysis.needsUpdate && userAnalysis.confidence >= 0.5) {
        await this.reflector.writeSuggestionsFile(
          userAnalysis.suggestedPatch || '',
          'user'
        );
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
      }

      _checkpointPhase = 'written_all';

      // 运行知识雨
      try {
        await runKnowledgeRain();
        knowledgeFilesUpdated = knowledgeFiles.length;
      } catch (e) {
        errors.push(`知识雨失败: ${String(e)}`);
        status = 'partial';
      }

      // 自动触发记忆回写
      try {
        await this.triggerMemoryDream();
        insights.push('记忆回写已完成');
      } catch (e) {
        errors.push(`记忆回写失败: ${String(e)}`);
      }

      // 清理旧数据
      try {
        const pruned = await this.persistence.pruneOldCycles();
        if (pruned > 0) {
          insights.push(`清理了 ${pruned} 条旧梦境周期记录`);
        }
      } catch (e) {
        errors.push(`旧记录清理失败: ${String(e)}`);
      }

      // 冷存储归档：60 天无更新的记忆移入冷存储
      try {
        const { pruneOldMemories } = await import('./ColdStorage');
        const { MemoryManagerImpl } = await import('../memory/MemoryManager');
        const mm = new MemoryManagerImpl();
        coldArchived = await pruneOldMemories(mm);
        if (coldArchived > 0) {
          insights.push(`已将 ${coldArchived} 条旧记忆移入冷存储`);
        }
      } catch (e) {
        errors.push(`冷存储归档失败: ${String(e)}`);
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
        const xpGained =
          sessionsProcessed * 10 + memoriesCreated * 5 + insights.length * 3;
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
      try {
        broadcastEvent('dream:cycle:failed', { cycleId, error: errMsg });
      } catch {
        /* SSE 不可用 */
      }
      logger.error(
        `梦境周期失败: ${cycleId}`,
        e instanceof Error ? e : new Error(errMsg)
      );
    }

    const completedAt = Date.now();
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

    // 记录监控指标
    const { recordCycleMetrics } = await import('./DreamMetrics');
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
    }

    return record;
  }

  private buildRecord(
    cycleId: string,
    source: DreamTriggerSource,
    status: 'completed' | 'partial' | 'failed',
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
    } catch {
      /* ignore */
    }
  }

  /** 自动触发记忆回写 (AutoDream → MemoryDreamService) */
  private async triggerMemoryDream(): Promise<void> {
    try {
      const { MemoryManagerImpl } = await import('../memory/MemoryManager');
      const mm = new MemoryManagerImpl();
      const { runMemoryDream } =
        await import('../memory/consolidation/MemoryDreamService');
      await runMemoryDream(mm);
      logger.info('梦境后记忆回写完成');
    } catch (e) {
      logger.warn('梦境后记忆回写失败', { error: String(e) });
      throw e;
    }
  }
}
