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

import { getLogger } from '@modules/monitoring';
import type { VfsConfig } from '@modules/config';

const logger = getLogger('vfs:wiring');

/**
 * 从配置构建的挂载计划（`buildMountPlan` 纯函数产物）。
 *
 * `warnings` 不在此处打印（保持纯函数可单测）—— 由 `registerVfsMounts` 逐条记 WARN。
 */
export interface VfsMountPlan {
  /** 是否注册 `dev_docs` 挂载点 */
  readonly registerDevDocs: boolean;
  /**
   * `mcp` 挂载点的允许服务器清单：
   * - `null` ⇒ **不注册** `mcp`（显式配置了 `mounts` 但无有效 mcp 条目）；
   * - `undefined` ⇒ 注册且**不限定** server（未配置 `vfs` 时的既有行为）；
   * - 数组 ⇒ 注册且仅允许清单内 server。
   */
  readonly mcpAllowedServers: readonly string[] | null | undefined;
  /** 被跳过的配置条目说明（装配面据此记 WARN，**不**静默降级） */
  readonly warnings: readonly string[];
}

/**
 * 从 `vfs` 配置构建挂载计划（**纯函数**，便于单测）。
 *
 * - 未配置（无 `vfs` 段，或 `mounts` 缺省）⇒ **保持现状**：`dev_docs` + `mcp`（不限 server）；
 * - 已配置 `mounts` ⇒ **严格按清单**：未知 scheme / `mcp` 缺 `server` ⇒ 跳过 + WARN。
 */
export function buildMountPlan(vfs: VfsConfig | undefined): VfsMountPlan {
  const mounts = vfs?.mounts;
  // 未配置 ⇒ 行为零变更（不破坏既有只读试点）
  if (!mounts) {
    return {
      registerDevDocs: true,
      mcpAllowedServers: undefined,
      warnings: [],
    };
  }

  const warnings: string[] = [];
  let registerDevDocs = false;
  const mcpServers: string[] = [];

  for (const entry of mounts) {
    // 配置来自用户 JSON ⇒ 运行时按 string 校验（类型联合不阻止非法值）
    const scheme: string = entry.scheme;
    if (scheme !== 'dev_docs' && scheme !== 'mcp') {
      warnings.push(
        `vfs.mounts 中的未知 scheme "${String(entry.scheme)}"，已跳过该条目`
      );
      continue;
    }
    // `enabled` 缺省视为 true；显式 false ⇒ 用户主动停用，静默跳过
    if (entry.enabled === false) continue;

    if (scheme === 'dev_docs') {
      registerDevDocs = true;
      continue;
    }

    // scheme === 'mcp'：必须有非空 server
    const server = typeof entry.server === 'string' ? entry.server.trim() : '';
    if (!server) {
      warnings.push('vfs.mounts 中的 mcp 条目缺少 server，已跳过该条目');
      continue;
    }
    mcpServers.push(server);
  }

  return {
    registerDevDocs,
    // 允许清单为空 ⇒ 不注册 mcp（不回退为"不限 server"）
    mcpAllowedServers: mcpServers.length > 0 ? mcpServers : null,
    warnings,
  };
}

/**
 * 注册 VFS 挂载点（按 `~/.pyapp/config.json` 的 `vfs` 段）。
 *
 * 幂等：若同名 scheme 已注册（如热重载后重复调用）则跳过 —— 注册表本身对**重复 scheme**
 * 明确抛错（`VFS_CONFLICT`），本装配面据此先探测，避免把幂等装配变成启动失败。
 */
export async function registerVfsMounts(): Promise<void> {
  const { configManager } = await import('@modules/config');
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
