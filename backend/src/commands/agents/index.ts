/**
 * Agents命令（旧版）
 * 管理智能代理（旧版，tools/ai/agents 为新版）
 */

import type { Command } from '../types/index.js';

/**
 * Agents命令（旧版）
 */
export const agentsLegacyCommand: Command = {
  name: 'agents-legacy',
  description: '管理智能代理（旧版）',
  type: 'local',
  load: async () => {
    return {
      execute: async (args: string, context: any) => {
        // 这里可以实现代理管理逻辑
        // 暂时返回一个简单的响应
        return {
          success: true,
          data: {
            message: 'Agents command executed',
            args,
          },
        };
      },
    };
  },
};

export default agentsLegacyCommand;
