/**
 * Config命令（旧版）
 * 管理配置（旧版，请使用 builtin/config）
 */

// 使用CommonJS的require方法来导入配置模块
const configModule = require('../../utils/config.js');

/**
 * Config命令（旧版）
 */
export const configLegacyCommand = {
  name: 'config-legacy',
  description: '管理配置（旧版，请使用 /config）',
  type: 'local',
  load: async () => {
    return {
      execute: async (args: any, context: any) => {
        const parts = args.trim().split(' ');

        if (parts.length === 0) {
          // 显示所有配置
          const config = configModule.getConfig();
          return {
            success: true,
            data: {
              message: 'Current configuration',
              config,
            },
          };
        } else if (parts.length === 1) {
          // 显示特定配置项
          const key = parts[0];
          const value = configModule.getConfigValue(key);
          return {
            success: true,
            data: {
              message: `Configuration value for ${key}`,
              key,
              value,
            },
          };
        } else if (parts.length >= 2) {
          // 设置配置项
          const key = parts[0];
          const value = parts.slice(1).join(' ');

          // 尝试解析值
          let parsedValue;
          try {
            parsedValue = JSON.parse(value);
          } catch {
            parsedValue = value;
          }

          configModule.setConfigValue(key, parsedValue);
          return {
            success: true,
            data: {
              message: `Configuration value set for ${key}`,
              key,
              value: parsedValue,
            },
          };
        }

        return {
          success: false,
          error: 'Invalid arguments',
        };
      },
    };
  },
};

export default configLegacyCommand;
