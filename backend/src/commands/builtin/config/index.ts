/**
 * 配置命令
 * 管理配置
 */
import type { Command } from '../../types/index.js';

/**
 * 配置命令
 */
export const configCommand: Command = {
  type: 'action',
  name: 'config',
  description: '管理配置',
  aliases: ['cfg'],
  argumentHint: '[get|set|list]',
  whenToUse: '当你需要管理系统配置时',
  load: async () => ({
    execute: async (args: string) => {
      // 模拟配置存储
      const configStore: Record<string, any> = {
        model: 'gpt-4',
        temperature: 0.7,
        maxTokens: 1000,
        apiKey: '****',
        theme: 'dark',
      };

      const parts = args.split(/\s+/);
      const subcommand = parts[0];
      const restArgs = parts.slice(1).join(' ');

      switch (subcommand) {
        case 'get':
          const key = restArgs;
          if (key in configStore) {
            return {
              success: true,
              message: `${key}: ${configStore[key]}`,
            };
          } else {
            return {
              success: false,
              error: `Config key not found: ${key}`,
            };
          }

        case 'set':
          const [setKey, ...valueParts] = restArgs.split(/\s+/);
          const value = valueParts.join(' ');
          if (setKey) {
            configStore[setKey] = value;
            return {
              success: true,
              message: `Set ${setKey} to: ${value}`,
            };
          } else {
            return {
              success: false,
              error: 'Missing config key',
            };
          }

        case 'list':
          const configList = Object.entries(configStore)
            .map(([key, value]) => `  ${key}: ${value}`)
            .join('\n');
          return {
            success: true,
            message: `Configuration:\n${configList}`,
          };

        default:
          return {
            success: false,
            error: `Invalid subcommand. Usage: /config [get|set|list]`,
          };
      }
    },
  }),
};

