// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * sandboxPosture — 「本次执行是否受内核级约束」的**人类可读姿态**（issue #7，2026-10-29）
 *
 * 背景：`sandbox.landlock.failClosed` 与 `sandbox.landlock.bashEnabled` 两者默认都是
 * `false`（2026-08-25「兼容优先」的既定决策）。它们不是缺陷，但**最容易被误读**成
 * 「沙箱已开启 ⇒ 受内核级约束」。本模块把「当前姿态 + 由此产生的 fail-open 风险」
 * 收敛成一个纯函数，供启动日志（以及后续健康检查 / 设置页）复用。
 *
 * 只做**描述**：不改变任何 allow / ask / deny 判定，也不改默认值。
 */

import type {
  SandboxExecutionMode,
  SandboxPermissionLevel,
} from '@modules/utils/toolContract/Tool';

import { readLandlockConfig } from './landlock/config';
import { LandlockDetector } from './landlock/LandlockDetector';
import { resolveSandboxExecutionSignal } from './sandboxExecutionSignal';

export interface SandboxPosture {
  /** 当前进程的隔离模式（`none` = 无隔离证据） */
  mode: SandboxExecutionMode;
  permissionLevel: SandboxPermissionLevel;
  /** Landlock 事实（两个默认 fail-open 的开关都在这里） */
  landlock: {
    enabled: boolean;
    bashEnabled: boolean;
    failClosed: boolean;
    /** 能力探测是否已证实可用（未探测完 ⇒ `false`） */
    available: boolean;
  };
  /** 当前姿态下**实际存在**的 fail-open 风险（人类可读；空数组 = 无） */
  openRisks: string[];
}

export interface DescribeSandboxPostureOverrides {
  mode?: SandboxExecutionMode;
  permissionLevel?: SandboxPermissionLevel;
  landlock?: Partial<SandboxPosture['landlock']>;
}

/**
 * 描述当前沙箱姿态。
 *
 * @param overrides 仅供单测注入（不传 ⇒ 全部读真实配置/探测缓存）
 */
export function describeSandboxPosture(
  overrides: DescribeSandboxPostureOverrides = {}
): SandboxPosture {
  const signal = resolveSandboxExecutionSignal();
  const config = readLandlockConfig();

  const mode = overrides.mode ?? signal.mode;
  const permissionLevel = overrides.permissionLevel ?? signal.permissionLevel;
  const landlock = {
    enabled: overrides.landlock?.enabled ?? config.enabled,
    bashEnabled: overrides.landlock?.bashEnabled ?? config.bashEnabled,
    failClosed: overrides.landlock?.failClosed ?? config.failClosed,
    available:
      overrides.landlock?.available ??
      LandlockDetector.getCached()?.available ??
      false,
  };

  const openRisks: string[] = [];
  if (mode === 'none') {
    openRisks.push('当前进程无隔离证据（mode=none）：本次执行不受内核级约束');
  }
  if (!landlock.failClosed) {
    openRisks.push(
      'landlock.failClosed=false：helper 初始化失败或能力缺失时，会回退到无内核约束的执行器'
    );
  }
  if (!landlock.bashEnabled) {
    openRisks.push('landlock.bashEnabled=false：bash 工具默认不在沙箱内执行');
  }

  return { mode, permissionLevel, landlock, openRisks };
}
