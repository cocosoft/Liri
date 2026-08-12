/**
 * CheckpointLogConfig — 检查点日志门控（共享模块）
 *
 * P2（08-09）：从 config.json 读取 checkpointLog 配置，
 * 替代旧的环境变量 ENABLE_CHECKPOINT_LOG，支持前端 UI 动态开关。
 *
 * 所有检查点模块（PlainTextCheckpoint / StreamingAutoCheckpoint /
 * SessionCheckpointService / DBTAORCheckpointStorage / ChatManager）
 * 统一通过 isCheckpointLogEnabled() 判定是否输出详细日志。
 *
 * 数据流：前端 toggle → configService.set('checkpointLog', true)
 *        → PUT /v1/config/checkpointLog → ConfigManager.setConfigValue()
 *        → config.json 更新 → isCheckpointLogEnabled() 读取（3s TTL）
 */

import { readFileSync, existsSync } from 'fs';
import { resolveUserConfigPath } from '@modules/core';

const CONFIG_PATH = resolveUserConfigPath();

/** 缓存：上次读取的时间戳和值 */
let cachedAt = 0;
let cachedValue = false;
const CACHE_TTL_MS = 3_000; // 3 秒 TTL，平衡实时性与 I/O 开销

/**
 * 读取 config.json 中的 checkpointLog 字段。
 * 带 3 秒 TTL 缓存，避免高频 I/O。
 */
export function isCheckpointLogEnabled(): boolean {
  const now = Date.now();
  if (now - cachedAt < CACHE_TTL_MS) {
    return cachedValue;
  }

  try {
    if (!existsSync(CONFIG_PATH)) {
      cachedValue = false;
    } else {
      const raw = readFileSync(CONFIG_PATH, 'utf-8');
      const config = JSON.parse(raw) as Record<string, unknown>;
      cachedValue = config.checkpointLog === true;
    }
  } catch {
    // 文件损坏或读取失败 → 默认关闭
    cachedValue = false;
  }

  cachedAt = now;
  return cachedValue;
}

/**
 * 强制刷新缓存（设置变更后由 API handler 调用）
 */
export function refreshCheckpointLogConfig(): void {
  cachedAt = 0;
}
