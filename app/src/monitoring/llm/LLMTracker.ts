/**
 * LLM 调用跟踪器
 * 按会话聚合统计 token 消耗和成本信息
 */

import { Logger, LogLevel } from '../logs/Logger.js';
import {
  appendLogEntry,
  type StructuredLogEntry,
  type LogSource,
} from '../logs/LogMemory.js';
import { getOTelLoggerAdapter } from '../otel/OTelLoggerAdapter.js';
import type { OTelLoggerAdapter } from '../otel/OTelLoggerAdapter.js';

interface LLMCallRecord {
  requestId: string;
  timestamp: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreateTokens: number;
  reasoningTokens: number;
  costUsd: number;
  durationMs: number;
  request?: object;
  response?: object;
}

interface SessionLLMStats {
  sessionId: string;
  title?: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreateTokens: number;
  totalReasoningTokens: number;
  totalCostUsd: number;
  models: string[];
  providers: string[];
  firstCallAt: string;
  lastCallAt: string;
}

interface SessionSummary {
  sessionId: string;
  title?: string;
  totalRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  firstCallAt: string;
  lastCallAt: string;
  models: string[];
}

interface SessionDetail extends SessionLLMStats {
  calls: LLMCallRecord[];
}

/**
 * 敏感信息脱敏工具
 * 支持多种敏感信息类型的自动识别和脱敏
 */
class SensitiveDataScrubber {
  private apiKeyPatterns = [
    /sk-[a-zA-Z0-9]{20,}/g,
    /pk_[a-zA-Z0-9]{20,}/g,
    /AKIA[a-zA-Z0-9]{16}/g,
    /apikey.*?["']([^"']+)["']/gi,
    /api_key.*?["']([^"']+)["']/gi,
    /apiKey.*?["']([^"']+)["']/gi,
    /secret.*?["']([^"']+)["']/gi,
    /access_token.*?["']([^"']+)["']/gi,
    /accessToken.*?["']([^"']+)["']/gi,
    /Bearer\s+[a-zA-Z0-9._-]+/gi,
    /X-API-Key:\s*[a-zA-Z0-9._-]+/gi,
    /Authorization:\s*[a-zA-Z0-9._-]+/gi,
    /api-[a-zA-Z0-9]{32,}/g,
    /[a-zA-Z0-9]{32,}/g,
  ];

  private piiPatterns = [
    /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
    /(1[3-9]\d{9})/g,
    /(\d{18})/g,
    /(\d{15})/g,
    /(\d{17}[\dXx])/g,
    /((?:\d{3}[-.]?){2}\d{4})/g,
    /(\d{4}[-.]?\d{4}[-.]?\d{4}[-.]?\d{4})/g,
    /(\d{4}[-.]?\d{6})/g,
  ];

