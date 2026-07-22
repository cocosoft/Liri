export interface MetricPoint {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface Alert {
  id: string;
  level: "info" | "warn" | "error" | "critical";
  message: string;
  timestamp: number;
  acknowledged: boolean;
  source?: string;
}

export type LogSource = "logger" | "structured" | "otel" | "llm" | "all";

export interface LogEntry {
  id: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  timestamp: number;
  source: string;
  module?: string;
  details?: string;
}

export interface SystemHealth {
  status: "healthy" | "degraded" | "unhealthy";
  components: {
    name: string;
    status: "ok" | "warning" | "error";
    message?: string;
  }[];
  timestamp: number;
}
