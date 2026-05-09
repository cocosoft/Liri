//
/**
 * Bridge 调试器
 * 提供Bridge连接状态调试和消息流追踪功能
 */

import type { BridgeConfig, PollConfig } from '../types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

export interface DebugOptions {
  /** 是否启用详细日志 */
  verbose?: boolean;
  /** 是否输出JSON格式 */
  jsonOutput?: boolean;
  /** 是否打印敏感信息 */
  showSensitive?: boolean;
}

export interface ConnectionStatus {
  connected: boolean;
  latencyMs?: number;
  lastPing?: number;
  errorCount: number;
  totalRequests: number;
  failedRequests: number;
}

export interface MessageTrace {
  messageId: string;
  type: string;
  direction: 'inbound' | 'outbound';
  size: number;
  timestamp: number;
  durationMs?: number;
  error?: string;
}

export interface DebugStats {
  uptime: number;
  connections: Map<string, ConnectionStatus>;
  messages: MessageTrace[];
  errors: Array<{ timestamp: number; error: string; context?: string }>;
}

class BridgeDebugger {
  private options: DebugOptions;
  private startTime: number;
  private connections: Map<string, ConnectionStatus>;
  private messages: MessageTrace[];
  private errors: Array<{ timestamp: number; error: string; context?: string }>;

  constructor(options: DebugOptions = {}) {
    this.options = {
      verbose: false,
      jsonOutput: false,
      showSensitive: false,
      ...options,
    };
    this.startTime = Date.now();
    this.connections = new Map();
    this.messages = [];
    this.errors = [];
  }

  updateOptions(options: Partial<DebugOptions>): void {
    this.options = { ...this.options, ...options };
  }

  recordConnection(connectionId: string, status: ConnectionStatus): void {
    this.connections.set(connectionId, status);
    if (this.options.verbose) {
      this.log(
        `Connection ${connectionId}: ${status.connected ? 'connected' : 'disconnected'}`
      );
    }
  }

  recordMessage(trace: MessageTrace): void {
    this.messages.push(trace);
    if (this.messages.length > 1000) {
      this.messages = this.messages.slice(-500);
    }
    if (this.options.verbose) {
      this.log(
        `Message ${trace.direction} [${trace.type}]: ${trace.size} bytes in ${trace.durationMs}ms`
      );
    }
  }

  recordError(error: string, context?: string): void {
    this.errors.push({
      timestamp: Date.now(),
      error,
      context,
    });
    if (this.errors.length > 100) {
      this.errors = this.errors.slice(-50);
    }
    this.log(`ERROR: ${error}${context ? ` (${context})` : ''}`);
  }

  private log(message: string): void {
    if (this.options.jsonOutput) {
      logger.info(
        JSON.stringify({
          type: 'debug',
          timestamp: Date.now(),
          message,
        })
      );
    } else {
      logger.info(`[Bridge Debug] ${message}`);
    }
  }

  getStats(): DebugStats {
    return {
      uptime: Date.now() - this.startTime,
      connections: new Map(this.connections),
      messages: [...this.messages],
      errors: [...this.errors],
    };
  }

  getConnectionStatus(connectionId: string): ConnectionStatus | undefined {
    return this.connections.get(connectionId);
  }

  getMessageTraces(limit: number = 100): MessageTrace[] {
    return this.messages.slice(-limit);
  }

  getErrorLogs(
    limit: number = 50
  ): Array<{ timestamp: number; error: string; context?: string }> {
    return this.errors.slice(-limit);
  }

  clear(): void {
    this.connections.clear();
    this.messages = [];
    this.errors = [];
    this.log('Debug state cleared');
  }

  generateReport(): string {
    const stats = this.getStats();
    const lines: string[] = [];

    lines.push('=== Bridge Debug Report ===');
    lines.push(`Timestamp: ${new Date().toISOString()}`);
    lines.push(`Uptime: ${Math.floor(stats.uptime / 1000)}s`);
    lines.push('');
    lines.push('--- Connections ---');
    lines.push(`Total: ${stats.connections.size}`);

    for (const [id, status] of stats.connections) {
      lines.push(
        `  ${id}: ${status.connected ? 'connected' : 'disconnected'}` +
          (status.latencyMs ? ` (${status.latencyMs}ms)` : '') +
          ` - ${status.errorCount} errors`
      );
    }

    lines.push('');
    lines.push('--- Messages ---');
    lines.push(`Total: ${stats.messages.length}`);
    const inbound = stats.messages.filter((m) => m.direction === 'inbound');
    const outbound = stats.messages.filter((m) => m.direction === 'outbound');
    lines.push(
      `  Inbound: ${inbound.length} (${inbound.reduce((s, m) => s + m.size, 0)} bytes)`
    );
    lines.push(
      `  Outbound: ${outbound.length} (${outbound.reduce((s, m) => s + m.size, 0)} bytes)`
    );

    lines.push('');
    lines.push('--- Errors ---');
    lines.push(`Total: ${stats.errors.length}`);
    for (const err of stats.errors.slice(-10)) {
      lines.push(`  [${new Date(err.timestamp).toISOString()}] ${err.error}`);
    }

    return lines.join('\n');
  }
}

let globalDebugger: BridgeDebugger | undefined;

export function getDebugger(options?: DebugOptions): BridgeDebugger {
  if (!globalDebugger) {
    globalDebugger = new BridgeDebugger(options);
  }
  return globalDebugger;
}

export function resetDebugger(): void {
  globalDebugger = undefined;
}