  private ipPatterns = [
    /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/g,
    /([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g,
  ];

  private urlPatterns = [/(?:https?:\/\/)[^\s]+/g];

  private credentialPatterns = [
    /password.*?["']([^"']+)["']/gi,
    /passwd.*?["']([^"']+)["']/gi,
    /pwd.*?["']([^"']+)["']/gi,
    /username.*?["']([^"']+)["']/gi,
    /user.*?["']([^"']+)["']/gi,
    /login.*?["']([^"']+)["']/gi,
    /email.*?["']([^"']+)["']/gi,
    /phone.*?["']([^"']+)["']/gi,
    /mobile.*?["']([^"']+)["']/gi,
    /address.*?["']([^"']+)["']/gi,
  ];

  private secretPatterns = [
    /-----BEGIN\s+[A-Z ]+-----[\s\S]*?-----END\s+[A-Z ]+-----/g,
    /(\b[0-9a-f]{40}\b)/g,
    /(\b[0-9a-f]{64}\b)/g,
  ];

  scrub(obj: unknown): unknown {
    if (typeof obj === 'string') {
      return this.scrubString(obj);
    }
    if (Array.isArray(obj)) {
      return obj.map((item) => this.scrub(item));
    }
    if (typeof obj === 'object' && obj !== null) {
      const result: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        if (this.isSensitiveKey(key)) {
          result[key] = '***';
        } else {
          result[key] = this.scrub(value);
        }
      }
      return result;
    }
    return obj;
  }

  private scrubString(str: string): string {
    let result = str;

    for (const pattern of this.secretPatterns) {
      result = result.replace(pattern, '***');
    }

    for (const pattern of this.apiKeyPatterns) {
      result = result.replace(pattern, '***');
    }

    for (const pattern of this.credentialPatterns) {
      result = result.replace(pattern, '$1: "***"');
    }

    for (const pattern of this.piiPatterns) {
      result = result.replace(pattern, '***');
    }

    for (const pattern of this.ipPatterns) {
      result = result.replace(pattern, '***.***.***.***');
    }

    return result;
  }

  private isSensitiveKey(key: string): boolean {
    const sensitiveKeys = [
      'api_key',
      'apikey',
      'apiKey',
      'secret',
      'password',
      'token',
      'key',
      'credentials',
      'access_token',
      'accessToken',
      'auth_token',
      'authToken',
      'bearer',
      'authorization',
      'username',
      'user',
      'login',
      'email',
      'phone',
      'mobile',
      'tel',
      'address',
      'id_card',
      'idCard',
      'identity',
      'ssn',
      'credit_card',
      'creditCard',
      'bank_card',
      'bankCard',
      'cvv',
      'pin',
      'passphrase',
      'private_key',
      'privateKey',
      'public_key',
      'publicKey',
      'ssh_key',
      'sshKey',
      'certificate',
      'cert',
      'fingerprint',
      'mac_address',
      'macAddress',
      'ip',
      'host',
      'url',
      'endpoint',
      'connection_string',
      'connectionString',
      'database_url',
      'databaseUrl',
      'dsn',
    ];
    return sensitiveKeys.some((k) => key.toLowerCase().includes(k));
  }
}

export class LLMTracker {
  private sessionStats = new Map<string, SessionLLMStats>();
  private sessionCalls = new Map<string, LLMCallRecord[]>();
  private logger = new Logger({ module: 'LLMTracker' });
  private scrubber = new SensitiveDataScrubber();
  private otelLogger: OTelLoggerAdapter | null;

  constructor() {
    this.otelLogger = getOTelLoggerAdapter();
  }

  /**
   * 记录 LLM 调用
   */
  recordLLMCall(params: {
    sessionId: string;
    requestId: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens?: number;
    cacheCreateTokens?: number;
    reasoningTokens?: number;
    costUsd: number;
    durationMs: number;
    request?: object;
    response?: object;
    title?: string;
  }): void {
    const now = new Date().toISOString();

    const callRecord: LLMCallRecord = {
      requestId: params.requestId,
      timestamp: now,
      model: params.model,
      provider: params.provider,
      inputTokens: params.inputTokens,
      outputTokens: params.outputTokens,
      cacheReadTokens: params.cacheReadTokens ?? 0,
      cacheCreateTokens: params.cacheCreateTokens ?? 0,
      reasoningTokens: params.reasoningTokens ?? 0,
      costUsd: params.costUsd,
      durationMs: params.durationMs,
      request: params.request
        ? (this.scrubber.scrub(params.request) as object)
        : undefined,
      response: params.response
        ? (this.scrubber.scrub(params.response) as object)
        : undefined,
    };

    // 更新会话统计
    const existingStats = this.sessionStats.get(params.sessionId);
    if (existingStats) {
      existingStats.totalRequests++;
      existingStats.totalInputTokens += params.inputTokens;
      existingStats.totalOutputTokens += params.outputTokens;
      existingStats.totalCacheReadTokens += params.cacheReadTokens ?? 0;
      existingStats.totalCacheCreateTokens += params.cacheCreateTokens ?? 0;
      existingStats.totalReasoningTokens += params.reasoningTokens ?? 0;
      existingStats.totalCostUsd += params.costUsd;
      existingStats.lastCallAt = now;
      if (!existingStats.models.includes(params.model)) {
        existingStats.models.push(params.model);
      }
      if (!existingStats.providers.includes(params.provider)) {
        existingStats.providers.push(params.provider);
      }
      if (params.title) {
        existingStats.title = params.title;
      }
    } else {
      this.sessionStats.set(params.sessionId, {
        sessionId: params.sessionId,
        title: params.title,
        totalRequests: 1,
        totalInputTokens: params.inputTokens,
        totalOutputTokens: params.outputTokens,
        totalCacheReadTokens: params.cacheReadTokens ?? 0,
        totalCacheCreateTokens: params.cacheCreateTokens ?? 0,
        totalReasoningTokens: params.reasoningTokens ?? 0,
        totalCostUsd: params.costUsd,
        models: [params.model],
        providers: [params.provider],
        firstCallAt: now,
        lastCallAt: now,
      });
    }

    // 保存调用记录（限制每个会话最多 10000 条）
    let calls = this.sessionCalls.get(params.sessionId);
    if (!calls) {
      calls = [];
      this.sessionCalls.set(params.sessionId, calls);
    }
    calls.push(callRecord);
    if (calls.length > 10000) {
      calls.shift();
    }

    // 记录到日志系统（source='llm'）
    const logEntry: StructuredLogEntry = {
      timestamp: now,
      level: LogLevel.INFO,
      module: `LLMTracker/${params.sessionId.substring(0, 8)}`,
      message: 'LLM call recorded',
      data: {
        sessionId: params.sessionId,
        model: params.model,
        provider: params.provider,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cacheReadTokens: params.cacheReadTokens,
        cacheCreateTokens: params.cacheCreateTokens,
        reasoningTokens: params.reasoningTokens,
        costUsd: params.costUsd,
        durationMs: params.durationMs,
      },
      source: 'llm' as LogSource,
    };
    appendLogEntry(logEntry);

    this.logger.info(
      `LLM call recorded: ${params.model} ${params.inputTokens}/${params.outputTokens} tokens, $${params.costUsd.toFixed(4)}`,
      {
        sessionId: params.sessionId,
        provider: params.provider,
      }
    );

    // 输出 OTel 结构化日志（debug 级别，默认不可见）
    if (this.otelLogger) {
      this.otelLogger.debug('LLM 调用记录', {
        sessionId: params.sessionId,
        model: params.model,
        provider: params.provider,
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        cacheReadTokens: params.cacheReadTokens,
        cacheCreateTokens: params.cacheCreateTokens,
        reasoningTokens: params.reasoningTokens,
        costUsd: params.costUsd,
        durationMs: params.durationMs,
      });
    }
  }

