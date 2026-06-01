import { http } from './httpClient';
import type { MetricPoint, Alert, LogEntry, SystemHealth } from '../types';

export interface MetricsData {
  requests: MetricPoint[];
  responseTime: MetricPoint[];
  errorRate: MetricPoint[];
  cpu: MetricPoint[];
  memory: MetricPoint[];
}

export interface MonitorSummary {
  uptime: number;
  cpuPercent: number;
  memoryPercent: number;
  memoryUsedMB: number;
  memoryTotalMB: number;
  diskTotalGB: number;
  diskUsedGB: number;
  diskFreeGB: number;
  diskUsagePercent: number;
  loadAverage: number[];
  requestCount: number;
  errorCount: number;
  avgResponseTime: number;
}

export interface AnalyticsDashboardData {
  tokens: {
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
    totalLLMRequests: number;
  };
  tools: {
    totalToolCalls: number;
    uniqueToolsUsed: number;
    topTools: Array<{ name: string; count: number }>;
  };
  errors: {
    totalErrors: number;
    errorRate: number;
    topErrors: Array<{ type: string; count: number }>;
  };
  performance: {
    averageLatencyMs: number;
    p50LatencyMs: number;
    p95LatencyMs: number;
    p99LatencyMs: number;
    totalMetrics: number;
  };
  cost: {
    totalCostUSD: number;
  };
  session: {
    totalEvents: number;
    totalSessions: number;
    activeSessions: number;
  };
  generatedAt: number;
}

export const monitorService = {
  async getMetrics(timeRange: number = 3600000): Promise<MetricsData> {
    return http.get<MetricsData>(`/v1/monitor/metrics?range=${timeRange}`);
  },

  async getSummary(): Promise<MonitorSummary> {
    return http.get<MonitorSummary>('/v1/monitor/summary');
  },

  async getAlerts(acknowledged?: boolean): Promise<Alert[]> {
    const params = acknowledged !== undefined ? `?acknowledged=${acknowledged}` : '';
    return http.get<Alert[]>(`/v1/monitor/alerts${params}`);
  },

  async acknowledgeAlert(id: string): Promise<void> {
    return http.post(`/v1/monitor/alerts/${id}/acknowledge`, {});
  },

  async getLogs(params: {
    level?: 'debug' | 'info' | 'warn' | 'error';
    search?: string;
    startTime?: number;
    endTime?: number;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: LogEntry[]; total: number }> {
    const searchParams = new URLSearchParams();
    if (params.level) searchParams.set('level', params.level);
    if (params.search) searchParams.set('search', params.search);
    if (params.startTime) searchParams.set('start_time', String(params.startTime));
    if (params.endTime) searchParams.set('end_time', String(params.endTime));
    if (params.limit) searchParams.set('limit', String(params.limit));
    if (params.offset) searchParams.set('offset', String(params.offset));

    return http.get<{ logs: LogEntry[]; total: number }>(`/v1/monitor/logs?${searchParams.toString()}`);
  },

  async getSystemHealth(): Promise<SystemHealth> {
    return http.get<SystemHealth>('/v1/health/report');
  },

  async getAnalyticsDashboard(): Promise<AnalyticsDashboardData> {
    return http.get<AnalyticsDashboardData>('/v1/analytics/dashboard');
  },
};