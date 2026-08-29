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
 * MCP 配置热重载（§3.1 关联点3）
 *
 * MCP 服务器配置变更纳入 ConfigReloader 字段级对账范围：
 * - filePatterns 匹配三层配置：~/.pyapp/mcp.json、~/.pyapp/user/mcp.json、{project}/.mcp.json
 * - reload 仅重载配置内存（EnhancedMCPConfigManager.loadConfigs），
 *   服务器重连/工具刷新由 MCP 连接生命周期与 MCPToolBridge 各自负责，不在对账范围。
 *
 * 接线（2026-08-15）：`initMCPConfigReload()` 在 MCPSystem.initialize() 调用，
 * 启动 ConfigWatcher 监听 MCP 三层配置目录并注册 mcp-config target，
 * 配置变更经 diff 对账（无实质变化跳过）后重载配置内存。
 */
import { join } from 'path';
import { mkdirSync } from 'fs';
import {
  enhancedMcpConfigManager,
  EnhancedMCPConfigManager,
} from './EnhancedMCPConfigManager';
import { ConfigReloader } from '@modules/config';
import type { ConfigReloadTarget } from '@modules/config';
import { resolvePyappHome, resolveProjectRoot } from '@modules/core/paths';

/** 匹配 MCP 三层配置文件（Windows/Unix 路径分隔符兼容） */
const MCP_CONFIG_PATTERNS: RegExp[] = [/[\\/]mcp\.json$/, /[\\/]\.mcp\.json$/];

/**
 * 生成 MCP 配置对账 target（供 ConfigReloader 注册）。
 * @param manager 可注入配置管理器（测试用），默认全局单例
 */
export function createMCPConfigReloadTarget(
  manager: Pick<
    EnhancedMCPConfigManager,
    'loadConfigs'
  > = enhancedMcpConfigManager
): ConfigReloadTarget {
  return {
    name: 'mcp-config',
    filePatterns: MCP_CONFIG_PATTERNS,
    priority: 300,
    async reload() {
      await manager.loadConfigs();
    },
  };
}

let reloader: ConfigReloader | undefined;

/**
 * 启动 MCP 配置热重载（幂等）。
 * 监听三层配置所在目录（顶层文件变更，非递归），注册 mcp-config target；
 * 目录不存在时 watch 失败仅 warning，不阻断 MCP 初始化。
 */
export function initMCPConfigReload(): void {
  if (reloader) return;
  reloader = new ConfigReloader();
  reloader.registerTarget(createMCPConfigReloadTarget());
  // L-7：~/.pyapp/user 是 MCP 用户配置（mcp.json）的合法目录，启动前确保存在，
  // 避免 watch 因 ENOENT 失败（每次启动产生警告噪音且 mcp.json 无法热加载）
  const userDir = join(resolvePyappHome(), 'user');
  mkdirSync(userDir, { recursive: true });
  reloader.start([resolvePyappHome(), userDir, resolveProjectRoot()]);
}
