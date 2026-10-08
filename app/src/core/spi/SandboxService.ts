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
 * 沙箱端口 SPI（core 层端口）—— 2026-10-01 台账 D-154（`R00-001`）
 *
 * **问题**：**security** 层的 `SecurityIntegration`（值引用）与 `CompleteSecuritySystem`
 * （type-only）需要命令级沙箱判定（`shouldUseSandbox` / `isSandboxingEnabled` /
 * `updateSettings`）⇒ 直接 `import { SandboxManager } from '@modules/sandbox'`
 * ⇒ 构成 **`security(infra) -> sandbox(app)` 倒挂**（共 **2 处**）。
 *
 * **方案**：与既有 SPI **同构**（D-144 `IAgentToolPort` / D-147 `ITaskRegistryPort`）——
 * core 定义端口与**转发代理**；实现在 `registerSandboxSpi()`（组合根缝，entry 层）
 * 内**动态导入** `sandbox` 后注入。
 *
 * **为什么是"三个方法的领域化能力"而不是"传 `SandboxManager` 类型"**：把 `SandboxManager`
 * 这一 app 实现类的类型暴露给 core，会让 core 契约绑定 app 实现细节；改为只描述
 * "判断是否该走沙箱 / 沙箱是否启用 / 更新设置"三条**语义**，输入经 `Record<string, unknown>`
 * 边界由实现侧收窄。
 *
 * **未注册时**：布尔方法返回 `false`，`updateSettings` 为 no-op —— 与既有 SPI 的空值语义一致。
 *
 * **2026-10-01 D-157 扩展**（`permission -> sandbox` 倒挂收口）：新增
 * `hasWorkspacePermission()` —— `permission`(infra) 的 `PermissionService.canAccessFile()`
 * 原直接消费 `sandbox` 的 `globalWorkspaceManager`（真实运行时依赖 ⇒ 不可下沉），
 * 故按本 SPI **同一端口**（CS01：同域不另起端口）补一条**最小能力**方法；未注册时返回 `false`
 * （fail-closed，与 `shouldUseSandbox` 同向）。
 *
 * **2026-10-01 D-200 扩展**（`infrastructure -> sandbox` 倒挂收口，子批 C）：新增
 * `isWorkspacePermissionDenied()` 与 `getRuntimeStatus()` —— `infrastructure` 的两个 handler
 * （`handler-utils.ts` · `sandbox-handlers.ts`）原**静态** `import { … } from '@modules/sandbox'`
 * ⇒ 倒挂。仍按 CS01 **同一端口**补最小能力（D-157 同法，不另起端口）。
 * ⚠️ `isWorkspacePermissionDenied` 与既有 `hasWorkspacePermission` 在「默认工作区不存在」
 * 分支上**取舍相反**，见其文档；**不可互相替代**。
 *
 * **2026-10-08（P1-续 S1/S7）收缩**：`hasWorkspacePermission` / `isWorkspacePermissionDenied` /
 * `SandboxRuntimeStatus` 的 `processStats`·`resourceSummary`·`activeWorkspaceCount` **全部删除**
 * —— 其数据源（`WorkspaceManager` / `ProcessRegistry` / `ResourceLimitManager`）**零消费者/零生产者**
 * （恒空），已随各子系统整批删除。本端口现只保留 `shouldUseSandbox` / `isSandboxingEnabled` /
 * `updateSettings` / `getRuntimeStatus`（后者仅余 `runtimeEnabled` / `settings` / `constraints` /
 * `violationCount`）—— 均为**真实**能力。
 */

/**
 * 沙箱运行时状态快照（**最小投影** —— `sandbox-handlers.ts` 的 `GET /v1/sandbox/status` 读取面）
 *
 * 子字段均为**不透明值**（handler 仅原样进 JSON，不读其内部字段）⇒ 用 `unknown` 承载，
 * 不为其建 DTO（避免过度设计，同 `AgentRunDto` 与 `getActiveAgents()` 的分界）。
 */
