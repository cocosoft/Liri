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
 * 任务注册表端口 SPI（core 层端口）—— 2026-10-01 台账 D-147（`R00-001` BULK-007）
 *
 * **问题**：**infra** 层的 `chronos`（CronScheduler / AutoDream）与 `daemon`（ProcessManager）
 * 需要把自身的"轻量任务"登记到 **app** 层 `tasks` 的 `TaskRegistry` 并更新其状态
 * ⇒ 直接 `import { taskRegistry, BaseTask, TaskType, TaskStatus } from '@modules/tasks'`
 * ⇒ 构成 **`infra -> app` 倒挂**（共 **9 处**，是 `infra -> app` 最大的一组）。
 *
 * **方案**：与既有 8 个 SPI **同构** —— core 定义端口与**转发代理**；实现在
 * `registerTaskRegistrySpi()`（组合根缝，entry 层）内**动态导入** `tasks` 后注入。
 *
 * **为什么不用「传 `BaseTask` 构造函数」**：`BaseTask` 是 **class**（需 `extends`），跨端口
 * 传类构造器会让 core 契约绑定 app 实现细节。改为**领域化能力**
 * （`registerLightweightTask(kind, …)`）—— 子类化与 `new` 全部封在**实现侧**，
 * core 只描述"登记一个仅用于展示的轻量任务"这一**语义**。
 *
 * **未注册时**：`registerLightweightTask` 返回空串（消费方仅把它存进 map）；
 * `updateState` 静默跳过 —— 与既有 SPI 的空值语义一致。
 */

/** 轻量任务种类（core 侧最小投影，与 app 侧 `TaskType.CRON` / `DAEMON_PROCESS` / `DREAM` 一一对应） */
export type LightweightTaskKind = 'cron' | 'daemon_process' | 'dream';

/** 任务状态（core 侧最小投影，与 app 侧 `TaskStatus` 同值区间） */
export type TaskRegistryStatus = 'pending' | 'running' | 'completed' | 'failed';

/** 任务注册表端口（core 侧契约） */
export interface ITaskRegistryPort {
  /**
   * 登记一个"仅用于展示/追踪"的轻量任务（无实际执行体），返回注册表 ID。
   * 未注册实现时返回 `''`。
   */
  registerLightweightTask(
    kind: LightweightTaskKind,
    id: string,
    description: string
  ): string;
  /** 更新任务状态（附带上报字段原样透传） */
  updateState(
    registryTaskId: string,
    state: { status: TaskRegistryStatus } & Record<string, unknown>
  ): void;
}

/** SPI 服务标识符常量 */
export const TASK_REGISTRY_SERVICE_ID = 'core.spi.ITaskRegistryPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerTaskRegistrySpi 在启动时设置。
// infra 层（chronos / daemon）通过 resolveTaskRegistry() 获取，避免直接 import app 层。
// ---------------------------------------------------------------------------

let _service: ITaskRegistryPort | null = null;

/** 转发**代理**（延迟绑定，同 `resolveBroadcast()` 语义；注册前为空操作，消费方自行降级） */
const _proxy: ITaskRegistryPort = {
  registerLightweightTask: (kind, id, description) =>
    _service?.registerLightweightTask(kind, id, description) ?? '',
  updateState: (registryTaskId, state) =>
    _service?.updateState(registryTaskId, state),
};

/** 获取任务注册表端口（未注册时为空操作） */
export function resolveTaskRegistry(): ITaskRegistryPort {
  return _proxy;
}

/**
 * 注册任务注册表 SPI 实现到 DI 容器（**推送模型**）
 *
 * 实现体由 **entry** 侧装配模块（`entrypoints/spiWiring.ts`）构建后传入；
 * 此函数**不产生静态跨层依赖**。
 *
 * @param container - DI 容器实例
 * @param service - 已构建的端口实现
 */
export async function registerTaskRegistrySpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: ITaskRegistryPort
): Promise<void> {
  _service = service;

  container.registerDescriptor<ITaskRegistryPort>({
    id: TASK_REGISTRY_SERVICE_ID,
    factory: () => _service as ITaskRegistryPort,
    scope: 'singleton',
  });
}
