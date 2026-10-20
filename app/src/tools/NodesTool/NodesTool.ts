import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * NodesTool
 * 对标OpenClaw nodes 工具
 * 节点管理工具 - 管理分布式节点/工作进程
 */

import { BaseTool } from '../BaseTool';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index';
import { ToolTag } from '../types/index';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:NodesTool:NodesTool');

export interface NodeInfo {
  id: string;
  name: string;
  status: 'online' | 'offline' | 'busy' | 'error';
  host: string;
  port: number;
  version: string;
  uptime: number;
  capabilities: string[];
  lastHeartbeat: string;
  loadAvg: number;
  memoryUsage: number;
}

export interface NodesToolParams {
  action: 'list' | 'status' | 'add' | 'remove' | 'ping';
  nodeId?: string;
  name?: string;
  host?: string;
  port?: number;
  capabilities?: string[];
}

/**
 * U-03（2026-10-20）：`nodes` 的模型可见出参结构（多 action 分支并集，根级仅 `action` 恒存在）。
 *
 * ⚠️ 当前实现是**未接线的占位**（`list` 恒空、`status` 恒 `unknown`、`ping` 恒 `alive:false`、
 * `add` 不落库）—— 本声明只描述**出口形状**，不承诺节点可用性；接通真实节点注册表后
 * 形状不变，故无需改声明。
 */
const NODES_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  description: '按 action 分支变化：根级只有 action 恒存在',
  properties: {
    action: {
      type: 'string',
      enum: ['list', 'status', 'add', 'remove', 'ping'],
      description: '本次执行的操作',
    },
    nodes: {
      type: 'array',
      description: '节点列表（list 分支）',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '节点 ID' },
          name: { type: 'string', description: '节点名称' },
          status: {
            type: 'string',
            enum: ['online', 'offline', 'busy', 'error'],
            description: '节点状态',
          },
          host: { type: 'string', description: '主机地址' },
          port: { type: 'number', description: '端口' },
          version: { type: 'string', description: '节点版本' },
          uptime: { type: 'number', description: '在线时长（秒）' },
          capabilities: {
            type: 'array',
            items: { type: 'string' },
            description: '节点能力列表',
          },
          lastHeartbeat: { type: 'string', description: '最近心跳时间' },
          loadAvg: { type: 'number', description: '平均负载' },
          memoryUsage: { type: 'number', description: '内存占用（字节）' },
        },
        required: ['id', 'name', 'status'],
      },
    },
    node: {
      type: 'object',
      description: '注册的节点（add 分支）',
      properties: {
        id: { type: 'string', description: '节点 ID' },
        name: { type: 'string', description: '节点名称' },
        host: { type: 'string', description: '主机地址' },
        port: { type: 'number', description: '端口' },
      },
      required: ['id', 'name', 'host', 'port'],
    },
    nodeId: {
      type: 'string',
      description: '目标节点 ID（status/remove/ping 分支）',
    },
    status: {
      type: 'string',
      enum: ['online', 'offline', 'busy', 'error', 'unknown'],
      description: '节点状态（status 分支；未接线时恒 unknown）',
    },
    alive: { type: 'boolean', description: '连通性探测结果（ping 分支）' },
  },
  required: ['action'],
};

export class NodesTool extends BaseTool {
  name = TOOL_NAME_CONSTANTS.nodes;

  description =
    '管理分布式节点与工作进程。支持列出、状态检查、添加、移除和 ping 节点。';

  override tags = [ToolTag.SYSTEM];

  /** U-03（2026-10-20）：模型可见出参结构（多 action 分支并集） */
  override outputJsonSchema = NODES_OUTPUT_JSON_SCHEMA;

  params: ToolParam[] = [
    {
      name: 'action',
      type: 'string',
      enum: ['list', 'status', 'add', 'remove', 'ping'],
      description: '要对节点执行的操作',
      required: true,
    },
    {
      name: 'nodeId',
      type: 'string',
      description: '目标节点 ID（status/remove/ping 时必填）',
      required: false,
    },
    {
      name: 'name',
      type: 'string',
      description: '节点名称（add 时必填）',
      required: false,
    },
    {
      name: 'host',
      type: 'string',
      description: '节点主机地址（add 时必填）',
      required: false,
    },
    {
      name: 'port',
      type: 'number',
      description: '节点端口号（add 时必填）',
      required: false,
    },
    {
      name: 'capabilities',
      type: 'array',
      description: '节点能力列表（add 时可选）',
      required: false,
    },
  ];

  override aliases = ['node', 'cluster'];
  override searchHint = 'Manage distributed nodes and worker processes';

  override async execute(
    input: Record<string, unknown>,
    _context: ToolUseContext
  ): Promise<ToolResult> {
    try {
      const params = input as unknown as NodesToolParams;

      if (!params.action || typeof params.action !== 'string') {
        return {
          success: false,
          error: 'action is required and must be a string',
        };
      }

      const validActions = ['list', 'status', 'add', 'remove', 'ping'];
      if (!validActions.includes(params.action)) {
        return {
          success: false,
          error: `Invalid action "${params.action}". Must be one of: ${validActions.join(', ')}`,
        };
      }

      switch (params.action) {
        case 'list': {
          return {
            success: true,
            data: { action: 'list', nodes: [] },
            output: 'No nodes currently registered.',
          };
        }

        case 'status': {
          if (!params.nodeId) {
            return {
              success: false,
              error: 'nodeId is required for status action',
            };
          }
          return {
            success: true,
            data: {
              action: 'status',
              nodeId: params.nodeId,
              status: 'unknown',
            },
            output: `Node "${params.nodeId}" status: unknown (not found or not connected).`,
          };
        }

        case 'add': {
          if (!params.name || !params.host || !params.port) {
            return {
              success: false,
              error: 'name, host, and port are required for add action',
            };
          }
          return {
            success: true,
            data: {
              action: 'add',
              node: {
                id: `${params.name}-${Date.now()}`,
                name: params.name,
                host: params.host,
                port: params.port,
              },
            },
            output: `Node "${params.name}" registered at ${params.host}:${params.port}.`,
          };
        }

        case 'remove': {
          if (!params.nodeId) {
            return {
              success: false,
              error: 'nodeId is required for remove action',
            };
          }
          return {
            success: true,
            data: { action: 'remove', nodeId: params.nodeId },
            output: `Node "${params.nodeId}" removed.`,
          };
        }

        case 'ping': {
          if (!params.nodeId) {
            return {
              success: false,
              error: 'nodeId is required for ping action',
            };
          }
          return {
            success: true,
            data: { action: 'ping', nodeId: params.nodeId, alive: false },
            output: `Node "${params.nodeId}" ping result: no response (unreachable).`,
          };
        }

        default:
          return {
            success: false,
            error: `Unhandled action: ${params.action}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Nodes tool failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

export function createNodesTool(): NodesTool {
  return new NodesTool();
}
