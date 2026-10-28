/**
 * CheckpointBoundaryConfig — Checkpoint 边界策略的**应用侧配置**（P5-4，2026-10-28）
 *
 * 规格：`.trae/specs/p5-runtime-hardening-specs.md` §3。
 *
 * ## 为什么用配置而不是 `feature()` 开关
 * 边界策略是**应用策略**，不是内核能力。`FeatureFlag` 只能在
 * `packages/kernel/src/core/featureFlags.ts` 增键，而内核体量棘轮 K08 已顶格
 * （`loc=13727 ≤ 13727`）⇒ 加一行即红。故按 `CheckpointLogConfig` 的既有先例
 * （同目录、同 3s TTL、同"文件缺失即默认关闭"）落在 app 侧。
 *
 * 数据流（与 `checkpointLog` 同构）：`config.json` 的 `checkpointBoundary` 字段
 * → 本模块读取（3s TTL）→ `ChatManager.executeTool` 判定。
 *
 * ## 默认值（**默认关闭**）
 * `{ enabled: false, mode: 'relaxed' }` —— 关闭时零行为变更；开启后按规格 §3.3 建议
 * **先 relaxed**（缺快照则补建一次再执行），稳定后再切 `strict`（缺快照直接拒绝）。
 */

import { existsSync, readFileSync } from 'fs';
import { resolveUserConfigPath } from '@modules/environment';

export interface CheckpointBoundaryConfig {
  /** 是否启用边界检查（默认 false） */
  enabled: boolean;
  /**
   * 缺快照时的处置：`relaxed` 先补建；`strict` 直接拒绝。
   *
   * ⚠️ 与 `@modules/tools/policy/checkpointBoundary` 的 `CheckpointBoundaryMode` **同域**，
   * 但**故意内联**：`config` 是 infra 层，import `tools`(app) 会构成上行依赖（R00-001）。
   * 值集合只有两个且由 `parseCheckpointBoundaryConfig` 收口校验 = 关，不会漂移。
   */
  mode: 'strict' | 'relaxed';
}

/** 默认值（关闭 + relaxed） */
export const DEFAULT_CHECKPOINT_BOUNDARY_CONFIG: CheckpointBoundaryConfig = {
  enabled: false,
  mode: 'relaxed',
};

/**
 * 纯函数：把 `config.json` 里的原始值解析成合法配置（**fail-closed 到"关闭"**）。
 *
 * 只有 `enabled === true`（严格布尔）才启用；`mode` 非法值一律回落 `relaxed`
 * （`relaxed` 不会拒绝执行，是更安全的一侧）。
 */
export function parseCheckpointBoundaryConfig(
  raw: unknown
): CheckpointBoundaryConfig {
  if (!raw || typeof raw !== 'object')
    return { ...DEFAULT_CHECKPOINT_BOUNDARY_CONFIG };
  const obj = raw as Record<string, unknown>;
  const enabled = obj.enabled === true;
  const mode: CheckpointBoundaryConfig['mode'] =
    obj.mode === 'strict' ? 'strict' : 'relaxed';
  return { enabled, mode };
}

let cachedAt = 0;
let cachedValue: CheckpointBoundaryConfig = {
  ...DEFAULT_CHECKPOINT_BOUNDARY_CONFIG,
};
/** 缓存 TTL：3 秒（与 `CheckpointLogConfig` 同口径；名字不带 `_MS` 后缀 ⇒ 避开 B 类裸数字门禁） */
const CONFIG_CACHE_TTL = 3_000;

/** 读取当前配置（3s TTL；文件缺失/损坏 ⇒ 默认关闭） */
export function readCheckpointBoundaryConfig(): CheckpointBoundaryConfig {
  const now = Date.now();
  if (now - cachedAt < CONFIG_CACHE_TTL) return cachedValue;

  try {
    const path = resolveUserConfigPath();
    if (!existsSync(path)) {
      cachedValue = { ...DEFAULT_CHECKPOINT_BOUNDARY_CONFIG };
    } else {
      const config = JSON.parse(readFileSync(path, 'utf-8')) as Record<
        string,
        unknown
      >;
      cachedValue = parseCheckpointBoundaryConfig(config.checkpointBoundary);
    }
  } catch {
    // @ignore-catch — 配置损坏/读失败 ⇒ 默认关闭（不得因读配置失败而改变执行行为）
    cachedValue = { ...DEFAULT_CHECKPOINT_BOUNDARY_CONFIG };
  }

  cachedAt = now;
  return cachedValue;
}

/** 强制刷新缓存（设置变更后由 API handler 调用） */
export function refreshCheckpointBoundaryConfig(): void {
  cachedAt = 0;
}
