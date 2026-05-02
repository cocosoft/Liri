/**
 * AutoDream主逻辑模块
 * 基于CC源码 cc_code/backend/services/autoDream/autoDream.ts 实现
 * 自动内存整合的核心逻辑
 */

import { getAutoDreamConfig, isAutoDreamEnabled } from './AutoDreamConfig';
import {
  readLastConsolidatedAt,
  listSessionsTouchedSince,
  tryAcquireConsolidationLock,
  rollbackConsolidationLock,
} from './ConsolidationLock';
import { buildConsolidationPrompt } from './ConsolidationPrompt';

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

interface DreamProgress {
  text: string;
  toolUseCount: number;
  touchedPaths: string[];
}

let runner: ((context: any) => Promise<void>) | null = null;
let lastSessionScanAt = 0;
let currentAbortController: AbortController | null = null;

const dreamTasks: Map<string, DreamTask> = new Map();

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
  }
}

function completeDreamTask(taskId: string, setAppState: any): void {
  const task = dreamTasks.get(taskId);
  if (task) {
    task.status = 'completed';
    task.completedAt = Date.now();
  }
}

function failDreamTask(taskId: string, setAppState: any, error?: string): void {
  const task = dreamTasks.get(taskId);
  if (task) {
    task.status = 'failed';
    task.completedAt = Date.now();
    task.error = error;
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

    const memoryRoot = process.env.AUTO_MEM_PATH || '.py_copilot/memory';
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

    try {
      completeDreamTask(taskId, setAppState);
      console.log(
        `[autoDream] completed — consolidation prompt built, task ${taskId} marked as completed`
      );

      if (context?.toolUseContext?.appendSystemMessage) {
        const task = getDreamTask(taskId);
        if (task) {
          context.toolUseContext.appendSystemMessage({
            type: 'text',
            text: `Memory consolidation completed. Files touched: ${task.filesTouched.length}`,
          });
        }
      }
    } catch (e: unknown) {
      console.log(`[autoDream] consolidation failed: ${(e as Error).message}`);
      failDreamTask(taskId, setAppState, (e as Error).message);
      await rollbackConsolidationLock(priorMtime);
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
    currentAbortController.abort()
    currentAbortController = null
    console.log('[autoDream] aborted')
  }
}

export function isAutoDreamRunning(): boolean {
  return currentAbortController !== null
}

export function getAutoDreamStatus(): {
  isRunning: boolean
  taskCount: number
  pendingTasks: number
  completedTasks: number
  failedTasks: number
} {
  const tasks = getAllDreamTasks()
  return {
    isRunning: currentAbortController !== null,
    taskCount: tasks.length,
    pendingTasks: tasks.filter(t => t.status === 'pending').length,
    completedTasks: tasks.filter(t => t.status === 'completed').length,
    failedTasks: tasks.filter(t => t.status === 'failed').length,
  }
}

export function getLastSessionScanAt(): number {
  return lastSessionScanAt
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
