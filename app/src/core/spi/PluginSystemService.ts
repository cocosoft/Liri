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
 * 插件系统 SPI（core 层端口）—— 2026-09-30 台账 D-122（`R00-003` P3 / G5）
 *
 * **问题**：插件系统的读取入口 `pluginSystem.getLoader().getAllPlugins()` 被 **service / infra** 层
 * 直接动态导入（`services/mcp/EnhancedMCPConfigManager` 加载插件声明的 MCP 服务器、
 * `utils/plugins/loadPluginAgents` 加载插件 Agent）⇒ 构成 `service -> app` / `infra -> app` 倒挂
 * （`R00-003` 盲区）。
 * 【2026-10-01 D-149：`loadPluginAgents` 已归位 `agent/utils/loadPluginAgents`，该 `infra -> app` 边已消除】
 *
 * **方案**：与 `LoggerService` / `OTelService` / `ProfilerService` / `BroadcastService` **同构**的 SPI ——
 * core 定义**最小投影**端口与**转发代理**；实现在 `registerPluginSystemSpi()`（组合根缝）内
 * **动态导入** `plugins` 层后注入 ⇒ service / infra 消费方只依赖 `core/spi`，不产生跨层引用。
 *
 * **未注册时**：返回**空列表**（与两处消费方既有的 `catch → []` 语义一致）。
 */

/**
 * 已加载插件的**最小投影**（调用方实际读字段：`name` / `path` / `agentsPaths` / `mcpServers`）。
 * ⚠️ 运行时对象即 app 侧 `LoadedPlugin` ⇒ 需要完整字段的调用方在其边界处收窄。
 */
export interface LoadedPluginBriefDto {
  name: string;
  path: string;
  agentsPaths?: string[] | undefined;
  mcpServers?: Array<Record<string, unknown>> | undefined;
}

/** 插件系统端口（core 侧契约） */
export interface IPluginSystemService {
  /** 已加载插件列表（未注册时为空数组） */
  getLoadedPlugins(): LoadedPluginBriefDto[];
}

/** SPI 服务标识符常量 */
export const PLUGIN_SYSTEM_SERVICE_ID = 'core.spi.IPluginSystemService';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerPluginSystemSpi 在启动时设置。
// service / infra 层代码通过 resolvePluginSystem() 获取，避免直接 import app 层实现。
// ---------------------------------------------------------------------------

let _service: IPluginSystemService | null = null;

/** 转发**代理**（延迟绑定，同 `resolveLogger()` 语义；注册前返回空列表） */
const _proxy: IPluginSystemService = {
  getLoadedPlugins: () => _service?.getLoadedPlugins() ?? [],
};

/** 获取插件系统端口（未注册时为空列表） */
export function resolvePluginSystem(): IPluginSystemService {
  return _proxy;
}

/**
 * 注册插件系统 SPI 实现到 DI 容器
 *
 * 动态导入 app 层实现并注册；此函数**不产生静态跨层依赖**，符合架构分层约束。
 *
 * @param container - DI 容器实例
 */
export async function registerPluginSystemSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IPluginSystemService
): Promise<void> {
  // 2026-09-30（台账 D-129，`R00-003` ② 改造）：实现体改由 **entry** 侧装配模块构建后传入
  _service = service;

  container.registerDescriptor<IPluginSystemService>({
    id: PLUGIN_SYSTEM_SERVICE_ID,
    factory: () => _service as IPluginSystemService,
    scope: 'singleton',
  });
}
