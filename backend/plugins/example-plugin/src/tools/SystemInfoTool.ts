/**
 * SystemInfoTool 工具实现
 * 获取系统基本信息
 */

import type {
  Tool,
  ToolUseContext,
  ToolResult,
  ToolParam
} from '../../../src/tools/types';

/**
 * 系统信息输入接口
 */
export interface SystemInfoInput {
  // 无需输入参数
}

/**
 * 创建 SystemInfoTool 工具
 */
export function createSystemInfoTool(): Tool {
  return {
    name: 'system_info',
    description: '获取系统基本信息',
    params: [],
    isReadOnly: () => true,
    async execute(
      input: SystemInfoInput, 
      context: ToolUseContext
    ): Promise<ToolResult> {
      return {
        success: true,
        output: JSON.stringify({
          platform: process.platform,
          arch: process.arch,
          nodeVersion: process.version,
          pid: process.pid,
          cwd: context.cwd,
          timestamp: new Date().toISOString()
        }, null, 2)
      };
    }
  };
}

export const SystemInfoTool = createSystemInfoTool();
