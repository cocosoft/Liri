/**
 * AutoDream主逻辑模块
 * 自动内存整合的核心逻辑
 */

import { getAutoDreamConfig, isAutoDreamEnabled } from './AutoDreamConfig';
import { resolveMemoryDir, resolvePyappHome } from '@modules/config/paths';
import {
  readLastConsolidatedAt,
  listSessionsTouchedSince,
  tryAcquireConsolidationLock,
  rollbackConsolidationLock,
  recordConsolidation,
} from './ConsolidationLock';
import { buildConsolidationPrompt } from './ConsolidationPrompt';
import { DreamAgentExecutor } from './DreamAgentExecutor';
import type { DreamExecutionResult } from './DreamAgentExecutor';
import { taskRegistry } from '@modules/tasks/TaskRegistry';
import { BaseTask } from '@modules/tasks/BaseTask';
import { TaskType, TaskStatus } from '@modules/tasks/types';
import { globalEventBus, SystemEvents } from '@modules/core/events/EventBus';

const SESSION_SCAN_INTERVAL_MS = 10 * 60 * 1000;

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

let runner: ((context: any) => Promise<void>) | null = null;
let lastSessionScanAt = 0;
let currentAbortController: AbortController | null = null;

const dreamTasks: Map<string, DreamTask> = new Map();

/**
 * 轻量级梦境任务包装，用于将梦境生命周期注册到 TaskRegistry
 */
class DreamRegistryTask extends BaseTask {
  readonly type = TaskType.DREAM;

  constructor(id: string, description: string) {
    super(id, description, '', TaskType.DREAM);
  }

  async spawn(): Promise<void> {
    /* no-op */
  }
  async kill(): Promise<void> {
    /* no-op */
  }
}

/** 内部 dreamTaskId → registryTaskId 映射 */
const dreamTaskToRegistryMap: Map<string, string> = new Map();

