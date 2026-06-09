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
 * 统一健康状态类型
 *
 * ════════════════════════════════════════════════════
 * 项目标准健康状态枚举（2026-06 架构治理统一）
 * 所有健康检查模块应使用此类型，避免自行定义。
 * 涵盖所有现有系统的值集：
 *   - diagnostics/SystemHealthChecker: healthy/warning/critical
 *   - core/health/DependencyHealthChecker: healthy/degraded/unhealthy/unknown
 *   - common/types.ts: healthy/degraded/unhealthy
 * ════════════════════════════════════════════════════
 */

/**
 * 统一健康状态枚举
 * 覆盖所有现有健康检查系统的值集
 */
export type UnifiedHealthStatus =
  | 'healthy'
  | 'warning'
  | 'degraded'
  | 'unhealthy'
  | 'unknown'
  | 'critical';

/**
 * 健康状态严重程度映射
 */
export const HEALTH_SEVERITY: Record<UnifiedHealthStatus, number> = {
  healthy: 0,
  warning: 1,
  degraded: 2,
  unhealthy: 3,
  unknown: 4,
  critical: 5,
};

/**
 * 判断状态是否健康（healthy 或 warning 视为可接受）
 */
export function isAcceptable(status: UnifiedHealthStatus): boolean {
  const severity = HEALTH_SEVERITY[status];
  return severity <= HEALTH_SEVERITY.warning;
}

/**
 * 合并多个健康状态
 * 取最严重的那个
 */
export function mergeHealthStatuses(
  statuses: UnifiedHealthStatus[]
): UnifiedHealthStatus {
  let worst: UnifiedHealthStatus = 'healthy';
  for (const s of statuses) {
    if (HEALTH_SEVERITY[s] > HEALTH_SEVERITY[worst]) {
      worst = s;
    }
  }
  return worst;
}
