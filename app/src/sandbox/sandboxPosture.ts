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
} from '@openliri/infra/utils/toolContract/Tool';

import { readLandlockConfig } from './landlock/config';
import { LandlockDetector } from './landlock/LandlockDetector';
import { resolveSandboxExecutionSignal } from './sandboxExecutionSignal';

/**
 * fail-open 风险的**语言中立编码**（A5-①，2026-11-05）。
 *
 * 前端按编码取 i18n 文案；后端仍保留人类可读 `openRisks` 供日志使用
 * （CS02：判别值不用文案，避免切语言/改文案后判别失效）。
 */
export type SandboxRiskCode =
  | 'mode-none'
  | 'landlock-fail-open'
  | 'landlock-bash-disabled'
  // P2（2026-11-07）：Windows 上 bash 无法做 OS 级隔离（Low IL 需改工作区 ACL）
  | 'bash-sandbox-unsupported';

/** bash 是否受 OS 级隔离，以及原因（语言中立；前端按此取文案） */
export type BashSandboxReason =
  | 'enforced'
  | 'switch-off'
  | 'platform-unsupported';

export interface SandboxPosture {
  /** 当前进程的隔离模式（`none` = 无隔离证据） */
  mode: SandboxExecutionMode;
  permissionLevel: SandboxPermissionLevel;
  /**
   * P2（2026-11-07）：bash 的隔离状态原因。
   * `platform-unsupported` = 本平台无法隔离（Windows：需给工作区改 ACL），
   * 与"用户没开开关"（`switch-off`）必须区分，否则会被误读成"开一下就好"。
   */
  bashSandboxReason: BashSandboxReason;
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
  /** 同上的语言中立编码（前端 i18n 用；与 `openRisks` 一一对应） */
  openRiskCodes: SandboxRiskCode[];
}

export interface DescribeSandboxPostureOverrides {
  mode?: SandboxExecutionMode;
  permissionLevel?: SandboxPermissionLevel;
  landlock?: Partial<SandboxPosture['landlock']>;
  /** 仅供单测注入（默认 `process.platform`） */
  platform?: NodeJS.Platform;
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

  const platform = overrides.platform ?? process.platform;
  const bashSandboxReason: BashSandboxReason = landlock.bashEnabled
    ? 'enforced'
    : platform === 'win32'
      ? 'platform-unsupported'
      : 'switch-off';

  const openRisks: string[] = [];
  const openRiskCodes: SandboxRiskCode[] = [];
  if (mode === 'none') {
    openRisks.push('当前进程无隔离证据（mode=none）：本次执行不受内核级约束');
    openRiskCodes.push('mode-none');
  }
  if (!landlock.failClosed) {
    openRisks.push(
      'landlock.failClosed=false：helper 初始化失败或能力缺失时，会回退到无内核约束的执行器'
    );
    openRiskCodes.push('landlock-fail-open');
  }
  if (bashSandboxReason === 'platform-unsupported') {
    // P2（2026-11-07）：Windows 上不是"开关没开"，而是 Low IL 需要给工作区改 ACL
    // （残留/并发污染），v1 明确不做；必须如实区分，避免用户以为打开开关就受保护。
    openRisks.push(
      'Windows 无法对 bash 做 OS 级隔离：Low IL 沙箱需要给工作区改 ACL（按 2026-11-07 决策不改用户仓库）'
    );
    openRiskCodes.push('bash-sandbox-unsupported');
  } else if (!landlock.bashEnabled) {
    openRisks.push('landlock.bashEnabled=false：bash 工具默认不在沙箱内执行');
    openRiskCodes.push('landlock-bash-disabled');
  }

  return {
    mode,
    permissionLevel,
    bashSandboxReason,
    landlock,
    openRisks,
    openRiskCodes,
  };
}
