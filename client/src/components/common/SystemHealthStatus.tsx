/**
 * SystemHealthStatus.tsx — 系统健康状态展示组件
 *
 * 展示基础设施健康检查、系统资源、通道状态等聚合信息
 */

import { memo } from "react";
import type { InfrastructureStatus } from "../../services/infrastructureHealthService";

/** 颜色映射 */
const STATUS_COLOR: Record<string, string> = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-500",
  unhealthy: "bg-red-500",
  unknown: "bg-gray-400",
  warning: "bg-yellow-500",
  critical: "bg-red-500",
};

const STATUS_LABEL: Record<string, string> = {
  healthy: "健康",
  degraded: "降级",
  unhealthy: "不健康",
  unknown: "未知",
  warning: "警告",
  critical: "严重",
};

interface SystemHealthStatusProps {
  /** 基础设施状态数据 */
  status: InfrastructureStatus;
  /** 是否暗色模式 */
  isDark: boolean;
}

/**
 * 系统健康状态组件
 * 紧凑展示整体健康、系统资源、通道状态
 */
export const SystemHealthStatus = memo(function SystemHealthStatus({
  status,
  isDark,
}: SystemHealthStatusProps) {
  const overallStatus = status.health?.overall ?? "unknown";

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3
          className={`text-sm font-semibold flex items-center gap-2 ${isDark ? "text-gray-300" : "text-gray-700"}`}
        >
          <span>🩺</span> 系统健康
        </h3>
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${STATUS_COLOR[overallStatus] || "bg-gray-400"}`}
          />
          <span
            className={`text-xs font-medium ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            {STATUS_LABEL[overallStatus] || overallStatus}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        {/* CPU 使用率 */}
        {status.system && (
          <div
            className={`p-2 rounded ${isDark ? "bg-gray-700/50" : "bg-gray-50"}`}
          >
            <span
              className={`block ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              CPU
            </span>
            <span
              className={`block font-bold mt-0.5 ${
                status.system.resourceUsage.cpu.usage > 70
                  ? "text-red-500"
                  : isDark
                    ? "text-gray-100"
                    : "text-gray-900"
              }`}
            >
              {status.system.resourceUsage.cpu.usage.toFixed(1)}%
            </span>
          </div>
        )}

        {/* 内存使用率 */}
        {status.system && (
          <div
            className={`p-2 rounded ${isDark ? "bg-gray-700/50" : "bg-gray-50"}`}
          >
            <span
              className={`block ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              内存
            </span>
            <span
              className={`block font-bold mt-0.5 ${
                status.system.resourceUsage.memory.usagePercent > 80
                  ? "text-red-500"
                  : isDark
                    ? "text-gray-100"
                    : "text-gray-900"
              }`}
            >
              {status.system.resourceUsage.memory.usagePercent.toFixed(1)}%
            </span>
          </div>
        )}

        {/* 磁盘使用率 */}
        {status.system && (
          <div
            className={`p-2 rounded ${isDark ? "bg-gray-700/50" : "bg-gray-50"}`}
          >
            <span
              className={`block ${isDark ? "text-gray-400" : "text-gray-500"}`}
            >
              磁盘
            </span>
            <span
              className={`block font-bold mt-0.5 ${
                status.system.resourceUsage.disk.usagePercent > 85
                  ? "text-red-500"
                  : isDark
                    ? "text-gray-100"
                    : "text-gray-900"
              }`}
            >
              {status.system.resourceUsage.disk.usagePercent.toFixed(1)}%
            </span>
          </div>
        )}
      </div>

      {/* 通道健康缩略 */}
      {status.channels && status.channels.length > 0 && (
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <span
            className={`text-xs ${isDark ? "text-gray-400" : "text-gray-500"}`}
          >
            通道:
          </span>
          <div className="flex gap-1">
            {status.channels.map((ch) => (
              <span
                key={ch.channelName}
                className={`w-2 h-2 rounded-full ${ch.healthy ? "bg-green-500" : "bg-red-500"}`}
                title={`${ch.channelName}: ${ch.message}`}
              />
            ))}
          </div>
          <span
            className={`text-xs ${isDark ? "text-gray-500" : "text-gray-400"}`}
          >
            {status.channels.filter((c) => c.healthy).length}/
            {status.channels.length}
          </span>
        </div>
      )}

      {/* 健康检查条目 */}
      {status.health && status.health.checks.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
          <div className="space-y-1">
            {status.health.checks.map((check) => (
              <div
                key={check.name}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${STATUS_COLOR[check.status] || "bg-gray-400"}`}
                  />
                  <span
                    className={`text-xs ${isDark ? "text-gray-300" : "text-gray-600"}`}
                  >
                    {check.name}
                  </span>
                </div>
                {check.error ? (
                  <span className="text-xs text-red-500 truncate max-w-[120px]">
                    {check.error}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">
                    {check.latency}ms
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
});
