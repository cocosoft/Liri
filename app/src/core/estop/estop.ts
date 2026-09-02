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
 * estop — 全局紧急停止（P3-4，对标 Hermes agent/estop.py）
 *
 * 语义：暂停"新工作"（新消息、新定时任务触发），不杀进行中的工作——可恢复的暂停，
 * 不是 panic/exit。引擎：数据目录下的 ESTOP sentinel 文件（~/.pyapp/data/ESTOP），
 * 含可选 JSON {reason, engagedAt}；空/损坏文件仍视为已暂停（fail-safe）。
 *
 * 检查点（接线）：
 *   - ChatOrchestrator.sendMessage：新用户消息入口 → 暂停
 *   - CronBridge 轮询 tick：cron 定时任务触发 → 跳过
 * 检查极廉价（existsSync），可每次调用；解除后下一次检查立即生效。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { resolveDataDir } from '@modules/core/paths';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('core:estop');

const SENTINEL_NAME = 'ESTOP';

/** 各组件"本次暂停已记录"集合（一次暂停只记一条日志，恢复后重置） */
const _loggedComponents = new Set<string>();

export interface EstopState {
  reason?: string;
  engagedAt?: string;
}

/** ESTOP sentinel 路径（~/.pyapp/data/ESTOP） */
export function estopSentinelPath(): string {
  return join(resolveDataDir(), SENTINEL_NAME);
}

/** 是否已启用全局急停。stat 错误按 fail-safe 处理（无法读取 = 保持暂停）。 */
export function isEstopEngaged(): boolean {
  try {
    return existsSync(estopSentinelPath());
  } catch {
    return true;
  }
}

/** 启用全局急停（幂等，重复调用仅更新文件）。返回 sentinel 路径。 */
export function engageEstop(reason?: string): string {
  const path = estopSentinelPath();
  const payload: EstopState = {
    engagedAt: new Date().toISOString(),
    reason: reason || undefined,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
  } catch {
    // 尽力而为：空文件仍能暂停（fail-safe）；磁盘不可写仅记日志
    try {
      writeFileSync(path, '', 'utf-8');
    } catch {
      logger.warn('estop sentinel 写入失败', { path });
    }
  }
  logger.warn('全局急停已启用', payload);
  _loggedComponents.clear();
  return path;
}

/** 解除全局急停。返回是否确实清理了 sentinel。 */
export function disengageEstop(): boolean {
  const path = estopSentinelPath();
  try {
    rmSync(path);
    logger.info('全局急停已解除', { path });
    _loggedComponents.clear();
    return true;
  } catch {
    return false;
  }
}

/** 获取急停状态（未启用返回 null；损坏 sentinel 仍返回 {reason?, engagedAt?} 全空）。 */
export function getEstopState(): EstopState | null {
  if (!isEstopEngaged()) return null;
  const path = estopSentinelPath();
  try {
    const raw = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, unknown>;
    return {
      reason: typeof raw['reason'] === 'string' ? raw['reason'] : undefined,
      engagedAt:
        typeof raw['engagedAt'] === 'string' ? raw['engagedAt'] : undefined,
    };
  } catch {
    return { reason: undefined, engagedAt: undefined };
  }
}

/**
 * 检查急停并返回是否已启用（每组件每次暂停只记一条日志）。
 * 调度循环每 tick 调用；恢复（disengage）后重置，下轮暂停重新记日志。
 */
export function checkEstop(component: string): boolean {
  if (!isEstopEngaged()) {
    _loggedComponents.delete(component);
    return false;
  }
  const first = !_loggedComponents.has(component);
  if (first) {
    _loggedComponents.add(component);
    const state = getEstopState();
    logger.info('调度被全局急停暂停，解除后自动恢复', {
      component,
      reason: state?.reason ?? '(未填写)',
    });
  }
  return true;
}
