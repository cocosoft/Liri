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
import { resolveShellWriteIsolationBackend } from './shellWriteIsolation';
import type {
  ShellWriteIsolationBackend,
  ShellWriteIsolationCapability,
} from './shellWriteIsolation';

/**
 * fail-open 风险的**语言中立编码**（A5-①，2026-11-05）。
 *
 * 前端按编码取 i18n 文案；后端仍保留人类可读 `openRisks` 供日志使用
 * （CS02：判别值不用文案，避免切语言/改文案后判别失效）。
 */
export type SandboxRiskCode =
  | 'mode-none'
  | 'landlock-fail-open'
  // 2026-11-26：非只读命令本应强制写隔离，但本机能力未就绪 / 总开关关闭 ⇒ 降级普通执行
  | 'landlock-bash-disabled';

/**
 * bash 是否受 OS 级隔离，以及原因（语言中立；前端按此取文案）
 *
 * 2026-11-07（方案 §10）：Windows 已支持 bash 写隔离（Low IL + 临时完整性标签）⇒
 * 不再有「平台不支持」这一态，改为区分「开关没开」（`windows-switch-off`）与「Windows 已开启」
 * （`windows-enforced`，前端据此说明"执行期间临时改标签、执行后恢复"）。
 */
export type BashSandboxReason =
  | 'enforced'
  | 'windows-enforced'
  | 'switch-off'
  | 'windows-switch-off';

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
  /**
   * 2026-11-26（用户裁定）：**命令工具的写隔离是否真的生效**。
   *
   * `true` = 非只读命令会被强制在平台写隔离内执行（Windows Low IL / macOS Seatbelt /
   * Linux Landlock），且满足条件时不再弹审批卡；`false` = 能力未就绪或总开关关闭 ⇒
   * 非只读命令降级普通执行（保留审批卡）。
   */
  shellWriteIsolated: boolean;
  /**
   * 2026-11-27（A 组）：写隔离的**具体后端**（`none` = 未生效）。
   *
   * 与 `shellWriteIsolated` 同源：`none` ⇔ `false`。供状态页/日志如实说明
   * "靠 Landlock / Seatbelt / Low IL 隔离"，而不是把 macOS/Windows 显示成"没隔离"。
   */
  shellWriteIsolation: ShellWriteIsolationBackend;
  /**
   * 2026-11-27（A 组）：平台沙箱的**能力探测细节**（可用性 / 原因码 / 人类可读原因 /
   * Windows `--probe` 结论）。
   *
   * 与 `shellWriteIsolation` 正交：后者回答"现在生效吗"，这里回答"为什么没生效"
   *（且**不看总开关** —— 总开关见 `landlock.enabled`）。
   */
  capabilities: ShellWriteIsolationCapability;
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
  /** 仅供单测注入（缺省读 `isShellWriteIsolationEffective()`） */
  shellWriteIsolated?: boolean;
  /** 仅供单测注入（缺省读 `resolveShellWriteIsolationBackend()`） */
  shellWriteIsolation?: ShellWriteIsolationBackend;
  /** 仅供单测注入（缺省用同一次能力探测的 `capability`） */
  capabilities?: ShellWriteIsolationCapability;
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
    ? platform === 'win32'
      ? 'windows-enforced'
      : 'enforced'
    : platform === 'win32'
      ? 'windows-switch-off'
      : 'switch-off';

  /**
   * 2026-11-27（A 组）：写隔离的**后端名**（`none` ⇔ 未生效）。
   *
   * 与布尔值同源（一次判定），让状态页/日志能说清"是 Landlock 还是 Seatbelt 还是 Low IL"
   *（此前 macOS/Windows 的写隔离在状态页里一律看起来像"没隔离"）。
   */
  const shellWriteState = resolveShellWriteIsolationBackend({ platform });
  const shellWriteIsolated =
    overrides.shellWriteIsolated ?? shellWriteState.effective;
  const shellWriteIsolation =
    overrides.shellWriteIsolation ?? shellWriteState.backend;
  const capabilities = overrides.capabilities ?? shellWriteState.capability;

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
  if (!shellWriteIsolated) {
    // 2026-11-26（用户裁定）：非只读命令**本应**强制进写隔离；此处报的是"没做到"的真实原因
    //（能力未就绪 / 总开关关闭 ⇒ 降级普通执行，仍保留审批卡）。
    openRisks.push(
      '命令执行（bash / powershell）：本机写隔离未生效（平台能力未就绪或沙箱总开关关闭）⇒ 非只读命令降级普通执行，并保留审批卡'
    );
    openRiskCodes.push('landlock-bash-disabled');
  }

  return {
    mode,
    permissionLevel,
    bashSandboxReason,
    landlock,
    shellWriteIsolated,
    shellWriteIsolation,
    capabilities,
    openRisks,
    openRiskCodes,
  };
}
