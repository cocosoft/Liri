/**
 * Monitor工具
 * 用于监控系统状态
 */
import { BaseTool } from '../BaseTool.js';
import type { ToolResult, ToolUseContext, ToolParam } from '../types/index.js';

/**
 * Monitor工具类
 */
export class MonitorTool extends BaseTool {
  /**
   * 工具名称
   */
  name = 'MonitorTool';

  /**
   * 工具描述
   */
  description = '监控系统状态和性能';

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
