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
 * DreamMetrics — 梦境管线监控指标
 *
 * 指标存储为轻量 JSON 文件 `~/.pyapp/data/dream/metrics.json`，
 * 由 /health 端点读取并输出。
 */

import { resolveDataSubDir } from '@modules/core';
import { join } from 'path';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { Logger, LogLevel } from '@modules/monitoring';
import { handleError } from '@modules/error';
import type { DreamTriggerSource } from './types';

const logger = new Logger({
  module: 'dream:metrics',
  level: LogLevel.INFO,
});

export interface DreamMetricsData {
  /** 累计周期数（按触发源分组） */
  'dream.cycle.total': Record<string, number>;
  /** 失败周期数 */
  'dream.cycle.errors_total': number;
  /** 最近成功时间戳（毫秒） */
  'dream.cycle.last_success_timestamp': number | null;
  /** 最近一次周期耗时（毫秒） */
  'dream.cycle.last_duration_ms': number | null;
  /** 累计创建记忆数 */
  'dream.memories.created_total': number;
  /** 累计精炼记忆数 */
  'dream.memories.refined_total': number;
  /** 累计转入冷存储的记忆数 */
  'dream.memories.cold_archived_total': number;
  /** 累计 SOUL.md 自动纠偏次数 */
  'dream.soul.patches_applied_total': number;
  /** 累计 USER.md 自动纠偏次数 */
  'dream.user.patches_applied_total': number;
  /** 乐观锁冲突次数 */
  'dream.soul.conflicts_total': number;
}

const DEFAULT_METRICS: DreamMetricsData = {
  'dream.cycle.total': {},
  'dream.cycle.errors_total': 0,
  'dream.cycle.last_success_timestamp': null,
  'dream.cycle.last_duration_ms': null,
  'dream.memories.created_total': 0,
  'dream.memories.refined_total': 0,
  'dream.memories.cold_archived_total': 0,
  'dream.soul.patches_applied_total': 0,
  'dream.user.patches_applied_total': 0,
  'dream.soul.conflicts_total': 0,
};

/** 指标文件路径 */
function getMetricsPath(): string {
  return join(resolveDataSubDir('dream'), 'metrics.json');
}

/**
 * 读取当前指标
 */
export async function readMetrics(): Promise<DreamMetricsData> {
  try {
    const data = await readFile(getMetricsPath(), 'utf-8');
    const parsed = JSON.parse(data);
    return { ...DEFAULT_METRICS, ...parsed };
  } catch {
    void handleError(new Error('读取指标文件失败'), { module: 'dream:metrics', action: 'readMetrics' });
    return { ...DEFAULT_METRICS };
  }
}

/**
 * 写入指标（全量覆盖）
 */
async function writeMetrics(metrics: DreamMetricsData): Promise<void> {
  await mkdir(join(resolveDataSubDir('dream')), { recursive: true });
  await writeFile(getMetricsPath(), JSON.stringify(metrics, null, 2), 'utf-8');
}

/**
 * 梦境周期完成后更新指标
 */
export async function recordCycleMetrics(params: {
  source: DreamTriggerSource;
  status: 'completed' | 'partial' | 'failed';
  durationMs: number;
  memoriesCreated: number;
  memoriesRefined: number;
  coldArchived: number;
  soulUpdated: boolean;
  userProfileUpdated: boolean;
  soulConflicts: number;
}): Promise<void> {
  const metrics = await readMetrics();

  // 累计周期数
  const sourceKey = params.source;
  metrics['dream.cycle.total'][sourceKey] =
    (metrics['dream.cycle.total'][sourceKey] || 0) + 1;

  // 失败统计
  if (params.status === 'failed') {
    metrics['dream.cycle.errors_total']++;
  }

  // 成功时间戳
  if (params.status !== 'failed') {
    metrics['dream.cycle.last_success_timestamp'] = Date.now();
  }

  // 最近耗时
  metrics['dream.cycle.last_duration_ms'] = params.durationMs;

  // 记忆统计
  metrics['dream.memories.created_total'] += params.memoriesCreated;
  metrics['dream.memories.refined_total'] += params.memoriesRefined;
  metrics['dream.memories.cold_archived_total'] += params.coldArchived;

  // SOUL/USER 纠偏
  if (params.soulUpdated) {
    metrics['dream.soul.patches_applied_total']++;
  }
  if (params.userProfileUpdated) {
    metrics['dream.user.patches_applied_total']++;
  }
  metrics['dream.soul.conflicts_total'] += params.soulConflicts;

  await writeMetrics(metrics);
}
