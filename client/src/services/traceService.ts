/**
 * Trace Service — 消费 AITracePlugin 的真实 API token 消耗数据
 *
 * Trace 是必选基础设施，记录每次 AI API 调用的真实 input/output token。
 * 前端通过此服务获取真实数据，替代估算值用于显示和成本计算。
 */
import { httpLegacy as http } from "./httpClient";

export interface TraceStats {
  totalCalls: number;
  totalErrors: number;
  callsByModel: Record<string, number>;
  errorsByModel: Record<string, number>;
  avgLatencyByModel: Record<string, number>;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  latencyP50: number;
  latencyP99: number;
}

export interface TraceStatus {
  running: boolean;
  mode: string;
  recordedCount: number;
  traceDir: string;
  liveViewUrl?: string;
}

export interface TraceWriterInfo {
  totalWritten: number;
  currentFileSize: number;
  currentDate: string;
}

export interface TraceStatsResponse {
  data: {
    status: TraceStatus;
    stats: TraceStats | null;
    writer: TraceWriterInfo | null;
  };
  error?: { message: string };
}

/**
 * 获取 Trace 统计快照（真实 API token 消耗）
 */
export async function getTraceStats(): Promise<TraceStatsResponse> {
  const resp = await http.get<TraceStatsResponse>("/v1/trace/stats");
  return resp;
}
