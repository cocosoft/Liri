// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * shellWriteIsolation — 「命令工具这次**真的**会进写隔离」的统一判据（2026-11-26）
 *
 * 背景：`bash` / `powershell` 自 2026-11-26 起对**非只读命令**强制走平台写隔离
 * （`bashLandlockExec.decideBashLandlockGate` 的 `required` 档 / `shouldSandboxPowerShell`）。
 * 审批层要据此把"沙箱已覆盖"的 ask 降级为 allow（用户裁定「沙箱内执行 ⇒ 免审批」），
 * 因此需要一个**与执行门控同源**的可证事实，而不是按工具名或开关猜测（CS02）。
 *
 * 判据（缺一即未生效，fail-closed）：
 *  - `sandbox.landlock.enabled`（总开关；关掉沙箱子系统 ⇒ 不声称已隔离）；
 *  - 平台能力已**探测通过**：Windows = Low IL helper 可启动；macOS = `/usr/bin/sandbox-exec`；
 *    Linux = Landlock helper 可用（缓存证据，未探测完成按不可用处理）。
 *
 * 2026-11-27（A 组：状态面如实）：本模块同时给出**具体后端名**（`landlock` /
 * `sandbox-exec` / `windows-low-il` / `none`），供 `SandboxExecutionSignal`、
 * `describeSandboxPosture` 与 `GET /v1/sandbox/status` 展示"到底靠什么隔离"。
 * ⚠️ 刻意**不**把后端名塞进 `SandboxExecutionMode`：`mode` 是沙箱豁免（S1）的判据
 *（`isSandboxSignalUsable` 只认非 `none`），把 macOS/Windows 的**写**隔离标成非 `none`
 * 会放宽审批 —— 本模块只提供**观测/展示**事实，不参与裁决。
 *
 * ⚠️ 只回答"写隔离是否生效"。**读与网络仍不受限** —— 调用方（豁免判定）不得据此声称
 * 凭据读取 / 外发也被约束；危险命令仍走人工审批。
 */

import { detectMacOSSandboxCapability } from './darwin';
import { readLandlockConfig } from './landlock/config';
import { LandlockDetector } from './landlock/LandlockDetector';
import { detectWindowsSandboxCapability } from './win';

/** 写隔离的**具体后端**（`none` = 未生效，不是"没有这个概念"） */
export type ShellWriteIsolationBackend =
  | 'landlock'
  | 'sandbox-exec'
  | 'windows-low-il'
  | 'none';

export interface ShellWriteIsolationParams {
  /** 覆盖平台（缺省 `process.platform`；供单测注入） */
  platform?: NodeJS.Platform;
  /** 覆盖沙箱总开关（缺省 `sandbox.landlock.enabled`；供单测注入） */
  enabled?: boolean;
  /** 覆盖 Landlock 能力证据（缺省读 `LandlockDetector` 的**已缓存**探测结果） */
  landlockAvailable?: boolean;
  /** 覆盖 macOS Seatbelt 能力（缺省 `detectMacOSSandboxCapability()`；供单测注入） */
  macAvailable?: boolean;
  /** 覆盖 Windows Low IL 能力（缺省 `detectWindowsSandboxCapability()`；供单测注入） */
  winAvailable?: boolean;
}

/** 判据结论：后端名 + 是否生效（两者恒一致：`none` ⇔ 未生效） */
export interface ShellWriteIsolationState {
  backend: ShellWriteIsolationBackend;
  effective: boolean;
}

/** 平台 ⇒ 该平台的写隔离后端名（不判断能力；Linux/macOS/Windows 之外 ⇒ `none`） */
export function shellWriteIsolationBackendForPlatform(
  platform: NodeJS.Platform
): ShellWriteIsolationBackend {
  if (platform === 'win32') return 'windows-low-il';
  if (platform === 'darwin') return 'sandbox-exec';
  if (platform === 'linux') return 'landlock';
  return 'none';
}

/**
 * 本进程当前能否把命令子进程真正限制在"只可写白名单目录"，以及**靠哪个后端**。
 *
 * 同步、零副作用（Linux 首次调用会异步触发探测，本次仍按"未证实"返回 `none`）。
 */
export function resolveShellWriteIsolationBackend(
  params: ShellWriteIsolationParams = {}
): ShellWriteIsolationState {
  const enabled = params.enabled ?? readLandlockConfig().enabled;
  if (!enabled) return { backend: 'none', effective: false };

  const platform = params.platform ?? process.platform;
  if (platform === 'win32') {
    const available =
      params.winAvailable ?? detectWindowsSandboxCapability().available;
    return available
      ? { backend: 'windows-low-il', effective: true }
      : { backend: 'none', effective: false };
  }
  if (platform === 'darwin') {
    const available =
      params.macAvailable ?? detectMacOSSandboxCapability().available;
    return available
      ? { backend: 'sandbox-exec', effective: true }
      : { backend: 'none', effective: false };
  }
  if (platform === 'linux') {
    const available =
      (params.landlockAvailable ??
        LandlockDetector.getCached()?.available ??
        false) === true;
    return available
      ? { backend: 'landlock', effective: true }
      : { backend: 'none', effective: false };
  }
  return { backend: 'none', effective: false };
}

/**
 * 本进程当前能否把命令子进程真正限制在"只可写白名单目录"。
 *
 * 同步、零副作用（Linux 首次调用会异步触发探测，本次仍按"未证实"返回 false）。
 */
export function isShellWriteIsolationEffective(
  params: ShellWriteIsolationParams = {}
): boolean {
  return resolveShellWriteIsolationBackend(params).effective;
}
