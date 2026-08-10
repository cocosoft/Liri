/**
 * growthPersistence.ts — Buddy 成长状态持久化
 *
 * DreamGrowthTracker 的成长统计（梦境/任务/里程碑）曾为纯内存，
 * 后端重启即清零，导致"会话超过轮数却不触发成长"。
 * 现统一落盘到 ~/.pyapp/data/buddy-growth.json，重启后恢复。
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { resolveDataDir } from '@modules/core/paths';
import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({ module: 'buddy:growthPersistence', level: LogLevel.INFO });

/** 成长状态快照（可序列化） */
export interface GrowthState {
  totalCompleted: number;
  totalSessions: number;
  totalInsights: number;
  lastCompletedDate: string;
  consecutiveDays: number;
  unlockedAchievements: string[];
  taskCompletionCount: number;
  totalTaskExp: number;
}

export function createEmptyGrowthState(): GrowthState {
  return {
    totalCompleted: 0,
    totalSessions: 0,
    totalInsights: 0,
    lastCompletedDate: '',
    consecutiveDays: 0,
    unlockedAchievements: [],
    taskCompletionCount: 0,
    totalTaskExp: 0,
  };
}

export function growthStatePath(): string {
  return `${resolveDataDir()}/buddy-growth.json`;
}

export async function loadGrowthState(): Promise<GrowthState> {
  try {
    const raw = await readFile(growthStatePath(), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<GrowthState>;
    return {
      ...createEmptyGrowthState(),
      ...parsed,
      // 防御性：旧数据可能缺数组/数字
      unlockedAchievements: Array.isArray(parsed.unlockedAchievements)
        ? parsed.unlockedAchievements
        : [],
      totalCompleted: Number(parsed.totalCompleted) || 0,
      totalSessions: Number(parsed.totalSessions) || 0,
      totalInsights: Number(parsed.totalInsights) || 0,
      consecutiveDays: Number(parsed.consecutiveDays) || 0,
      taskCompletionCount: Number(parsed.taskCompletionCount) || 0,
      totalTaskExp: Number(parsed.totalTaskExp) || 0,
    };
  } catch (e) {
    // 文件不存在或损坏 → 从空状态开始
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      logger.warn('读取成长状态失败，使用空状态', { error: String(e) });
    }
    return createEmptyGrowthState();
  }
}

export async function saveGrowthState(state: GrowthState): Promise<void> {
  try {
    const file = growthStatePath();
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2), 'utf-8');
  } catch (e) {
    // 落盘失败不影响运行，但记录以便排查
    logger.warn('保存成长状态失败', { error: String(e) });
  }
}
