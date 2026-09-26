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
 * ⚠️ **实测注记（2026-09-26，如实）**：`enabled` / `failClosed` 目前**只被本模块与桶导出引用**，
 * **没有任何执行路径读取它们** —— `tools/CodeRunner/LinuxSandboxRunner.ts` 是直接
 * `LandlockDetector.detect()` + 不可用即降级，**不看** `enabled`。
 * 即：`sandbox.landlock.enabled=false` **拦不住** `code_run` 走 Landlock 路径。
 * 属"名义契约"，已记入台账待裁定（本次 G1-A 只让 `bashEnabled` 成为**第一个真实消费者**，
 * 未顺带改 code_run 的行为）。
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
