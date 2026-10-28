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
 * 健康检查模块统一导出
 *
 * ════════════════════════════════════════════════════
 * HealthStatus 是项目标准健康状态类型（2026-06 架构治理统一）
 * 所有模块请使用此类型。DependencyHealthChecker 的 HealthStatus
 * 已通过 types.js 统一。
 *
 * P1（2026-10-28，v3 §6.1）：`DependencyHealthChecker`（含 fs 读写标记文件）
 * 已迁出内核到 `@modules/runtimeHost`。内核只保留**契约与纯函数**
 * （`HealthStatus` / `HEALTH_SEVERITY` / `isAcceptable` / `mergeHealthStatuses`
 * 与 `ModuleHealthRegistry`），因此本 barrel 不再转出该实现类。
 * ════════════════════════════════════════════════════
 */

export {
  ModuleHealthRegistry,
  moduleHealthRegistry,
} from './ModuleHealthRegistry';
export type { ModuleHealth, ModuleHealthCheck } from './ModuleHealthRegistry';
export type { HealthStatus } from './types.js';
export { HEALTH_SEVERITY, isAcceptable, mergeHealthStatuses } from './types.js';
