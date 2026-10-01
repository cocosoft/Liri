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
 * Hook 链端口 SPI（core 层端口）—— 2026-10-01 台账 D-155（`R00-001`）
 *
 * **问题**：**infra** 层的 `cost/CostHookDispatcher` 需要把成本告警分发为 Hook 事件
 * （`cost.alert` / `cost.budget.warning` / `cost.budget.exceeded`）⇒ 直接
 * `import { HookChainManager } from '@modules/hooks'` ⇒ 构成
 * **`cost(infra) -> hooks(app)` 倒挂**（1 处）。
 *
 * **方案**：与既有 SPI **同构**（D-144 `IAgentToolPort` / D-147 `ITaskRegistryPort` /
 * D-154 `ISandboxPort`）—— core 定义端口与**转发代理**；实现在 `registerHookChainSpi()`
 * （组合根缝，entry 层）内**动态导入** `hooks` 后注入。
 *
 * **为什么是"域 + 事件 + 载荷"的领域化能力而不是"传 `HookChainManager` 类型"**：把
 * `HookChainManager` 这一 app 实现类的类型暴露给 core，会让 core 契约绑定 app 实现细节；
 * 改为只描述"在某个 Hook 域上执行一次事件分发"这一**语义**。
 *
 * **未注册时**：`execute` 为 no-op（`cost` 告警分发静默跳过）—— 与既有 SPI 的空值语义一致。
 */

/** Hook 执行载荷（core 侧最小投影，与 app 侧 `HookContext` 的所需字段同构） */
export interface HookExecutePayload {
  event: string;
  data: unknown;
  sessionId?: string;
}

/** Hook 链端口（core 侧契约） */
export interface IHookChainPort {
  /** 在 `hookName` 域上执行一次 Hook 事件分发（未注册时为 no-op） */
  execute(hookName: string, payload: HookExecutePayload): Promise<void>;
}

/** SPI 服务标识符常量 */
export const HOOK_CHAIN_SERVICE_ID = 'core.spi.IHookChainPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerHookChainSpi 在启动时设置。
// cost（infra）层通过 resolveHookChain() 获取，避免直接 import app 层 hooks。
// ---------------------------------------------------------------------------

let _service: IHookChainPort | null = null;

/** 转发**代理**（延迟绑定，同 `resolveSandbox()` 语义；注册前为空操作，消费方自行降级） */
const _proxy: IHookChainPort = {
  execute: (hookName, payload) =>
    _service?.execute(hookName, payload) ?? Promise.resolve(),
};

/** 获取 Hook 链端口（未注册时为空操作） */
export function resolveHookChain(): IHookChainPort {
  return _proxy;
}

/**
 * 注册 Hook 链 SPI 实现到 DI 容器（**推送模型**）
 *
 * 实现体由 **entry** 侧装配模块（`entrypoints/spiWiring.ts`）构建后传入；
 * 此函数**不产生静态跨层依赖**。
 *
 * @param container - DI 容器实例
 * @param service - 已构建的端口实现
 */
export async function registerHookChainSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IHookChainPort
): Promise<void> {
  _service = service;

  container.registerDescriptor<IHookChainPort>({
    id: HOOK_CHAIN_SERVICE_ID,
    factory: () => _service as IHookChainPort,
    scope: 'singleton',
  });
}
