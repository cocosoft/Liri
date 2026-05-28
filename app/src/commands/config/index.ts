// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
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
