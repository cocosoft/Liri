/**
 * 沙箱违规记录的**唯一写入口**（G4 围栏 M0-①，2026-11-12）
 *
 * 背景：`SandboxManager.recordViolation()` 此前**全仓零调用** ⇒ `violationCount` 恒 0，
 * 围栏（G4）任何"违规上升"规则永不触发。本模块把"谁算违规"收敛为一个显式入口，
 * 供各平台的沙箱拒绝点调用（bash / code_run / PowerShell 的 Windows 写越界）。
 *
 * 边界：只写内存观测面（`SandboxManager.violations`），**不**参与 allow/ask/deny 判定，
 * 也**不**改变执行结果；写入失败不得影响命令语义（故内部降级）。
 */
import { handleError } from '@openliri/infra/error/handleError';

import { SandboxManager } from './SandboxManager';

/**
 * 违规类型（语言中立编码，供围栏规则判别；禁止用文案判别，CS02）
 *
 * - `write-denied`：沙箱拦截了写入（Landlock / Windows Low IL / MIC 拒绝）
 * - `init-failed`：沙箱初始化失败且按 `failClosed` 拒绝执行（无隔离证据的执行被挡下）
 */
export type SandboxViolationKind = 'write-denied' | 'init-failed';

/**
 * 记录一条沙箱违规（失败仅记录错误，不影响调用方）。
 *
 * @param kind 语言中立类型编码
 * @param message 人类可读说明（取证展示用）
 * @param details 结构化补充信息（如命令预览、平台模式）；**不要**放密钥/完整命令
 */
export function recordSandboxViolation(
  kind: SandboxViolationKind,
  message: string,
  details?: Record<string, unknown>
): void {
  try {
    SandboxManager.getInstance().recordViolation({
      type: kind,
      message,
      ...(details ? { details } : {}),
    });
  } catch (error) {
    // @ignore-catch — 观测面写入失败不得改变命令语义（判定与执行是另一条链路）
    void handleError(error, {
      module: 'sandbox:violations',
      action: 'record_sandbox_violation',
      context: { kind },
    });
  }
}
