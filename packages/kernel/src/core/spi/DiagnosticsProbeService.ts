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
 * 诊断采集 SPI（core 层端口）—— 2026-09-30 台账 D-123（`R00-003` P4 / G3）
 *
 * **问题**：`diagnostics`（**infra** 层）的健康检查需**拉取** service 层注册表 ——
 * `services/mcp`（MCP 服务器/工具计数）· `services/voice`（STT/TTS provider 列表）·
 * `channels`（通道名列表）⇒ 构成 `infra -> service` 倒挂（`R00-003` 盲区）。
 *
 * **方案**：与 `LoggerService` / `OTelService` / `ProfilerService` / `BroadcastService` /
 * `PluginSystemService` **同构**的 SPI —— core 定义**只读快照**端口与**转发代理**；
 * 实现在 `registerDiagnosticsProbeSpi()`（组合根缝）内**动态导入**三个 provider 后注入
 * ⇒ `diagnostics` 只依赖 `core/spi`（infra → core 合法），不再产生跨层引用。
 *
 * **未注册时**：返回**空快照**（与各消费点既有 `catch → []` / "未初始化"分支语义一致）。
 *
 * **⚠️ 为什么是"采集端口"而非"推送模型"**：本端口如实反映现状（观测者**拉取**）。
 * 更彻底的形态是让各 provider **主动推送**健康数据（见 spec §3.17.10 的后续项），
 * 但那需要三方改动；本端口先把跨层引用收敛到 `core/spi`，为后续推送化留出接口。
 */

/** 提供方快照（`diagnostics` 的 `providers-status` 检查所需字段） */
export interface DiagnosticsProvidersSnapshotDto {
  sttProviders: string[];
  ttsProviders: string[];
  channelNames: string[];
}

/** MCP 快照（启动健康报告所需字段） */
export interface DiagnosticsMcpSnapshotDto {
  serverCount: number;
  toolCount: number;
}

/** 诊断采集端口（core 侧契约；方法均为 app 侧**同步**读取 ⇒ 规则 37） */
export interface IDiagnosticsProbeService {
  getProvidersSnapshot(): DiagnosticsProvidersSnapshotDto;
  getMcpSnapshot(): DiagnosticsMcpSnapshotDto;
}

/** SPI 服务标识符常量 */
export const DIAGNOSTICS_PROBE_SERVICE_ID = 'core.spi.IDiagnosticsProbeService';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerDiagnosticsProbeSpi 在启动时设置。
// infra 层（diagnostics）通过 resolveDiagnosticsProbe() 获取，避免直接 import service 层。
// ---------------------------------------------------------------------------

let _service: IDiagnosticsProbeService | null = null;

const EMPTY_PROVIDERS: DiagnosticsProvidersSnapshotDto = {
  sttProviders: [],
  ttsProviders: [],
  channelNames: [],
};

const EMPTY_MCP: DiagnosticsMcpSnapshotDto = { serverCount: 0, toolCount: 0 };

/** 转发**代理**（延迟绑定，同 `resolveLogger()` 语义；注册前返回空快照） */
const _proxy: IDiagnosticsProbeService = {
  getProvidersSnapshot: () =>
    _service?.getProvidersSnapshot() ?? EMPTY_PROVIDERS,
  getMcpSnapshot: () => _service?.getMcpSnapshot() ?? EMPTY_MCP,
};

/** 获取诊断采集端口（未注册时为空快照） */
export function resolveDiagnosticsProbe(): IDiagnosticsProbeService {
  return _proxy;
}

/**
 * 注册诊断采集 SPI 实现到 DI 容器（**推送模型**）
 *
 * 2026-09-30（台账 D-128，`R00-003` ② 改造）：实现体**由调用方（entry 装配模块）构建后传入** ——
 * 原实现在本文件内动态导入 `services` / `channels` ⇒ 产生 **2 个** `core -> service` 跨层对；
 * 改为推送后**这 2 对消失**。
 *
 * @param container - DI 容器实例
 * @param service - 已构建的端口实现（`entrypoints/spiWiring.ts`）
 */
export async function registerDiagnosticsProbeSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IDiagnosticsProbeService
): Promise<void> {
  _service = service;

  container.registerDescriptor<IDiagnosticsProbeService>({
    id: DIAGNOSTICS_PROBE_SERVICE_ID,
    factory: () => service,
    scope: 'singleton',
  });
}
