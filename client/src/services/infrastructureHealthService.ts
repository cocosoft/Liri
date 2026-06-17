/**
 * infrastructureHealthService.ts — 基础设施健康状态服务
 *
 * 对接后端 /v1/infrastructure/status 聚合端点
 */

import { httpLegacy as http } from "./httpClient";

/** 健康检查条目 */
export interface HealthCheckEntry {
  name: string;
  status: string;
  latency: number;
  error?: string;
}

/** 系统资源使用 */
export interface SystemResourceUsage {
  cpu: { usage: number; loadAverage: number[]; cores: number };
  memory: { total: number; free: number; used: number; usagePercent: number };
  disk: { total: number; free: number; used: number; usagePercent: number };
}

/** 系统健康 */
export interface SystemHealthInfo {
  overallStatus: string;
  resourceUsage: SystemResourceUsage;
  recommendations: string[];
}

/** LLM 汇总 */
export interface LLMSummaryInfo {
  totalSessions: number;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

/** 基础设施状态响应 */
export interface InfrastructureStatus {
  timestamp: number;
  health: {
    overall: string;
    summary: {
      total: number;
      healthy: number;
      degraded: number;
      unhealthy: number;
      unknown: number;
      averageLatency: number;
    };
    checks: HealthCheckEntry[];
  } | null;
  system: SystemHealthInfo | null;
  channels: Array<{
    channelName: string;
    connected: boolean;
    healthy: boolean;
    message: string;
  }>;
  llm: LLMSummaryInfo | null;
  otel: { enabled: boolean };
  eventLoop: { monitoring: boolean };
}

export const infrastructureHealthService = {
  /**
   * 获取基础设施聚合状态
   */
  async getStatus(): Promise<InfrastructureStatus> {
    return http.get<InfrastructureStatus>("/v1/infrastructure/status");
  },
};
