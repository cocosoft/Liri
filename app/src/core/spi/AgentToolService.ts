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
 * Agent 执行端口 SPI（core 层端口）—— 2026-10-01 台账 D-144（`R00-001` BULK-012）
 *
 * **问题**：`core/Coordinator.ts` 直接 `import { AgentTool, resolveAgentToolInstance } from '@modules/tools'`
 * ⇒ 构成 **`core -> app` 倒挂**（BULK-012 桶内 11 处之一）。
 *
 * **方案**：与 `BroadcastService` / `LoggerService` / `AgentToolService` **同构**的 SPI ——
 * core 定义端口与**转发代理**；实现在 `entrypoints/spiWiring.ts`（组合根缝）内动态导入后注入
 * ⇒ core 消费方只依赖 `core/spi`（core 内自洽），不再产生跨层引用。
 *
 * **未注册时**：`resolveAgentTool()` **抛错**（不静默 noop）—— Agent 协作是 Coordinator 的**核心能力**，
 * 静默降级会把"任务永远不执行"伪装成正常，属 CS03「回退不得掩盖错误」禁止的形态。
 */

/** Agent 执行端口（core 侧契约；与 `AgentTool` 的协作方法同形） */
export interface IAgentToolPort {
  /** 停止指定子代理任务（返回是否成功停止） */
  stopAgent(taskId: string, options?: { privileged?: boolean }): boolean;
  /** 执行子代理任务 */
  execute(input: {
    description: string;
    prompt: string;
    subagent_type?: string;
  }): Promise<{
    status?: string;
    data?: unknown;
    output?: string;
    metadata?: { totalTokens?: number; toolUses?: number };
    executionTime?: number;
    error?: string;
    errorOutput?: string;
  }>;
}

/** SPI 服务标识符常量 */
export const AGENT_TOOL_SERVICE_ID = 'core.spi.IAgentToolPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerAgentToolSpi 在启动时设置。
// core 层代码通过 resolveAgentTool() 获取，避免直接 import app 层实现。
// ---------------------------------------------------------------------------

let _service: IAgentToolPort | null = null;

/** 内部解析（未注册时抛错 —— 协作能力不可用必须显式暴露，不得静默降级） */
function _requireService(): IAgentToolPort {
  if (!_service) {
    throw new Error(
      '[core.spi] IAgentToolPort 未注册：请在装配点（entrypoints/spiWiring.ts）调用 registerAgentToolSpi()'
    );
  }
  return _service;
}

/**
 * 转发**代理**（延迟绑定，同 `resolveBroadcast()` / `resolveLogger()` 语义）：
 * 消费方可在模块顶层持有后长期使用，注册完成后自动生效；**注册前调用即抛错**。
 */
const _proxy: IAgentToolPort = {
  stopAgent: (taskId, options) => _requireService().stopAgent(taskId, options),
  execute: (input) => _requireService().execute(input),
};

/** 获取 Agent 执行端口（延迟绑定代理；未注册时调用即抛错） */
export function resolveAgentTool(): IAgentToolPort {
  return _proxy;
}

/**
 * 注册 Agent 执行 SPI 实现
 *
 * 实现体由 **entry** 侧装配模块（`spiWiring.ts`）构建后传入；此函数**不产生静态跨层依赖**。
 *
 * @param container - DI 容器实例
 * @param service - Agent 执行端口实现（如 `AgentTool` 共享实例）
 */
export async function registerAgentToolSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: IAgentToolPort
): Promise<void> {
  _service = service;

  container.registerDescriptor<IAgentToolPort>({
    id: AGENT_TOOL_SERVICE_ID,
    factory: () => _service as IAgentToolPort,
    scope: 'singleton',
  });
}
