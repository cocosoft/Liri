/**
 * IOAuditor IO 审计中间件
 * 拦截并记录所有工具输入/输出（I/O）操作，提供可追溯的审计日志
 * 对标 Hermes security/middlewares/io-auditor.ts
 */

import { EventEmitter } from 'node:events';

/**
 * IO 操作类型
 */
export type IOOpsType = 'read' | 'write' | 'execute' | 'delete' | 'network' | 'file' | 'api';

/**
 * IO 审计条目
 */
export interface IOAuditEntry {
  id: string;
  timestamp: number;
  opsType: IOOpsType;
  toolName: string;
  sessionId: string;
  userId: string;
  input: string;
  output: string;
  inputSize: number;
  outputSize: number;
  durationMs: number;
  status: 'success' | 'failure' | 'blocked';
  error?: string;
  tags: string[];
}

/**
 * IO 审计配置
 */
export interface IOAuditorConfig {
  enabled: boolean;
  maxEntries: number;
  captureInput: boolean;
  captureOutput: boolean;
  maxInputLength: number;
  maxOutputLength: number;
  sensitivePatterns: RegExp[];
  redactSensitive: boolean;
}

const DEFAULT_CONFIG: IOAuditorConfig = {
  enabled: true,
  maxEntries: 100000,
  captureInput: true,
  captureOutput: true,
  maxInputLength: 10000,
  maxOutputLength: 100000,
  sensitivePatterns: [
    /(api[_-]?key|apikey|secret|password|token|auth|credential)[=:]\s*['"]?[^\s'"]+/gi,
    /(Authorization|Bearer)\s+\S+/gi,
    /(ssh-rsa|ssh-ed25519)\s+\S+/g,
  ],
  redactSensitive: true,
};

/**
 * IO 审计查询条件
 */
export interface IOAuditQuery {
  opsType?: IOOpsType;
  toolName?: string;
  sessionId?: string;
  userId?: string;
  status?: 'success' | 'failure' | 'blocked';
  startTime?: number;
  endTime?: number;
  tags?: string[];
  limit?: number;
  offset?: number;
}

/**
 * IO 审计统计
 */
export interface IOAuditStats {
  totalEntries: number;
  successCount: number;
  failureCount: number;
  blockedCount: number;
  byOpsType: Record<string, number>;
  byTool: Record<string, number>;
  totalInputBytes: number;
  totalOutputBytes: number;
  avgDurationMs: number;
}

/**
 * IO 审计中间件
 */
export class IOAuditor extends EventEmitter {
  private config: IOAuditorConfig;
  private entries: IOAuditEntry[];
  private entryCounter: number;

  constructor(config?: Partial<IOAuditorConfig>) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.entries = [];
    this.entryCounter = 0;
  }

  /**
   * 记录一条 IO 审计条目
   */
  record(entry: Omit<IOAuditEntry, 'id' | 'timestamp' | 'inputSize' | 'outputSize'>): IOAuditEntry {
    if (!this.config.enabled) {
      const disabledEntry: IOAuditEntry = {
        ...entry,
        id: '',
        timestamp: 0,
        inputSize: 0,
        outputSize: 0,
      };
      return disabledEntry;
    }

    let input = entry.input;
    let output = entry.output;

    if (this.config.redactSensitive) {
      input = this.redact(input);
      output = this.redact(output);
    }

    if (!this.config.captureInput) {
      input = '[INPUT_CAPTURE_DISABLED]';
    }

    if (!this.config.captureOutput) {
      output = '[OUTPUT_CAPTURE_DISABLED]';
    }

    if (input.length > this.config.maxInputLength) {
      input = input.slice(0, this.config.maxInputLength) + '...[TRUNCATED]';
    }

    if (output.length > this.config.maxOutputLength) {
      output = output.slice(0, this.config.maxOutputLength) + '...[TRUNCATED]';
    }

    const auditEntry: IOAuditEntry = {
      ...entry,
      id: `io-${Date.now()}-${++this.entryCounter}`,
      timestamp: Date.now(),
      input,
      output,
      inputSize: entry.input.length,
      outputSize: entry.output.length,
    };

    if (this.entries.length >= this.config.maxEntries) {
      this.entries.shift();
    }

    this.entries.push(auditEntry);
    this.emit('record', auditEntry);

    return auditEntry;
  }

  /**
   * 脱敏敏感数据
   */
  private redact(text: string): string {
    let result = text;

    for (const pattern of this.config.sensitivePatterns) {
      result = result.replace(pattern, (match) => {
        const parts = match.split(/[=:]\s*/);
        if (parts.length >= 2) {
          return `${parts[0]}=[REDACTED]`;
        }
        return '[REDACTED]';
      });
    }

    return result;
  }

  /**
   * 查询审计条目
   */
  query(query: IOAuditQuery): IOAuditEntry[] {
    let results = [...this.entries];

    if (query.opsType) {
      results = results.filter((e) => e.opsType === query.opsType);
    }

    if (query.toolName) {
      results = results.filter((e) => e.toolName === query.toolName);
    }

    if (query.sessionId) {
      results = results.filter((e) => e.sessionId === query.sessionId);
    }

    if (query.userId) {
      results = results.filter((e) => e.userId === query.userId);
    }

    if (query.status) {
      results = results.filter((e) => e.status === query.status);
    }

    if (query.startTime) {
      results = results.filter((e) => e.timestamp >= query.startTime!);
    }

    if (query.endTime) {
      results = results.filter((e) => e.timestamp <= query.endTime!);
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter((e) => query.tags!.some((tag) => e.tags.includes(tag)));
    }

    const offset = query.offset || 0;
    const limit = query.limit || results.length;

    return results.slice(offset, offset + limit);
  }

  /**
   * 获取审计统计
   */
  getStats(): IOAuditStats {
    const byOpsType: Record<string, number> = {};
    const byTool: Record<string, number> = {};
    let totalInputBytes = 0;
    let totalOutputBytes = 0;
    let totalDurationMs = 0;
    let successCount = 0;
    let failureCount = 0;
    let blockedCount = 0;

    for (const entry of this.entries) {
      byOpsType[entry.opsType] = (byOpsType[entry.opsType] || 0) + 1;
      byTool[entry.toolName] = (byTool[entry.toolName] || 0) + 1;
      totalInputBytes += entry.inputSize;
      totalOutputBytes += entry.outputSize;
      totalDurationMs += entry.durationMs;

      if (entry.status === 'success') successCount++;
      else if (entry.status === 'failure') failureCount++;
      else if (entry.status === 'blocked') blockedCount++;
    }

    const count = this.entries.length;

    return {
      totalEntries: count,
      successCount,
      failureCount,
      blockedCount,
      byOpsType,
      byTool,
      totalInputBytes,
      totalOutputBytes,
      avgDurationMs: count > 0 ? Math.round(totalDurationMs / count) : 0,
    };
  }

  /**
   * 清空审计条目
   */
  clear(): void {
    this.entries = [];
    this.entryCounter = 0;
    this.emit('cleared');
  }

  /**
   * 获取总条目数
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * 更新配置
   */
  updateConfig(config: Partial<IOAuditorConfig>): void {
    this.config = { ...this.config, ...config };
    this.emit('config:updated', this.config);
  }
}
