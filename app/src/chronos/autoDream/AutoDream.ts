/**
 * AutoDream主逻辑模块
 * 自动内存整合的核心逻辑
 *
 * 3-3（2026-09-03）职责边界：
 * - 本模块（chronos AutoDream）= 梦境周期内的"会话/知识巡检子阶段"（fork worker 维护
 *   knowledge/index.md，不做 LLM 记忆精炼、不直接 createMemory）。开关 AUTO_DREAM_ENABLED=false 仅停本子阶段。
 * - dream/ 引擎（DreamEngine/UnifiedDreamCycle）= 唯一 cron/idle/manual 周期编排者，
 *   统一调度知识编译(runKnowledgeRain)与记忆精炼(triggerMemoryDream→runMemoryDream)。
 * - MemoryDreamService.runMemoryDream = 唯一 LLM 记忆精炼器 + 知识文件→记忆桥（createMemory 写源唯一）。
 * 注意：本模块 success 分支与 UnifiedDreamCycle 阶段 4 各调用一次 runKnowledgeRain（同周期双 rain，
 * 低危 I/O 冗余，已知观察，勿再叠加第三处）。
 */

import { getAutoDreamConfig, isAutoDreamEnabled } from './AutoDreamConfig';
// C1（2026-10-09）：dream session id 熵源改用 crypto
import { randomIdSuffix } from '../../utils/common';
import { resolveKnowledgeDir, resolvePyappHome } from '@modules/core';
// C1（2026-09-30 D-125，`R00-003` P6/G4）：知识编译改经 core SPI 端口（infra → core 合法）
import { resolveKnowledge } from '@modules/core/spi';
import { join } from 'path';
import {
  readLastConsolidatedAt,
  listSessionsTouchedSince,
  tryAcquireConsolidationLock,
  rollbackConsolidationLock,
  recordConsolidation,
} from './ConsolidationLock';
import { configManager } from '@modules/config';
import { buildConsolidationPrompt } from './ConsolidationPrompt';
import { DreamAgentExecutor } from './DreamAgentExecutor';
import type { DreamExecutionResult } from './DreamAgentExecutor';
import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error/handleError';

const logger = getLogger('AutoDream');
// D-147（2026-10-01）：任务登记改经 core SPI（`infra -> app` 倒挂收口）
import { resolveTaskRegistry } from '@modules/core/spi';
// U4（2026-10-06）：会话在线质量分改经 core SPI（同上动因 —— `turn/quality` 事件在 chat 持有）
import { resolveSessionQuality } from '@modules/core/spi';
import { globalEventBus, SystemEvents } from '@modules/core';

const SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000;

/**
 * 单次整合**最多**取多少个会话的质量摘要（成本上限）。
 *
 * 每次取数 = 一次会话事件日志读；会话多时全取会拖长梦里准备阶段。
 * 超出部分**不追加**质量行（会话本身仍在清单里）—— 少给增益，不给假数据。
 */
const MAX_QUALITY_SUMMARY_SESSIONS = 30;

/**
 * 构造"会话清单"行（U4 §D6）：每条会话一行，**尽力**追加在线质量摘要。
 *
 * - 未注册 SPI / 无 `turn/quality` 数据 ⇒ **只输出会话 id**（不追加、不造 0 分）；
 * - 取数失败 ⇒ `logger.warn` + 跳过该会话（**@ignore-catch**：质量摘要属**可选增益**输入，
 *   失败不得影响梦境主流程 —— CS03；同时不静默，便于排查）。
 */
