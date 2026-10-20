import { TOOL_NAME_CONSTANTS } from '../toolNameConstants';
/**
 * Monitor工具
 * 用于监控系统状态
 */
import { BaseTool } from '../BaseTool.js';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index.js';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('tools:MonitorTool:MonitorTool');

/**
 * U-03（2026-10-19）：`monitor` 的**模型可见出参结构**（JSON Schema）。
 *
 * `metric` 恒存在；其余字段随指标类型分三类：
 * - `memory`：heap/RSS 字节与 MB 值；
 * - `cpu`：`usage.user` / `usage.system`；
 * - `disk` / `network`：仅 `message`（本实现未完整实现）。
 */
const MONITOR_OUTPUT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    metric: {
      type: 'string',
      enum: ['memory', 'cpu', 'disk', 'network'],
      description: '实际监控的指标类型',
    },
    heapTotal: { type: 'number', description: 'V8 堆总量（字节）' },
    heapUsed: { type: 'number', description: 'V8 已用堆（字节）' },
    external: { type: 'number', description: '外部内存（字节）' },
    rss: { type: 'number', description: '常驻内存集（字节）' },
    heapTotalMB: { type: 'number', description: 'V8 堆总量（MB）' },
    heapUsedMB: { type: 'number', description: 'V8 已用堆（MB）' },
    usage: {
      type: 'object',
      description: 'CPU 占用（cpu 分支）',
      properties: {
        user: { type: 'number', description: '用户态微秒数' },
        system: { type: 'number', description: '内核态微秒数' },
      },
      required: ['user', 'system'],
    },
    message: {
      type: 'string',
      description: '未实现指标（disk/network 分支）的提示',
    },
  },
  required: ['metric'],
};

/**
 * Monitor工具类
 */
export class MonitorTool extends BaseTool {
  /**
   * 工具名称
   */
  name = TOOL_NAME_CONSTANTS.monitor;

  /**
   * 工具描述
   */
  description = '监控系统状态和性能';

  /** U-03（2026-10-19）：模型可见出参结构（按 metric 分支） */
  override outputJsonSchema = MONITOR_OUTPUT_JSON_SCHEMA;

  /**
   * 工具参数
   */
  params: ToolParam[] = [
    {
      name: 'metric',
      type: 'string',
      description: '要监控的指标类型',
      required: false,
      default: 'memory',
      enum: ['memory', 'cpu', 'disk', 'network'],
    },
  ];

  /**
   * 执行工具
   * @param input 工具输入
   * @param context 工具使用上下文
   * @returns 工具执行结果
   */
  async execute(input: any, context: ToolUseContext): Promise<ToolResult> {
    try {
      const { metric = 'memory' } = input || {};

      let result: any = {};

      switch (metric) {
        case 'memory':
          result = this.getMemoryUsage();
          break;
        case 'cpu':
          result = this.getCPUUsage();
          break;
        case 'disk':
          result = this.getDiskUsage();
          break;
        case 'network':
          result = this.getNetworkUsage();
          break;
        default:
          return {
            success: false,
            error:
              'Invalid metric type. Must be one of: memory, cpu, disk, network.',
          };
      }

      return {
        success: true,
        data: {
          metric,
          ...result,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to monitor: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * 获取内存使用情况
   * @returns 内存使用情况
   */
  private getMemoryUsage(): any {
    const memoryUsage = process.memoryUsage();
    return {
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
      rss: memoryUsage.rss,
      heapTotalMB: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      heapUsedMB: Math.round(memoryUsage.heapUsed / 1024 / 1024),
    };
  }

  /**
   * 获取CPU使用情况
   * @returns CPU使用情况
   */
  private getCPUUsage(): any {
    // 简化实现，返回当前CPU使用率
    return {
      usage: process.cpuUsage(),
    };
  }

  /**
   * 获取磁盘使用情况
   * @returns 磁盘使用情况
   */
  private getDiskUsage(): any {
    // 简化实现，返回磁盘使用情况
    return {
      message: 'Disk usage monitoring not fully implemented',
    };
  }

  /**
   * 获取网络使用情况
   * @returns 网络使用情况
   */
  private getNetworkUsage(): any {
    // 简化实现，返回网络使用情况
    return {
      message: 'Network usage monitoring not fully implemented',
    };
  }
}
