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
 * AI-VFS 装配（**组合根**）。
 *
 * - 2026-10-08「AI-VFS 只读试点」（`.trae/specs/ai-vfs-readonly-pilot.md` v1.1）；
 * - 2026-10-08「用户可配置挂载面（T3 完整体）」（`.trae/specs/ai-vfs-user-mountable.md`）：
 *   改为读 `~/.pyapp/config.json` 的 `vfs` 段决定挂载点（**挂载点即用户面契约**）。
 *
 * 为什么放在 `entrypoints/`：挂载点→驱动的映射是**部署期装配事实**，不是业务逻辑；
 * 由组合根集中注册（同 `entrypoints/spiWiring.ts` 的手法）⇒ 业务模块内**不自建**注册表
 * （`VfsMountRegistry` 为唯一注册面）。`vfs` 与 `tools` 同属 app 层，此处动态导入
 * ⇒ 与 `main.ts` 的启动时机不变。
 *
 * 时机：在 `bootstrap()` 的 SPI 注入点（`main.ts` 的 `registerSpis` 回调）调用 ⇒
 * **早于任何工具执行**（`read_vfs` / `list_vfs` / `stat_vfs` 依赖挂载已注册）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import type { VfsConfig } from '@openliri/infra/config';
// 2026-11-24（R00-003 下沉）：纯推导已移到 infra `config/vfsMountPlan`（service 层 handler 需静态引用）
import { buildMountPlan } from '@openliri/infra/config/vfsMountPlan';

const logger = getLogger('vfs:wiring');

/**
 * 注册 VFS 挂载点（按 `~/.pyapp/config.json` 的 `vfs` 段）。
 *
 * 幂等：若同名 scheme 已注册（如热重载后重复调用）则跳过 —— 注册表本身对**重复 scheme**
 * 明确抛错（`VFS_CONFLICT`），本装配面据此先探测，避免把幂等装配变成启动失败。
 */
export async function registerVfsMounts(): Promise<void> {
  const { configManager } = await import('@openliri/infra/config');
  const plan = buildMountPlan(configManager.getValue<VfsConfig>('vfs'));
  for (const warning of plan.warnings) {
    logger.warn(warning);
  }

  const { vfsMountRegistry, DevDocsDriver, McpResourcesDriver } =
    await import('@modules/vfs');
  if (plan.registerDevDocs && !vfsMountRegistry.has('dev_docs')) {
    vfsMountRegistry.registerMount('dev_docs', new DevDocsDriver());
  }
  // `mcp://` 只读挂载（MCP 资源面并存面；工具面事实源仍是 `mcp_resource`）
  if (plan.mcpAllowedServers !== null && !vfsMountRegistry.has('mcp')) {
    vfsMountRegistry.registerMount(
      'mcp',
      // `undefined` = 不限定 server（未配置时的既有行为）
      new McpResourcesDriver(undefined, plan.mcpAllowedServers)
    );
  }
}
