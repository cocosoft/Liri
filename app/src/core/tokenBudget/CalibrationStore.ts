/**
 * 校准因子持久化（2026-08-14 排查补充落地）
 *
 * 按模型持久化 token 估算校准因子（~/.pyapp/data/calibration.json）：
 * 重启后无需从默认 1.2 重新学习（EMA 收敛需多次采样，浪费样本；实测
 * deepseek 从 1.2 → 2.5 需 20+ 次调用）。
 *
 * 设计说明：DB（model_registry）是模型注册数据的事实来源，但校准因子是
 * 运行时学习参数（非模型注册字段），用独立 JSON 文件持久化，避免污染 DB。
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveDataDir } from '@modules/core/paths';

const FILE_NAME = 'calibration.json';

/** 内存缓存（避免每次读盘） */
let cached: Record<string, number> | null = null;

function filePath(): string {
  return join(resolveDataDir(), FILE_NAME);
}

function loadAll(): Record<string, number> {
  if (cached) return cached;
  try {
    const p = filePath();
    if (existsSync(p)) {
      cached = JSON.parse(readFileSync(p, 'utf8')) as Record<string, number>;
    }
  } catch {
    // @ignore-catch: 文件损坏/不可读 → 空缓存，不影响运行时（重新学习）
  }
  cached ??= {};
  return cached;
}

/** 获取某模型的持久化校准因子（无则 undefined → 使用默认值） */
export function getCalibrationFactor(model: string): number | undefined {
  if (!model) return undefined;
  const all = loadAll();
  const f = all[model];
  return typeof f === 'number' && isFinite(f) && f > 0 ? f : undefined;
}

/** 待落盘的更新（防抖合并） */
const pendingWrites = new Map<string, number>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 持久化某模型校准因子（防抖 500ms 写盘）：
 * recordPostRequest 高频更新不反复落盘，合并后一次性写入。
 */
export function persistCalibrationFactor(model: string, factor: number): void {
  if (!model || !isFinite(factor) || factor <= 0) return;
  pendingWrites.set(model, factor);
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      const all = loadAll();
      for (const [m, f] of pendingWrites) all[m] = f;
      pendingWrites.clear();
      const dir = resolveDataDir();
      mkdirSync(dir, { recursive: true });
      writeFileSync(filePath(), JSON.stringify(all, null, 2), 'utf8');
    } catch {
      // @ignore-catch: 持久化失败不影响运行时（下次仍可学习）
    }
  }, 500);
}
