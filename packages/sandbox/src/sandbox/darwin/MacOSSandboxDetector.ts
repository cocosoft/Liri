// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * macOS Seatbelt（`sandbox-exec`）能力探测（2026-10-26，方案见
 * `.trae/specs/macos-sandbox-exec.md`）。
 *
 * 门控口径与 `LandlockDetector` 一致：
 * - 平台不是 darwin ⇒ 不可用（不缓存，避免污染）；
 * - 平台是 darwin ⇒ 只认 `/usr/bin/sandbox-exec` **存在**这一条硬事实（不猜版本）；
 * - 结果缓存：系统工具在进程生命周期内不会出现/消失，避免每条命令都查一次 fs。
 *
 * ⚠️ Apple 已把 `sandbox-exec` 标记为 deprecated（仍是系统自带工具）。这里**不做版本判断**：
 * 只要文件不在，就按不可用处理 ⇒ 上层 fail-closed 拒绝执行（不静默降级）。
 */
import { existsSync } from 'node:fs';

/** 系统自带的 Seatbelt 启动器（绝对路径，避免 PATH 劫持） */
export const MACOS_SANDBOX_EXEC_PATH = '/usr/bin/sandbox-exec';

export interface MacOSSandboxCapability {
  available: boolean;
  /** 不可用原因（给上层拼 fail-closed 文案） */
  reason?: string;
  /** 可用时的绝对路径 */
  path?: string;
}

let cached: MacOSSandboxCapability | null = null;

/**
 * 探测 macOS Seatbelt 可用性（同步 + 缓存）。
 *
 * @param options.platform 测试可注入；默认 `process.platform`
 * @param options.pathExists 测试可注入；默认 `fs.existsSync`
 */
export function detectMacOSSandboxCapability(
  options: {
    platform?: NodeJS.Platform;
    pathExists?: (path: string) => boolean;
  } = {}
): MacOSSandboxCapability {
  const platform = options.platform ?? process.platform;
  if (platform !== 'darwin') {
    return { available: false, reason: `非 macOS 平台（${platform}）` };
  }
  if (cached) return cached;

  const pathExists = options.pathExists ?? existsSync;
  cached = pathExists(MACOS_SANDBOX_EXEC_PATH)
    ? { available: true, path: MACOS_SANDBOX_EXEC_PATH }
    : {
        available: false,
        reason: `未找到 ${MACOS_SANDBOX_EXEC_PATH}（系统未提供 Seatbelt 工具）`,
      };
  return cached;
}

/** 测试用：清空缓存 */
export function clearMacOSSandboxCapabilityCache(): void {
  cached = null;
}