function generateTaskId(): string {
  return `dream_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function isGateOpen(): boolean {
  if (!isAutoDreamEnabled()) return false;
  return true;
}

function registerDreamTask(
  setAppState: any,
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

  const registryTaskId = taskRegistry.register(
    new DreamRegistryTask(
      taskId,
      `梦境整合: ${options.sessionsReviewing} 条会话`
    )
  );
  dreamTaskToRegistryMap.set(taskId, registryTaskId);

  return taskId;
}

function addDreamTurn(
  taskId: string,
  progress: DreamProgress,
  touchedPaths: string[],
  setAppState: any
): void {
  const task = dreamTasks.get(taskId);
  if (task) {
    task.status = 'running';
    task.filesTouched.push(...touchedPaths);

    const registryTaskId = dreamTaskToRegistryMap.get(taskId);
    if (registryTaskId) {
      taskRegistry.updateState(registryTaskId, { status: TaskStatus.RUNNING });
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
      taskRegistry.updateState(registryTaskId, {
        status: TaskStatus.COMPLETED,
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
      taskRegistry.updateState(registryTaskId, {
        status: TaskStatus.FAILED,
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

function isDreamTask(task: any): task is DreamTask {
  return task && typeof task.id === 'string' && typeof task.status === 'string';
}

export async function initAutoDream(): Promise<void> {
  lastSessionScanAt = 0;

  runner = async function runAutoDream(context: any) {
    const cfg = getAutoDreamConfig();
    const force = false;

    if (!force && !isGateOpen()) return;

    let lastAt: number;
    try {
      lastAt = await readLastConsolidatedAt();
    } catch (e: unknown) {
      console.log(
        `[autoDream] readLastConsolidatedAt failed: ${(e as Error).message}`
      );
      return;
    }

    const hoursSince = (Date.now() - lastAt) / 3_600_000;
    if (!force && hoursSince < cfg.minHours) {
      console.log(
        `[autoDream] skip — only ${hoursSince.toFixed(1)}h since last consolidation, need ${cfg.minHours}h`
      );
      return;
    }

    const sinceScanMs = Date.now() - lastSessionScanAt;
    if (!force && sinceScanMs < SESSION_SCAN_INTERVAL_MS) {
      console.log(
        `[autoDream] scan throttle — time-gate passed but last scan was ${Math.round(sinceScanMs / 1000)}s ago`
      );
      return;
    }
    lastSessionScanAt = Date.now();

    let sessionIds: string[];
    try {
      sessionIds = await listSessionsTouchedSince(lastAt);
    } catch (e: unknown) {
      console.log(
        `[autoDream] listSessionsTouchedSince failed: ${(e as Error).message}`
      );
      return;
    }

    const currentSession = context?.sessionId;
    if (currentSession) {
      sessionIds = sessionIds.filter((id) => id !== currentSession);
    }

    if (!force && sessionIds.length < cfg.minSessions) {
      console.log(
        `[autoDream] skip — ${sessionIds.length} sessions since last consolidation, need ${cfg.minSessions}`
      );
      return;
    }

    let priorMtime: number | null;
    try {
      priorMtime = await tryAcquireConsolidationLock();
    } catch (e: unknown) {
      console.log(`[autoDream] lock acquire failed: ${(e as Error).message}`);
      return;
    }
    if (priorMtime === null) return;

    console.log(
      `[autoDream] firing — ${hoursSince.toFixed(1)}h since last, ${sessionIds.length} sessions to review`
    );

    const memoryRoot = process.env.AUTO_MEM_PATH || resolveMemoryDir();
    const transcriptDir = process.cwd();

    const extra = `

**Tool constraints for this run:** Bash is restricted to read-only commands (\`ls\`, \`find\`, \`grep\`, \`cat\`, \`stat\`, \`wc\`, \`head\`, \`tail\`, and similar). Anything that writes, redirects to a file, or modifies state will be denied. Plan your exploration with this in mind — no need to probe.

Sessions since last consolidation (${sessionIds.length}):
${sessionIds.map((id) => `- ${id}`).join('\n')}`;

    const prompt = buildConsolidationPrompt({
      memoryRoot,
      transcriptDir,
      extra,
    });

    const setAppState = context?.toolUseContext?.setAppState;
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
      console.log(
        `[autoDream] completed — consolidated ${result.insightsGenerated} insights, touched ${result.filesTouched.length} files in ${result.duration}ms`
      );

      try {
        await recordConsolidation();
      } catch {
        // non-fatal: lock timestamp update failure
      }

      try {
        await runKnowledgeRain();
      } catch (e) {
        console.log(
          `[autoDream] knowledgeRain failed: ${e instanceof Error ? e.message : String(e)}`
        );
      }

      emitDreamEvent({
        type: 'dream:completed',
        taskId,
        summary: `整理了 ${result.insightsGenerated} 条洞察，处理了 ${result.filesTouched.length} 个文件`,
        sessionsCount: sessionIds.length,
        insightsGenerated: result.insightsGenerated,
        timestamp: Date.now(),
      });

      if (context?.toolUseContext?.appendSystemMessage) {
        context.toolUseContext.appendSystemMessage({
          type: 'text',
          text: `Memory consolidation completed. ${result.insightsGenerated} insights generated, ${result.filesTouched.length} files touched (${result.duration}ms).`,
        });
      }
    } else {
      console.log(`[autoDream] consolidation failed: ${result.error}`);
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

export async function executeAutoDream(context?: any): Promise<void> {
  if (runner) {
    await runner(context || {});
  }
}

export function abortAutoDream(): void {
  if (currentAbortController) {
    currentAbortController.abort();
    currentAbortController = null;
    console.log('[autoDream] aborted');
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

  console.log(
    `[knowledgeRain] 发现 ${compileCandidates.length} 个待编译的原始文件`
  );

  const { aiService } = await import('@modules/ai/services/aiService');
  const { runKnowledgeCompile } =
    await import('../../knowledge/KnowledgeCompiler');

  const result = await runKnowledgeCompile(aiService, { force: false });

  if (result.compiled > 0) {
    console.log(
      `[knowledgeRain] 编译完成: ${result.compiled} 个编译, ${result.skipped} 个跳过`
    );
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
