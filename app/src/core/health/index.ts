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
 * HealthStatus 类型已统一为 UnifiedHealthStatus（2026-06 架构治理）
 * 新代码请从本模块导入 UnifiedHealthStatus，而非自行定义。
 * ════════════════════════════════════════════════════
 */

export {
  DependencyHealthChecker,
  getDependencyHealthChecker,
} from './DependencyHealthChecker';
export type {
  DependencyHealthResult,
  DependencyHealthConfig,
  DependencyType,
  HealthStatus,
} from './DependencyHealthChecker';
export {
  ModuleHealthRegistry,
  moduleHealthRegistry,
} from './ModuleHealthRegistry';
export type { ModuleHealth, ModuleHealthCheck } from './ModuleHealthRegistry';
export type { UnifiedHealthStatus } from './types.js';
export {
  HEALTH_SEVERITY,
  isAcceptable,
  mergeHealthStatuses,
} from './types.js';
