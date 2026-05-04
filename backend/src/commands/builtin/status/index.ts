/**
 * 状态命令
 * 显示系统状态信息
 */
import type { Command } from '../../types/index.js';
import { getCommandManager } from '../../manager/CommandManager.js';

/**
 * 状态命令
 */
export const statusCommand: Command = {
  type: 'action',
  name: 'status',
  description: '显示系统状态信息',
  aliases: ['st'],
  whenToUse: '当你需要了解系统当前状态时',
  load: async () => ({
    execute: async () => {
      const commandManager = getCommandManager();

      // 获取系统状态信息
      const statusInfo = {
        commands: commandManager.getCommandCount(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      };

      // 格式化内存使用信息
      const formatMemory = (bytes: number): string => {
        return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
      };

      return {
        success: true,
        message:
          `System Status:\n` +
          `  Commands: ${statusInfo.commands}\n` +
          `  Uptime: ${statusInfo.uptime.toFixed(2)} seconds\n` +
          `  Memory Usage:\n` +
          `    Heap Total: ${formatMemory(statusInfo.memory.heapTotal)}\n` +
          `    Heap Used: ${formatMemory(statusInfo.memory.heapUsed)}\n` +
          `    RSS: ${formatMemory(statusInfo.memory.rss)}\n` +
          `  Node.js Version: ${statusInfo.nodeVersion}\n` +
          `  Platform: ${statusInfo.platform}\n` +
          `  Architecture: ${statusInfo.arch}`,
      };
    },
  }),
};

