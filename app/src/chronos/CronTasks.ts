/**
 * Cron任务持久化管理
 */

import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parseCronExpression, normalizeSchedule, isValidCronExpression } from './cron';
import { resolveChronosDir } from '@modules/config/paths';
import type { ScheduledTask } from './types';
import type { SqliteCronStore } from './service/SqliteCronStore';

const logger = new Logger({ level: LogLevel.INFO });

const CRON_FILE_NAME = 'scheduled_tasks.json';

let _sqliteStore: SqliteCronStore | null = null;

/**
 * 设置 SQLite 持久化存储（替代 JSON 文件）
 */
export function setCronSqliteStore(store: SqliteCronStore): void {
  _sqliteStore = store;
}

/**
 * 获取cron任务文件路径
 */
export function getCronFilePath(dir?: string): string {
  const baseDir = dir ?? resolveChronosDir();
  return join(baseDir, CRON_FILE_NAME);
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * 读取cron任务文件
 */
export async function readCronTasksFile(
  dir?: string
): Promise<ScheduledTask[]> {
  if (_sqliteStore) {
    try {
      const tasks = await _sqliteStore.listTasks();
      const validTasks = tasks.filter((t) => isValidCronExpression(t.cron));
      if (validTasks.length !== tasks.length) {
        logger.warn(
          `[CronTasks] filtered ${tasks.length - validTasks.length} invalid tasks from SQLite`
        );
      }
      return validTasks;
    } catch (error) {
      logger.error(
        '[CronTasks] error reading from SQLite, falling back to file',
        error
      );
    }
  }

  const filePath = getCronFilePath(dir);
  try {
    if (!existsSync(filePath)) {
      return [];
    }
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return [];
    }

    const out: ScheduledTask[] = [];
    for (const t of parsed.tasks) {
      if (
        !t ||
        typeof t.id !== 'string' ||
        typeof t.cron !== 'string' ||
        typeof t.prompt !== 'string' ||
        typeof t.createdAt !== 'number'
      ) {
        console.log(
          `[CronTasks] skipping malformed task: ${JSON.stringify(t)}`
        );
        continue;
      }

      if (!isValidCronExpression(t.cron)) {
        console.log(
          `[CronTasks] skipping task ${t.id} with invalid cron '${t.cron}'`
        );
        continue;
      }

      out.push({
        id: t.id,
        cron: t.cron,
        prompt: t.prompt,
        createdAt: t.createdAt,
        lastFiredAt: t.lastFiredAt,
        recurring: t.recurring ?? true,
        permanent: t.permanent ?? false,
        durable: t.durable ?? true,
        agentId: t.agentId,
        taskType: t.taskType || 'prompt',
        metadata: t.metadata,
      });
    }
    return out;
  } catch (e) {
    logger.error('[CronTasks] error reading cron tasks file:', e);
    return [];
  }
}

/**
 * 写入cron任务文件
 */
export async function writeCronTasksFile(
  tasks: ScheduledTask[],
  dir?: string
): Promise<void> {
  if (_sqliteStore) {
    try {
      await _sqliteStore.removeTasks(tasks.map((t) => t.id));
      for (const task of tasks) {
        await _sqliteStore.addTask(task);
      }
      return;
    } catch (error) {
      logger.error(
        '[CronTasks] error writing to SQLite, falling back to file',
        error
      );
    }
  }

  const baseDir = dir ?? process.cwd();
  ensureDir(baseDir);
  const filePath = getCronFilePath(baseDir);

  const body = {
    tasks: tasks.map(({ durable: _durable, ...rest }) => rest),
  };

  writeFileSync(filePath, JSON.stringify(body, null, 2) + '\n', 'utf-8');
}

/**
 * 同步检查是否存在cron任务
 */
export async function hasCronTasksSync(dir?: string): Promise<boolean> {
  if (_sqliteStore) {
    try {
      const count = await _sqliteStore.countTasks();
      return count > 0;
    } catch {
      return false;
    }
  }

  const filePath = getCronFilePath(dir);
  try {
    if (!existsSync(filePath)) {
      return false;
    }
    const raw = readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tasks)) {
      return false;
    }
    return parsed.tasks.length > 0;
  } catch {
    return false;
  }
}

/**
 * 生成短ID (8位UUID)
 */
function generateShortId(): string {
  return randomUUID().slice(0, 8);
}

