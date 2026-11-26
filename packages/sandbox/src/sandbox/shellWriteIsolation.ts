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
 * 判据（缺一即 false，fail-closed）：
 *  - `sandbox.landlock.enabled`（总开关；关掉沙箱子系统 ⇒ 不声称已隔离）；
 *  - 平台能力已**探测通过**：Windows = Low IL helper 可启动；macOS = `/usr/bin/sandbox-exec`；
 *    Linux = Landlock helper 可用（缓存证据，未探测完成按不可用处理）。
 *
 * ⚠️ 只回答"写隔离是否生效"。**读与网络仍不受限** —— 调用方（豁免判定）不得据此声称
 * 凭据读取 / 外发也被约束；危险命令仍走人工审批。
 */

import { detectMacOSSandboxCapability } from './darwin';
import { readLandlockConfig } from './landlock/config';
import { LandlockDetector } from './landlock/LandlockDetector';
import { detectWindowsSandboxCapability } from './win';

export interface ShellWriteIsolationParams {
  /** 覆盖平台（缺省 `process.platform`；供单测注入） */
  platform?: NodeJS.Platform;
  /** 覆盖 Landlock 能力证据（缺省读 `LandlockDetector` 的**已缓存**探测结果） */
  landlockAvailable?: boolean;
}

/**
 * 本进程当前能否把命令子进程真正限制在"只可写白名单目录"。
 *
 * 同步、零副作用（Linux 首次调用会异步触发探测，本次仍按"未证实"返回 false）。
 */
export function isShellWriteIsolationEffective(
  params: ShellWriteIsolationParams = {}
): boolean {
  const config = readLandlockConfig();
  if (!config.enabled) return false;

  const platform = params.platform ?? process.platform;
  if (platform === 'win32') return detectWindowsSandboxCapability().available;
  if (platform === 'darwin') return detectMacOSSandboxCapability().available;
  if (platform === 'linux') {
    return (
      (params.landlockAvailable ??
        LandlockDetector.getCached()?.available ??
        false) === true
    );
  }
  return false;
}
