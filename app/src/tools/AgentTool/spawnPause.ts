// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * 子代理 spawn 暂停开关（方案 §5 可选项 E2，对标 Hermes `set_spawn_paused`/`is_spawn_paused`）
 *
 * **语义精确区分两件事**（这是本开关的全部价值）：
 * - **阻断新 spawn** —— 暂停期间 `AgentTool` 的新委派**一律拒绝**（fail-closed，错误信息说明原因）；
 * - **在途继续跑** —— **不**取消、不中止任何已启动的子代理（那是 `stopAgent` 的职责）。
 *
 * 典型场景：委派数量/成本失控时的人工刹车 —— 既不再放大，又不打断已在进行的工作。
 *
 * 状态为**进程内运行时开关**（刻意**不落盘**）：进程重启即回到"未暂停"，
 * 避免"忘记恢复 ⇒ 长期无法委派"这一比暂停本身更糟的后果。
 *
 * 依赖仅为模块级状态（无 IO、无 DB）⇒ 可独立单测。
 */

import { getLogger } from '@modules/monitoring';

const logger = getLogger('tools:AgentTool:spawnPause');

let paused = false;
let pausedReason: string | null = null;
let changedAt: number | null = null;

export interface SpawnPauseState {
  paused: boolean;
  /** 暂停原因（暂停时提供，便于排障"谁按的刹车、为什么"） */
  reason?: string;
  /** 最近一次状态变更时间戳 */
  changedAt?: number;
}

/** 切换暂停状态（传 `reason` 便于审计与错误信息） */
export function setSpawnPaused(
  next: boolean,
  reason?: string
): SpawnPauseState {
  paused = next;
  pausedReason = next ? (reason ?? '未提供原因') : null;
  changedAt = Date.now();
  logger.warn(
    next ? '子代理 spawn 已暂停（在途不受影响）' : '子代理 spawn 已恢复',
    {
      reason: pausedReason,
    }
  );
  return getSpawnPauseState();
}

/** 当前是否暂停（`executeGuard` 的判据） */
export function isSpawnPaused(): boolean {
  return paused;
}

/** 当前状态（供 CLI / 控制面展示） */
export function getSpawnPauseState(): SpawnPauseState {
  return {
    paused,
    ...(pausedReason ? { reason: pausedReason } : {}),
    ...(changedAt !== null ? { changedAt } : {}),
  };
}

/** 复位为未暂停（仅供测试使用，避免用例间状态泄漏） */
export function resetSpawnPause(): void {
  paused = false;
  pausedReason = null;
  changedAt = null;
}
