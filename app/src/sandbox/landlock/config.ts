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
 * Landlock 配置（P2，2026-08-25；G1-A 扩展 2026-09-26）
 *
 * 配置键（config.json，点号路径）：
 * - `sandbox.landlock.enabled`  （默认 true）  总开关；关闭则完全走本地执行路径
 * - `sandbox.landlock.failClosed`（默认 false）沙箱初始化失败（exit 125）时拒绝而非回退
 * - `sandbox.landlock.bashEnabled`（默认 **false**）**让 `bash` 工具也走 Landlock 域**（G1-A）
 *
 * 决策：兼容优先（2026-08-25 用户确认）——failClosed 默认 false；
 * 无 Landlock 内核/helper 缺失时始终回退（enabled 仅控制"是否尝试 Landlock 路径"）。
 *
 * ⚠️ **G1-A 新增 `bashEnabled` 且默认 false**：`bash` 是交互式命令通道，Landlock 的 FS 白名单
 * 一旦漏声明用户需要的路径就会**拦掉正常命令**（方案 §4 G1 明确点名"误伤"风险）⇒ 默认关闭、
 * 由用户显式开启；开启后语义见 `tools/bash/bashLandlockExec.ts`（不静默降级）。
 *
 * ✅ **"名义契约"已修复（G1-A2，2026-09-26）；本注记 2026-09-28 更新（原标题已过时）**：
 * 修复前，`enabled` / `failClosed` **只被本模块与桶导出引用、没有任何执行路径读取它们** ——
 * `tools/CodeRunner/LinuxSandboxRunner.ts` 当时是直接 `LandlockDetector.detect()` + 不可用即降级
 * ⇒ `sandbox.landlock.enabled=false` 拦不住 `code_run` 走 Landlock 路径。
 * **现两个开关都有真实消费者**：`LinuxSandboxRunner.runCodeRunnerWithLandlock()` 先读
 * `readLandlockConfig()`（`enabled === false` ⇒ 直接交回跨平台执行器），`failClosed` 决定
 * "exit 125 时**拒绝**还是**降级**"（另见该文件的 `resolveSandboxInitFailure`）；
 * `bashEnabled` 的消费者在 `tools/bash/bashLandlockExec.ts`。
 */
import { configManager } from '@modules/config';

export interface LandlockConfig {
  enabled: boolean;
  failClosed: boolean;
  /**
   * G1-A（2026-09-26）：是否让 **`bash` 工具**在 Landlock 域内执行（默认 `false`）。
   * 仅在 `enabled === true` 时才有意义（总开关关闭 ⇒ 本项不生效）。
   */
  bashEnabled: boolean;
}

/** 默认配置（兼容优先；bash 接入属安全面行为变更 ⇒ 默认关闭） */
export const DEFAULT_LANDLOCK_CONFIG: LandlockConfig = {
  enabled: true,
  failClosed: false,
  bashEnabled: false,
};

/** 纯函数：应用默认值（可单测） */
export function resolveLandlockConfig(
  raw?: Partial<LandlockConfig>
): LandlockConfig {
  return {
    enabled: raw?.enabled ?? DEFAULT_LANDLOCK_CONFIG.enabled,
    failClosed: raw?.failClosed ?? DEFAULT_LANDLOCK_CONFIG.failClosed,
    bashEnabled: raw?.bashEnabled ?? DEFAULT_LANDLOCK_CONFIG.bashEnabled,
  };
}

/** 从 config.json 读取 Landlock 配置 */
export function readLandlockConfig(): LandlockConfig {
  const enabled = configManager.getValue<boolean>('sandbox.landlock.enabled');
  const failClosed = configManager.getValue<boolean>(
    'sandbox.landlock.failClosed'
  );
  const bashEnabled = configManager.getValue<boolean>(
    'sandbox.landlock.bashEnabled'
  );
  return resolveLandlockConfig({ enabled, failClosed, bashEnabled });
}

/**
 * P0-4 ②（2026-10-04）：**评测期**强制 `bash` 走 Landlock 的**意图**开关（由 `evals` CLI 置位）。
 *
 * ⚠️ 仅为**意图**；**真正的 capability 门控**在
 * `tools/bash/bashLandlockExec.decideBashLandlockGate`：
 *   能力可用 ⇒ 走 Landlock；不可用 ⇒ **回退 plain**（**绝不 `refuse`**）——
 *   否则会在无 Landlock 的机器（Windows/macOS/无 helper 的 Linux）上**打断评测**。
 * ⚠️ **需 Linux 真实评测运行验证**：开启后 bash 受 FS 白名单约束，
 *   须确认评测所需路径不被误拒。helper `landlock-run` 源码在**本仓**：
 *   `app/src/sandbox/landlock/native/main.c`（README/build.sh 同目录），仅编译产物不入库。
 * ⚠️ **WSL2 真机复验（2026-10-05）**：门控路由（eval-forced ⇒ landlock）与敏感路径拒绝均正确、
 *   普通命令无误拒；但发现两处**环境相关**缺口 —— ①WSL2 默认未挂载 securityfs ⇒
 *   `LandlockDetector` 的 LSM 预检误判 `not-in-lsm` ⇒ evalForced 静默回退 plain（未真正受限）；
 *   ②WSL2 `/etc/resolv.conf` 为符号链接指向 `/mnt/wsl/resolv.conf`（不在白名单）⇒ 域内 DNS 被拒。
 *   详见 `dev_docs/error_repairs/预存错误与待处理问题.md` 的「P0-4 ② 真机验证」段。
 */
export const ENV_EVAL_BASH_LANDLOCK = 'LIRI_EVAL_BASH_LANDLOCK';

/** 评测期是否**请求**强制 bash 走 Landlock（纯 env 读取，零 IO / 零副作用，可单测） */
export function isEvalBashLandlockForced(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env[ENV_EVAL_BASH_LANDLOCK] === '1';
}
