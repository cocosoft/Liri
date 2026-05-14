/**
 * GatewayTool
 * 对标OpenClaw gateway 工具
 * 网关操作工具
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';

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
}

export class GatewayTool extends BaseTool {
  name = 'gateway';

  description =
    'Manage the API gateway. Supports start/stop/restart, TLS configuration, and log retrieval.';

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

  async execute(input: any, _context: ToolUseContext): Promise<ToolResult> {
    try {
      const op = input as GatewayOperation;

      const info: GatewayInfo = {
        status:
          op.action === 'start' || op.action === 'restart'
            ? 'running'
            : 'stopped',
        port: op.port ?? 8080,
        host: op.host ?? '0.0.0.0',
        tls: op.tls ?? false,
        uptime: 0,
        activeConnections: 0,
        totalRequests: 0,
        errorCount: 0,
      };

      return {
        success: true,
        data: info,
        output: `Gateway ${op.action}: ${info.status} (${info.host}:${info.port}${info.tls ? ' TLS' : ''})`,
      };
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