  /**
   * 获取会话统计
   */
  getSessionStats(sessionId: string): SessionLLMStats | null {
    return this.sessionStats.get(sessionId) ?? null;
  }

  /**
   * 获取所有会话列表
   */
  getAllSessions(): SessionSummary[] {
    const summaries: SessionSummary[] = [];
    for (const [sessionId, stats] of this.sessionStats) {
      summaries.push({
        sessionId,
        title: stats.title,
        totalRequests: stats.totalRequests,
        totalTokens: stats.totalInputTokens + stats.totalOutputTokens,
        totalCostUsd: stats.totalCostUsd,
        firstCallAt: stats.firstCallAt,
        lastCallAt: stats.lastCallAt,
        models: stats.models,
      });
    }
    return summaries.sort((a, b) => b.lastCallAt.localeCompare(a.lastCallAt));
  }

  /**
   * 获取会话详情
   */
  getSessionDetail(sessionId: string): SessionDetail | null {
    const stats = this.sessionStats.get(sessionId);
    const calls = this.sessionCalls.get(sessionId) ?? [];

    if (!stats) {
      return null;
    }

    return {
      ...stats,
      calls: [...calls].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    };
  }

  /**
   * 获取所有会话的汇总统计
   */
  getGlobalSummary(): {
    totalSessions: number;
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
  } {
    let totalRequests = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCostUsd = 0;

    for (const stats of this.sessionStats.values()) {
      totalRequests += stats.totalRequests;
      totalInputTokens += stats.totalInputTokens;
      totalOutputTokens += stats.totalOutputTokens;
      totalCostUsd += stats.totalCostUsd;
    }

    return {
      totalSessions: this.sessionStats.size,
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
    };
  }

  /**
   * 清理指定会话
   */
  clearSession(sessionId: string): void {
    this.sessionStats.delete(sessionId);
    this.sessionCalls.delete(sessionId);
  }

  /**
   * 清理所有会话
   */
  clearAll(): void {
    this.sessionStats.clear();
    this.sessionCalls.clear();
  }

  /**
   * 清理超过指定天数的会话
   */
  cleanupOldSessions(daysToKeep: number): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysToKeep);
    const cutoffStr = cutoff.toISOString();

    let cleanedCount = 0;
    for (const [sessionId, stats] of this.sessionStats) {
      if (stats.lastCallAt < cutoffStr) {
        this.sessionStats.delete(sessionId);
        this.sessionCalls.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.info(
        `Cleaned up ${cleanedCount} old sessions (older than ${daysToKeep} days)`
      );
    }

    return cleanedCount;
  }
}

export type { LLMCallRecord, SessionLLMStats, SessionSummary, SessionDetail };