export interface SandboxRuntimeStatus {
  /** 沙箱运行时是否启用（`SandboxManager.isSandboxingEnabled()`） */
  runtimeEnabled: boolean;
  /** 当前生效设置（`SandboxManager.getSettings()`） */
  settings: unknown;
  /** 当前生效约束（`SandboxManager.getConstraints()`） */
  constraints: unknown;
  /** 违规事件数（`getViolations().length`） */
  violationCount: number;
  // 2026-10-08（P1-续 S1/S7）：原 `processStats`（`processRegistry.getStats()`）/
  // `resourceSummary`（`resourceLimitManager.getSummary()`）/ `activeWorkspaceCount`
  // （`globalWorkspaceManager.list().size`）三字段**已删除** —— 其数据源均**恒空**（零消费者/零生产者）。
}

/** 沙箱端口（core 侧契约） */
export interface ISandboxPort {
  /** 判断给定命令是否应走沙箱（未注册时返回 `false`） */
  shouldUseSandbox(input: Record<string, unknown>): boolean;
  /** 沙箱是否已启用（未注册时返回 `false`） */
  isSandboxingEnabled(): boolean;
  /** 更新沙箱设置（未注册时为 no-op） */
  updateSettings(settings: Record<string, unknown>): void;
  // 2026-10-08（P1-续 S1）：原 `hasWorkspacePermission()`（D-157）与 `isWorkspacePermissionDenied()`
  // （D-200）**已删除** —— 两者都读 `globalWorkspaceManager.get('default')`，而全仓**无
  // `create('default')`** ⇒ 恒 `undefined`：前者恒 `false`（fail-closed），后者恒 `false`（放行，
  // 即**空分支**）。其消费者（`PermissionService.canAccessFile` 已零外部消费者；
  // `handler-utils.checkFilePathPermission` 的空分支）同批移除。
  /** 沙箱运行时状态快照（未注册时返回空值快照，见 `SandboxRuntimeStatus`） */
  getRuntimeStatus(): SandboxRuntimeStatus;
}

/** SPI 服务标识符常量 */
export const SANDBOX_SERVICE_ID = 'core.spi.ISandboxPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerSandboxSpi 在启动时设置。
// security 层通过 resolveSandbox() 获取，避免直接 import app 层 sandbox。
// ---------------------------------------------------------------------------

let _service: ISandboxPort | null = null;

/** 未注册时的**空状态快照**（空对象语义，同本端口既有「未注册 ⇒ 空值/空操作」纪律，非 Mock 数据） */
const _EMPTY_RUNTIME_STATUS: SandboxRuntimeStatus = {
  runtimeEnabled: false,
  settings: null,
  constraints: null,
  violationCount: 0,
};

/** 转发**代理**（延迟绑定，同 `resolveBroadcast()` 语义；注册前为空值语义） */
const _proxy: ISandboxPort = {
  shouldUseSandbox: (input) => _service?.shouldUseSandbox(input) ?? false,
  isSandboxingEnabled: () => _service?.isSandboxingEnabled() ?? false,
  updateSettings: (settings) => _service?.updateSettings(settings),
  getRuntimeStatus: () => _service?.getRuntimeStatus() ?? _EMPTY_RUNTIME_STATUS,
};

/** 获取沙箱端口（未注册时返回空值语义代理） */
export function resolveSandbox(): ISandboxPort {
  return _proxy;
}

/**
 * 注册沙箱 SPI 实现到 DI 容器（**推送模型**）
 *
 * 实现体由 **entry** 侧装配模块（`entrypoints/spiWiring.ts`）构建后传入；
 * 此函数**不产生静态跨层依赖**。
 *
 * @param container - DI 容器实例
 * @param service - 已构建的端口实现
 */
export async function registerSandboxSpi(
  container: {
    registerDescriptor: <T>(desc: {
      id: string;
      factory: () => T;
      scope: 'singleton' | 'transient' | 'request';
    }) => void;
  },
  service: ISandboxPort
): Promise<void> {
  _service = service;

  container.registerDescriptor<ISandboxPort>({
    id: SANDBOX_SERVICE_ID,
    factory: () => _service as ISandboxPort,
    scope: 'singleton',
  });
}
