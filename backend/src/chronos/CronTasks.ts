/**
 * Cron任务持久化管理
 * 基于CC源码 cc_code/backend/utils/cronTasks.ts 实现
 */

import { randomUUID } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { parseCronExpression } from './cron';
import type { ScheduledTask } from './types';

const CRON_FILE_DIR = '.py_app';
const CRON_FILE_NAME = 'scheduled_tasks.json';

/**
 * 获取cron任务文件路径
 */
export function getCronFilePath(dir?: string): string {
  const baseDir = dir ?? process.cwd();
  return join(baseDir, CRON_FILE_DIR, CRON_FILE_NAME);
}

/**
 * 确保目录存在
 */
function ensureDir(dir: string): void {
  const cronDir = join(dir, CRON_FILE_DIR);
  if (!existsSync(cronDir)) {
    mkdirSync(cronDir, { recursive: true });
  }
}

/**
 * 读取cron任务文件
 */
export function readCronTasksFile(dir?: string): ScheduledTask[] {
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

      if (!parseCronExpression(t.cron)) {
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
    console.error('[CronTasks] error reading cron tasks file:', e);
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
export function hasCronTasksSync(dir?: string): boolean {
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
  dir?: string
): Promise<string> {
  const id = generateShortId();
  const task: ScheduledTask = {
    id,
    cron,
    prompt,
    createdAt: Date.now(),
    recurring,
    permanent: false,
    durable,
    agentId,
    taskType: 'prompt',
  };

  if (durable) {
    const tasks = readCronTasksFile(dir);
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

  const idSet = new Set(ids);
  const tasks = readCronTasksFile(dir);
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

  const idSet = new Set(ids);
  const tasks = readCronTasksFile(dir);
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
  const fields = parseCronExpression(cron);
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
  const tasks = readCronTasksFile(dir);
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
  const tasks = readCronTasksFile(dir);
  const index = tasks.findIndex((t) => t.id === id);

  if (index === -1) return;

  tasks[index] = { ...tasks[index], ...updates };
  await writeCronTasksFile(tasks, dir);
}
