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
 * SSE 广播 SPI（core 层端口）—— 2026-09-30 台账 D-121（`R00-003` P2 / G1）
 *
 * **问题**：SSE 广播实现位于 `infrastructure/http/LocalHTTPServiceSSE.ts`（**service** 层），
 * 而消费方含 **infra / core** 层 —— `state/**` 三个状态机、`core/loop/PlanDrivenLoop`、
 * `daemon/CronBridge` ⇒ 构成 `infra -> service` / `core -> service` 倒挂
 * （`R00-003` 盲区：其中 **4 处**为动态 `import()`，**1 处**为静态）。
 *
 * ⚠️ T-③05（2026-10-03）：`daemon/CronBridge` **已随死链下线**（台账 D-139）⇒ 上述"1 处静态"
 * 消费方**已不存在**；本 SPI 对余下消费方（state / PlanDrivenLoop）仍然必要。
 *
 * **方案**：与 `LoggerService` / `OTelService` / `ProfilerService` **同构**的 SPI ——
 * core 定义端口与**转发代理**；实现在 `registerBroadcastSpi()`（组合根缝）内**动态导入**后注入
 * ⇒ core / infra 消费方只依赖 `core/spi`（core 内自洽），不再产生跨层引用。
 *
 * **未注册时**：静默丢弃（noop）。与既有调用方语义一致 —— 各调用点均在 try/catch 内并注明
 * 「SSE 广播失败不影响…」；早期启动 / 非 HTTP 模式下本就没有 SSE 客户端。
 */

/** SSE 广播端口（core 侧契约；与 `LocalHTTPServiceSSE.broadcastEvent` 同形） */
export interface IBroadcastService {
  /** 向所有已连接 SSE 客户端广播事件 */
  broadcast(event: string, payload: Record<string, unknown>): void;
}

/** SPI 服务标识符常量 */
export const BROADCAST_SERVICE_ID = 'core.spi.IBroadcastService';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerBroadcastSpi 在启动时设置。
// core / infra 层代码通过 resolveBroadcast() 获取，避免直接 import service 层实现。
// ---------------------------------------------------------------------------

let _service: IBroadcastService | null = null;

/**
 * 转发**代理**（延迟绑定，同 `resolveLogger()` 语义）：
 * 消费方可在模块顶层持有后长期使用，注册完成后自动生效；注册前调用静默丢弃。
 */
const _proxy: IBroadcastService = {
  broadcast: (event, payload) => {
    if (!_service) return;
    _service.broadcast(event, payload);
  },
};

/** 获取 SSE 广播端口（未注册时为静默 noop） */
export function resolveBroadcast(): IBroadcastService {
  return _proxy;
}

/**
 * 注册 SSE 广播 SPI 实现到 DI 容器
 *
 * 动态导入 service 层实现并注册；此函数**不产生静态跨层依赖**，符合架构分层约束。
 *
 * @param container - DI 容器实例
 */
export async function registerBroadcastSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IBroadcastService
): Promise<void> {
  // 2026-09-30（台账 D-129，`R00-003` ② 改造）：实现体改由 **entry** 侧装配模块构建后传入
  _service = service;

  container.registerDescriptor<IBroadcastService>({
    id: BROADCAST_SERVICE_ID,
    factory: () => _service as IBroadcastService,
    scope: 'singleton',
  });
}
