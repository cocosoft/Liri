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
 */

import type { SandboxPermission } from '../sandboxPermission.js';

/** 沙箱端口（core 侧契约） */
export interface ISandboxPort {
  /** 判断给定命令是否应走沙箱（未注册时返回 `false`） */
  shouldUseSandbox(input: Record<string, unknown>): boolean;
  /** 沙箱是否已启用（未注册时返回 `false`） */
  isSandboxingEnabled(): boolean;
  /** 更新沙箱设置（未注册时为 no-op） */
  updateSettings(settings: Record<string, unknown>): void;
  /**
   * 默认工作区是否拥有指定权限（未注册 / 默认工作区不存在时返回 `false`）
   *
   * 实现侧对应 `globalWorkspaceManager.get('default')?.hasPermission(permission) ?? false`。
   */
  hasWorkspacePermission(permission: SandboxPermission): boolean;
}

/** SPI 服务标识符常量 */
export const SANDBOX_SERVICE_ID = 'core.spi.ISandboxPort';

// ---------------------------------------------------------------------------
// 内部 SPI 服务引用：由 registerSandboxSpi 在启动时设置。
// security 层通过 resolveSandbox() 获取，避免直接 import app 层 sandbox。
// ---------------------------------------------------------------------------

let _service: ISandboxPort | null = null;

/** 转发**代理**（延迟绑定，同 `resolveBroadcast()` 语义；注册前为空值语义） */
const _proxy: ISandboxPort = {
  shouldUseSandbox: (input) => _service?.shouldUseSandbox(input) ?? false,
  isSandboxingEnabled: () => _service?.isSandboxingEnabled() ?? false,
  updateSettings: (settings) => _service?.updateSettings(settings),
  hasWorkspacePermission: (permission) =>
    _service?.hasWorkspacePermission(permission) ?? false,
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
