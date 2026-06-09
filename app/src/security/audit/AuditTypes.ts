/**
 * 安全审计类型定义
 */

export type AuditSeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export type AuditCategory =
  | 'config'
  | 'dangerous_config'
  | 'plugin_trust'
  | 'model_hygiene'
  | 'filesystem'
  | 'context_visibility'
  | 'sandbox'
  | 'workspace'
  | 'network'
  | 'general';

/** @deprecated 使用 {@link DataAuditEvent} — 从 `@modules/core/data-models` 导入 */
export interface SecurityAuditFinding {
  id: string;
  severity: AuditSeverity;
  category: AuditCategory;
  path?: string;
  message: string;
  remediation: string;
  metadata?: Record<string, unknown>;
}

export interface SecurityAuditSummary {
  high: number;
  medium: number;
  low: number;
  total: number;
  categories: Record<AuditCategory, number>;
}

export interface DeepAuditResults {
  codeSafetyFindings: SecurityAuditFinding[];
  probeFindings: SecurityAuditFinding[];
  sandboxFindings: SecurityAuditFinding[];
}

/** @deprecated 使用 {@link DataAuditEvent} 基类 — 从 `@modules/core/data-models` 导入 */
export interface SecurityAuditReport {
  summary: SecurityAuditSummary;
  findings: SecurityAuditFinding[];
  deep?: DeepAuditResults;
  timestamp: string;
  durationMs: number;
}

export interface SecurityAuditOptions {
  config?: Record<string, unknown>;
  env?: Record<string, string>;
  deep?: boolean;
  includeFilesystem?: boolean;
  includePlugins?: boolean;
  stateDir?: string;
  configPath?: string;
  workspaceDir?: string;
  deepTimeoutMs?: number;
}

export interface SecurityAuditContext {
  config: Record<string, unknown>;
  env: Record<string, string>;
  deep: boolean;
  includeFilesystem: boolean;
  includePlugins: boolean;
  stateDir: string;
  configPath: string;
  workspaceDir: string;
  deepTimeoutMs: number;
}