/**
 * 添加任务
 */
export async function addCronTask(
  cron: string,
  prompt: string,
  recurring: boolean = true,
  durable: boolean = true,
  agentId?: string,
  dir?: string,
  silent: boolean = false
): Promise<string> {
  // Normalize human-friendly schedule (every/at/macro) to 5-field cron
  const normalizedCron = normalizeSchedule(cron);
  if (!normalizedCron) {
    throw new Error(`Invalid schedule expression: ${cron}`);
  }

  const id = generateShortId();
  const task: ScheduledTask = {
    id,
    cron: normalizedCron,
    prompt,
    createdAt: Date.now(),
    recurring,
    permanent: false,
    durable,
    agentId,
    taskType: 'prompt',
    silent,
  };

  if (durable) {
    const tasks = await readCronTasksFile(dir);
    tasks.push(task);
    await writeCronTasksFile(tasks, dir);
  }

  return id;
}

/**
 * 删除任务
 */
export async function removeCronTasks(
  ids: string[],
  dir?: string
): Promise<void> {
  if (ids.length === 0) return;

  if (_sqliteStore) {
    try {
      await _sqliteStore.removeTasks(ids);
      return;
    } catch (error) {
      logger.error(
        '[CronTasks] error removing from SQLite, falling back',
        error
      );
    }
  }

  const idSet = new Set(ids);
  const tasks = await readCronTasksFile(dir);
  const remaining = tasks.filter((t) => !idSet.has(t.id));

  if (remaining.length !== tasks.length) {
    await writeCronTasksFile(remaining, dir);
  }
}

/**
 * 更新任务触发时间
 */
export async function markCronTasksFired(
  ids: string[],
  firedAt: number,
  dir?: string
): Promise<void> {
  if (ids.length === 0) return;

  if (_sqliteStore) {
    try {
      await _sqliteStore.markFired(ids, firedAt);
      return;
    } catch (error) {
      logger.error(
        '[CronTasks] error marking fired in SQLite, falling back',
        error
      );
    }
  }

  const idSet = new Set(ids);
  const tasks = await readCronTasksFile(dir);
  let changed = false;

  for (const t of tasks) {
    if (idSet.has(t.id)) {
      t.lastFiredAt = firedAt;
      changed = true;
    }
  }

  if (changed) {
    await writeCronTasksFile(tasks, dir);
  }
}

/**
 * 列出所有任务
 */
export async function listAllCronTasks(dir?: string): Promise<ScheduledTask[]> {
  return readCronTasksFile(dir);
}

/**
 * 计算下次运行时间
 */
export function nextCronRunMs(cron: string, fromMs: number): number | null {
  const { computeNextCronRun } = require('./cron');
  const normalized = normalizeSchedule(cron) ?? cron;
  const fields = parseCronExpression(normalized);
  if (!fields) return null;
  const next = computeNextCronRun(fields, new Date(fromMs));
  return next ? next.getTime() : null;
}

/**
 * 查找错过的任务
 */
export function findMissedTasks(
  tasks: ScheduledTask[],
  nowMs: number
): ScheduledTask[] {
  return tasks.filter((t) => {
    const next = nextCronRunMs(t.cron, t.createdAt);
    return next !== null && next < nowMs;
  });
}

/**
 * 获取单个任务
 */
export async function getCronTask(
  id: string,
  dir?: string
): Promise<ScheduledTask | null> {
  if (_sqliteStore) {
    try {
      return await _sqliteStore.getTask(id);
    } catch (error) {
      logger.error(
        '[CronTasks] error getting task from SQLite, falling back',
        error
      );
    }
  }

  const tasks = await readCronTasksFile(dir);
  return tasks.find((t) => t.id === id) || null;
}

/**
 * 更新任务
 */
export async function updateCronTask(
  id: string,
  updates: Partial<ScheduledTask>,
  dir?: string
): Promise<void> {
  if (_sqliteStore) {
    try {
      await _sqliteStore.updateTask(id, updates);
      return;
    } catch (error) {
      logger.error(
        '[CronTasks] error updating task in SQLite, falling back',
        error
      );
    }
  }

  const tasks = await readCronTasksFile(dir);
  const index = tasks.findIndex((t) => t.id === id);

  if (index === -1) return;

  tasks[index] = { ...tasks[index], ...updates };
  await writeCronTasksFile(tasks, dir);
}
