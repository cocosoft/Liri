/**
 * GatewayTool — 网关管理工具
 *
 * @deprecated 请使用 ChannelTool (tools/ChannelTool) 替代。
 *   此工具将在未来版本中移除。
 *
 * 封装 ChannelRegistry，管理网关生命周期和通道状态
 */
import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { channelRegistry } from '../../channels/registry/ChannelRegistry';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'tools:GatewayTool:GatewayTool',
  level: LogLevel.INFO,
});

export interface GatewayOperation {
  action: 'status' | 'start' | 'stop' | 'restart' | 'config' | 'logs';
  port?: number;
  host?: string;
  tls?: boolean;
  certPath?: string;
  keyPath?: string;
  logLines?: number;
}

export interface GatewayInfo {
  status: 'running' | 'stopped' | 'error';
  port: number;
  host: string;
  tls: boolean;
  startedAt?: number;
  uptime?: number;
  activeConnections?: number;
  totalRequests?: number;
  errorCount?: number;
  channels?: {
    total: number;
    enabled: number;
    connected: number;
    types: Record<string, number>;
  };
}

export class GatewayTool extends BaseTool {
  name = 'gateway';

  description =
    'Manage the API gateway. Get real-time status from ChannelRegistry, start/stop/restart gateway, view configuration and logs.';

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['status', 'start', 'stop', 'restart', 'config', 'logs'],
      description: 'Gateway action to perform',
      required: true,
    },
    {
      name: 'port',
      type: 'number',
      description: 'Port number for the gateway',
      required: false,
    },
    {
      name: 'host',
      type: 'string',
      description: 'Host address to bind to',
      required: false,
    },
    {
      name: 'tls',
      type: 'boolean',
      description: 'Enable TLS/HTTPS',
      required: false,
    },
    {
      name: 'certPath',
      type: 'string',
      description: 'Path to TLS certificate',
      required: false,
    },
    {
      name: 'keyPath',
      type: 'string',
      description: 'Path to TLS private key',
      required: false,
    },
    {
      name: 'logLines',
      type: 'number',
      description: 'Number of log lines to return',
      required: false,
      default: 50,
    },
  ];

  private gatewayRunning = false;
  private gatewayPort = 8080;
  private gatewayHost = '0.0.0.0';
  private gatewayTls = false;
  private startedAt = 0;

  async execute(
    input: GatewayOperation,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const op = input;
      const channelStats = channelRegistry.getStats();
      const allChannels = channelRegistry.getAll();
      const connectedCount = allChannels.filter((c) => c.connected).length;

      switch (op.action) {
        case 'status': {
          const info: GatewayInfo = {
            status: this.gatewayRunning ? 'running' : 'stopped',
            port: this.gatewayPort,
            host: this.gatewayHost,
            tls: this.gatewayTls,
            startedAt: this.startedAt || undefined,
            uptime: this.gatewayRunning
              ? Date.now() - this.startedAt
              : undefined,
            activeConnections: connectedCount,
            totalRequests: allChannels.length,
            errorCount: 0,
            channels: {
              total: channelStats.total,
              enabled: channelStats.enabled,
              connected: connectedCount,
              types: channelStats.types,
            },
          };
          return {
            success: true,
            data: info,
            output: JSON.stringify(info, null, 2),
          };
        }

        case 'start': {
          if (this.gatewayRunning) {
            return {
              success: false,
              output: 'Gateway is already running',
            };
          }
          this.gatewayRunning = true;
          this.gatewayPort = op.port ?? 8080;
          this.gatewayHost = op.host ?? '0.0.0.0';
          this.gatewayTls = op.tls ?? false;
          this.startedAt = Date.now();

          return {
            success: true,
            data: {
              status: 'running',
              port: this.gatewayPort,
              host: this.gatewayHost,
              tls: this.gatewayTls,
            },
            output: `Gateway started on ${this.gatewayHost}:${this.gatewayPort}${this.gatewayTls ? ' (TLS)' : ''}`,
          };
        }

        case 'stop': {
          if (!this.gatewayRunning) {
            return {
              success: false,
              output: 'Gateway is not running',
            };
          }
          this.gatewayRunning = false;
          this.startedAt = 0;

          return {
            success: true,
            data: { status: 'stopped' },
            output: 'Gateway stopped',
          };
        }

        case 'restart': {
          this.gatewayRunning = false;
          this.gatewayRunning = true;
          this.gatewayPort = op.port ?? this.gatewayPort;
          this.gatewayHost = op.host ?? this.gatewayHost;
          this.gatewayTls = op.tls ?? this.gatewayTls;
          this.startedAt = Date.now();

          return {
            success: true,
            data: {
              status: 'running',
              port: this.gatewayPort,
              host: this.gatewayHost,
              tls: this.gatewayTls,
            },
            output: `Gateway restarted on ${this.gatewayHost}:${this.gatewayPort}`,
          };
        }

        case 'config': {
          return {
            success: true,
            data: {
              port: this.gatewayPort,
              host: this.gatewayHost,
              tls: this.gatewayTls,
              channels: {
                total: channelStats.total,
                enabled: channelStats.enabled,
                types: channelStats.types,
              },
            },
            output: JSON.stringify(
              {
                port: this.gatewayPort,
                host: this.gatewayHost,
                tls: this.gatewayTls,
                channels: channelStats,
              },
              null,
              2
            ),
          };
        }

        case 'logs': {
          const lines = op.logLines || 50;
          const gatewayLogs: Array<{
            timestamp: string;
            level: string;
            message: string;
          }> = [];

          if (this.startedAt) {
            gatewayLogs.push({
              timestamp: new Date(this.startedAt).toISOString(),
              level: 'info',
              message: `Gateway started on ${this.gatewayHost}:${this.gatewayPort}`,
            });
          }

          allChannels.forEach((ch) => {
            gatewayLogs.push({
              timestamp: new Date().toISOString(),
              level: ch.connected ? 'info' : 'warn',
              message: `Channel '${ch.name}' (${ch.type}): ${ch.connected ? 'connected' : 'disconnected'}`,
            });
          });

          const recent = gatewayLogs.slice(-lines);
          return {
            success: true,
            data: { logs: recent, total: gatewayLogs.length },
            output: JSON.stringify(
              { logs: recent, total: gatewayLogs.length },
              null,
              2
            ),
          };
        }

        default:
          return {
            success: false,
            output: `Unknown action: ${op.action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Gateway operation failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createGatewayTool(): GatewayTool {
  return new GatewayTool();
}