async function buildSessionLines(sessionIds: string[]): Promise<string> {
  const port = resolveSessionQuality();
  const lines: string[] = [];
  for (let i = 0; i < sessionIds.length; i++) {
    const id = sessionIds[i];
    let suffix = '';
    if (i < MAX_QUALITY_SUMMARY_SESSIONS) {
      try {
        const s = await port.getTurnQualitySummary(id);
        if (s && s.total > 0) {
          const high = s.highValueTurns.length
            ? s.highValueTurns.join(',')
            : '无';
          const low = s.lowValueTurns.length ? s.lowValueTurns.join(',') : '无';
          suffix = `（在线质量：均分 ${s.avgScore.toFixed(2)}；高价值轮 ${high}；低价值轮 ${low}）`;
        }
      } catch (e: unknown) {
        // @ignore-catch: 可选增益输入；失败只降级"无质量行"，不影响梦境整合
        logger.warn('取会话在线质量摘要失败（跳过该会话）', {
          sessionId: id,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    lines.push(`- ${id}${suffix}`);
  }
  return lines.join('\n');
}

export interface DreamTask {
  id: string;
  sessionsReviewing: number;
  priorMtime: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'killed';
  filesTouched: string[];
  createdAt: number;
  completedAt?: number;
  error?: string;
}

/**
 * DreamEvent — 梦境生命周期事件
 * Buddy 可通过回调订阅，用于 UI 反馈和伙伴互动
 */
export type DreamEventType =
  | 'dream:started'
  | 'dream:completed'
  | 'dream:failed';

export interface DreamEvent {
  type: DreamEventType;
  taskId: string;
  summary: string;
  sessionsCount: number;
  insightsGenerated: number;
  timestamp: number;
}

/**
 * 梦境事件回调函数
 */
export type DreamEventCallback = (event: DreamEvent) => void;

let _dreamEventCallbacks: DreamEventCallback[] = [];

/**
 * 注册梦境事件回调
 */
export function onDreamEvent(callback: DreamEventCallback): void {
  _dreamEventCallbacks.push(callback);
}

/**
 * 移除梦境事件回调
 */
export function offDreamEvent(callback: DreamEventCallback): void {
  _dreamEventCallbacks = _dreamEventCallbacks.filter((cb) => cb !== callback);
}

function emitDreamEvent(event: DreamEvent): void {
  _dreamEventCallbacks.forEach((cb) => cb(event));

  const eventMap: Record<string, string> = {
    'dream:started': SystemEvents.DREAM_STARTED,
    'dream:completed': SystemEvents.DREAM_COMPLETED,
    'dream:failed': SystemEvents.DREAM_FAILED,
  };
  const systemEvent = eventMap[event.type];
  if (systemEvent) {
    globalEventBus.publish(systemEvent, event);
  }
}

interface DreamProgress {
  text: string;
  toolUseCount: number;
  touchedPaths: string[];
}

let runner: ((context: unknown) => Promise<void>) | null = null;
let lastSessionScanAt = 0;
let currentAbortController: AbortController | null = null;

const dreamTasks: Map<string, DreamTask> = new Map();

/** 内部 dreamTaskId → registryTaskId 映射 */
const dreamTaskToRegistryMap: Map<string, string> = new Map();

function generateTaskId(): string {
  return `dream_${Date.now()}_${randomIdSuffix(7)}`;
}

function isGateOpen(): boolean {
  if (!isAutoDreamEnabled()) return false;
  return true;
}

function registerDreamTask(
  setAppState: unknown,
  options: { sessionsReviewing: number; priorMtime: number }
): string {
  const taskId = generateTaskId();
  const task: DreamTask = {
    id: taskId,
    sessionsReviewing: options.sessionsReviewing,
    priorMtime: options.priorMtime,
    status: 'pending',
    filesTouched: [],
    createdAt: Date.now(),
  };
  dreamTasks.set(taskId, task);

  const registryTaskId = resolveTaskRegistry().registerLightweightTask(
    'dream',
    taskId,
    `梦境整合: ${options.sessionsReviewing} 条会话`
  );
  dreamTaskToRegistryMap.set(taskId, registryTaskId);

  return taskId;
}

function addDreamTurn(
  taskId: string,
  progress: DreamProgress,
  touchedPaths: string[],
  setAppState: unknown
): void {
  const task = dreamTasks.get(taskId);
  if (task) {
    task.status = 'running';
    task.filesTouched.push(...touchedPaths);

    const registryTaskId = dreamTaskToRegistryMap.get(taskId);
    if (registryTaskId) {
      resolveTaskRegistry().updateState(registryTaskId, { status: 'running' });
    }
  }
}

function completeDreamTask(taskId: string, setAppState: any): void {
  const task = dreamTasks.get(taskId);
  if (task) {
    task.status = 'completed';
    task.completedAt = Date.now();

    const registryTaskId = dreamTaskToRegistryMap.get(taskId);
    if (registryTaskId) {
      resolveTaskRegistry().updateState(registryTaskId, {
        status: 'completed',
        endTime: Date.now(),
      });
    }
  }
}

function failDreamTask(taskId: string, setAppState: any, error?: string): void {
  const task = dreamTasks.get(taskId);
  if (task) {
    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;

    const registryTaskId = dreamTaskToRegistryMap.get(taskId);
    if (registryTaskId) {
      resolveTaskRegistry().updateState(registryTaskId, {
        status: 'failed',
        endTime: Date.now(),
        error,
      });
    }
  }
}

function getDreamTask(taskId: string): DreamTask | undefined {
  return dreamTasks.get(taskId);
}

function getAllDreamTasks(): DreamTask[] {
  return Array.from(dreamTasks.values());
}

function isDreamTask(task: unknown): task is DreamTask {
  const t = task as Record<string, unknown>;
  return !!task && typeof t.id === 'string' && typeof t.status === 'string';
}

export async function initAutoDream(): Promise<void> {
  lastSessionScanAt = 0;

  runner = async function runAutoDream(context: unknown) {
    const cfg = getAutoDreamConfig();
    const force = false;

    if (!force && !isGateOpen()) return;

    let lastAt: number;
    try {
      lastAt = await readLastConsolidatedAt();
    } catch (e: unknown) {
      void handleError(e, {
        module: 'chronos:autodream',
        action: 'readLastConsolidatedAt',
      });
      logger.warn('读取上次整合时间失败', { error: (e as Error).message });
      return;
    }

    const hoursSince = (Date.now() - lastAt) / 3_600_000;
    if (!force && hoursSince < cfg.minHours) {
      logger.warn('跳过自动整合（时间不足）', {
        hoursSince: hoursSince.toFixed(1),
        minHours: cfg.minHours,
        reason: 'last_consolidation_too_recent',
      });
      return;
    }

    const sinceScanMs = Date.now() - lastSessionScanAt;
    if (!force && sinceScanMs < SESSION_SCAN_INTERVAL_MS) {
      logger.warn('扫描节流（跳过自动整合）', {
        sinceScanSec: Math.round(sinceScanMs / 1000),
        reason: 'session_scan_throttled',
      });
      return;
    }
    lastSessionScanAt = Date.now();

    let sessionIds: string[];
    try {
      sessionIds = await listSessionsTouchedSince(lastAt);
    } catch (e: unknown) {
      void handleError(e, {
        module: 'chronos:autodream',
        action: 'listSessionsTouchedSince',
      });
      logger.warn('列出会话失败', { error: (e as Error).message });
      return;
    }

    // 不再排除当前会话 — 用户正在聊的内容也应参与梦境整合
    // 原逻辑: sessionIds.filter(id => id !== currentSession)

    if (!force && sessionIds.length < cfg.minSessions) {
      logger.warn('跳过自动整合（会话数不足）', {
        sessionCount: sessionIds.length,
        minSessions: cfg.minSessions,
        reason: 'not_enough_sessions',
      });
      return;
    }

    let priorMtime: number | null;
    try {
      priorMtime = await tryAcquireConsolidationLock();
    } catch (e: unknown) {
      void handleError(e, {
        module: 'chronos:autodream',
        action: 'tryAcquireLock',
      });
      logger.warn('获取锁失败', { error: (e as Error).message });
      return;
    }
    if (priorMtime === null) return;

    logger.info('开始自动整合', {
      hoursSince: hoursSince.toFixed(1),
      sessionCount: sessionIds.length,
    });

    const memoryRoot =
      configManager.env('AUTO_MEM_PATH') || resolveKnowledgeDir();
    const transcriptDir = process.cwd();

    // U4（2026-10-06，`.trae/specs/online-quality-evaluation.md` §D6）：**消费在线质量分**。
    // 梦境原本只拿到"会话清单"（哪几个会话被触碰过），没有任何"哪几轮值得看"的信号；
    // 这里在会话行**追加**质量摘要（经 core SPI 取数 ⇒ 不引 chat、不造成 infra→app 倒挂）。
    // 边界：**只增一路输入**，不改梦境既有判据（规格 D6「最小接入」）；无数据即不追加。
    const sessionLines = await buildSessionLines(sessionIds);

    const extra = `

**Tool constraints for this run:** Bash is restricted to read-only commands (\`ls\`, \`find\`, \`grep\`, \`cat\`, \`stat\`, \`wc\`, \`head\`, \`tail\`, and similar). Anything that writes, redirects to a file, or modifies state will be denied. Plan your exploration with this in mind — no need to probe.

Sessions since last consolidation (${sessionIds.length}):
${sessionLines}`;

    const prompt = buildConsolidationPrompt({
      memoryRoot,
      transcriptDir,
      extra,
    });

    const ctx = context as Record<string, unknown>;
    const toolCtx = ctx?.toolUseContext as Record<string, unknown> | undefined;
    const setAppState = toolCtx?.setAppState;
    const taskId = registerDreamTask(setAppState, {
      sessionsReviewing: sessionIds.length,
      priorMtime,
    });

    addDreamTurn(
      taskId,
      { text: '启动梦境整合', toolUseCount: 0, touchedPaths: [] },
      [],
      setAppState
    );

    emitDreamEvent({
      type: 'dream:started',
      taskId,
      summary: `开始整理 ${sessionIds.length} 条会话记忆`,
      sessionsCount: sessionIds.length,
      insightsGenerated: 0,
      timestamp: Date.now(),
    });

    const executor = new DreamAgentExecutor({
      prompt,
      memoryRoot,
      transcriptDir,
      signal: currentAbortController?.signal,
      onProgress: (pct: number, msg: string) => {
        addDreamTurn(
          taskId,
          { text: msg, toolUseCount: 0, touchedPaths: [] },
          [],
          setAppState
        );
      },
    });

    let result: DreamExecutionResult;
    try {
      result = await executor.waitForResult();
    } catch (e: unknown) {
      void handleError(e, {
        module: 'chronos:autodream',
        action: 'waitForResult',
      });
      result = {
        success: false,
        filesTouched: [],
        insightsGenerated: 0,
        duration: 0,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    if (result.success) {
      completeDreamTask(taskId, setAppState);
      logger.info('自动整合完成', {
        insightsGenerated: result.insightsGenerated,
        filesTouched: result.filesTouched.length,
        durationMs: result.duration,
      });

      try {
        await recordConsolidation();
      } catch (err) {
        void handleError(err, {
          module: 'chronos:autodream',
          action: 'recordConsolidation',
        });
        // non-fatal: lock timestamp update failure
      }

      try {
        await runKnowledgeRain();
      } catch (e) {
        void handleError(e, {
          module: 'chronos:autodream',
          action: 'runKnowledgeRain',
        });
        logger.warn('知识雨执行失败', {
          error: e instanceof Error ? e.message : String(e),
        });
      }

      emitDreamEvent({
        type: 'dream:completed',
        taskId,
        summary: `整理了 ${result.insightsGenerated} 条洞察，处理了 ${result.filesTouched.length} 个文件`,
        sessionsCount: sessionIds.length,
        insightsGenerated: result.insightsGenerated,
        timestamp: Date.now(),
      });

      const ctx = context as Record<string, unknown>;
      const toolCtx = ctx?.toolUseContext as
        | Record<string, unknown>
        | undefined;
      if (toolCtx?.appendSystemMessage) {
        (toolCtx.appendSystemMessage as Function)({
          type: 'text',
          text: `Memory consolidation completed. ${result.insightsGenerated} insights generated, ${result.filesTouched.length} files touched (${result.duration}ms).`,
        });
      }
    } else {
      logger.error('自动整合失败', { error: result.error });
      failDreamTask(taskId, setAppState, result.error);
      await rollbackConsolidationLock(priorMtime);

      emitDreamEvent({
        type: 'dream:failed',
        taskId,
        summary: result.error || '未知错误',
        sessionsCount: sessionIds.length,
        insightsGenerated: 0,
        timestamp: Date.now(),
      });
    }
  };
}

export async function executeAutoDream(context?: unknown): Promise<void> {
  if (runner) {
    await runner(context || {});
  }
}

export function abortAutoDream(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    logger.info('自动整合已中止');
  }
}

export function isAutoDreamRunning(): boolean {
  return currentAbortController !== null;
}

export function getAutoDreamStatus(): {
  isRunning: boolean;
  taskCount: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
} {
  const tasks = getAllDreamTasks();
  return {
    isRunning: currentAbortController !== null,
    taskCount: tasks.length,
    pendingTasks: tasks.filter((t) => t.status === 'pending').length,
    completedTasks: tasks.filter((t) => t.status === 'completed').length,
    failedTasks: tasks.filter((t) => t.status === 'failed').length,
  };
}

/**
 * 知识雨：做梦完成后自动编译 raw/ 目录的文件到知识库
 * 确保用户发送或读取过的文件内容在梦境周期中被整理为结构化的 wiki 文档
 */
export async function runKnowledgeRain(): Promise<void> {
  const { readdir } = await import('fs/promises');
  const { join } = await import('path');
  const { existsSync } = await import('fs');

  const rawDir = join(resolvePyappHome(), 'knowledge', 'raw');

  if (!existsSync(rawDir)) return;

  const rawFiles = await readdir(rawDir);
  const compileCandidates = rawFiles.filter(
    (f) => f.endsWith('.txt') || f.endsWith('.md') || f.endsWith('.json')
  );

  if (compileCandidates.length === 0) return;

  logger.info('发现待编译原始文件', { count: compileCandidates.length });

  const result = await resolveKnowledge().runCompile({ force: false });

  if (result.compiled > 0) {
    logger.info('知识雨编译完成', {
      compiled: result.compiled,
      skipped: result.skipped,
    });
  }
}

export function getLastSessionScanAt(): number {
  return lastSessionScanAt;
}

export {
  isDreamTask,
  getDreamTask,
  getAllDreamTasks,
  registerDreamTask,
  completeDreamTask,
  failDreamTask,
  addDreamTurn,
};
