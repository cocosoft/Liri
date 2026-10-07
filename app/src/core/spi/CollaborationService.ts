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
 * 协作编排统一层端口 SPI（core 层端口）—— 2026-10-07（范围 A · 薄端口）。
 *
 * 规格：`.trae/specs/collaboration-orchestration-port.md`（**唯一事实源**）。
 *
 * ⚠️ **预留端口 / 生产中无消费者**：本次为「**仅建层、消费入口暂不定**」（spec §5 已明示与
 * G4「≥1 真实消费方」门槛的张力）⇒ 生产代码**没有任何调用方**，**勿视为既有能力**
 * （先例：`MemoryHookDispatcher`）。已登记 `.trae/specs/dead-code-and-unwired-items-rulings.md`
 * 的 **UW 组**。
 *
 * **作用**：给"调度协作单元"一个**单一入口**（三通道：`local-swarm` / `local-scheduler` /
 * `remote`），并为后续拓扑可配置留出接缝。端口只声明契约：三路既有引擎
 * （`AgentSwarm` / `ParallelAgentScheduler` / `RemoteAgentExecutor`）由 **app 层**适配器
 * （`agent/orchestration/`）做**形状搬运**，实现体在组合根（`entrypoints/spiWiring.ts`）注入
 * —— core 不静态依赖任何上层模块。
 *
 * **未注册时**：`resolveCollaboration()` 返回**空操作代理** —— `listChannels() → []`、
 * `dispatch() → null`（与 `resolveSessionQuality()` 一致；**不造默认值**）。
 */

/** 协作调度请求（core 侧 DTO，**最小必要**） */
export interface CollaborationDispatchRequestDto {
  /** 总目标（共享上下文；swarm 通道必需，其余通道可忽略） */
  readonly goal: string;
  /** 工作单元（**不透明**：core 不定义 worker 语义，由实现侧解释） */
  readonly units: ReadonlyArray<{ id: string; instruction: string }>;
  /** 期望拓扑（实现侧按其能力支持；不支持 ⇒ 由实现侧决定抛错或按其默认，端口不掩盖） */
  readonly topology?: 'parallel' | 'sequential' | 'vote';
  /** 并发上限（可选；实现侧可裁剪） */
  readonly maxConcurrency?: number;
  /** 是否允许委派到远程（默认 false） */
  readonly allowRemote?: boolean;
  /** 外部取消信号（可选） */
  readonly signal?: AbortSignal;
}

/** 协作调度结果（core 侧 DTO） */
export interface CollaborationDispatchResultDto {
  /** 实际使用的通道标识（可观测：`local-swarm` / `local-scheduler` / `remote`） */
  readonly channel: string;
  /** 逐单元结果（**保序**：下标与 `units` 对应） */
  readonly outcomes: ReadonlyArray<{
    unitId: string;
    ok: boolean;
    summary: string;
  }>;
  /** 通道级整体结论（swarm 通道 = `allPassed` 语义；其余通道按实现侧口径） */
  readonly allPassed: boolean;
}

/** 协作编排端口（core 侧契约） */
export interface ICollaborationPort {
  /** 已装配的通道清单（**能力自述**；空数组 = 未装配任何实现） */
  listChannels(): Promise<ReadonlyArray<string>>;
  /** 单入口调度；**未装配 / 不可用 ⇒ `null`**（不造默认值，同既有 SPI 语义） */
  dispatch(
    req: CollaborationDispatchRequestDto
  ): Promise<CollaborationDispatchResultDto | null>;
}

/** SPI 服务标识符常量 */
export const COLLABORATION_SERVICE_ID = 'core.spi.ICollaborationPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerCollaborationSpi 在启动时设置。
// 消费方（待第一消费入口）通过 resolveCollaboration() 获取，
// 避免直接 import app 层（agent / tasks）。
// ---------------------------------------------------------------------------

let _service: ICollaborationPort | null = null;

/** 转发**代理**（延迟绑定，同 `resolveSessionQuality()` 语义） */
const _proxy: ICollaborationPort = {
  listChannels: () => _service?.listChannels() ?? Promise.resolve([]),
  dispatch: (req) => _service?.dispatch(req) ?? Promise.resolve(null),
};

/** 获取协作编排端口（未注册时返回空操作代理） */
export function resolveCollaboration(): ICollaborationPort {
  return _proxy;
}

/**
 * 注册协作编排 SPI 实现到 DI 容器（**推送模型**）
 *
 * 实现体由 **entry** 侧装配模块（`entrypoints/spiWiring.ts`）构建后传入；
 * 此函数**不产生静态跨层依赖**。
 *
 * @param container - DI 容器实例
 * @param service - 已构建的端口实现
 */
export async function registerCollaborationSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: ICollaborationPort
): Promise<void> {
  _service = service;

  container.registerDescriptor<ICollaborationPort>({
    id: COLLABORATION_SERVICE_ID,
    factory: () => _service as ICollaborationPort,
    scope: 'singleton',
  });
}
