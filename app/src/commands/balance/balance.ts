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
 * Balance 命令实现
 * 查询供应商账户余额
 */

import type { CommandContext, CommandResult } from '@modules/commands';
import { checkBalance, formatBalanceResult } from '@modules/ai';
import { providerManager } from '@modules/ai';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:balance:balance',
  level: LogLevel.INFO,
});

const balanceCommand = {
  async execute(
    args: string,
    _context: CommandContext
  ): Promise<CommandResult> {
    const trimmed = args.trim();
    const parts = trimmed.split(/\s+/).filter(Boolean);

    try {
      // 无参数：显示帮助
      if (parts.length === 0) {
        return {
          success: true,
          message: `Balance 命令 — 查询供应商账户余额
===============================

用法:
  /balance <baseUrl> <apiKey>    直接查询 (自动检测供应商类型)
  /balance <providerId>          使用已保存的供应商

示例:
  /balance https://api.deepseek.com sk-xxx
  /balance abc-123-456

支持的供应商: DeepSeek, SiliconFlow, OpenRouter, Novita AI`,
        };
      }

      let baseUrl: string;
      let apiKey: string;

      // 单个参数：可能是供应商ID
      if (parts.length === 1) {
        const maybeId = parts[0];

        // 如果是 URL，则需要第二个参数 apiKey
        if (maybeId.startsWith('http')) {
          return {
            success: false,
            message: '请提供 API Key: /balance <baseUrl> <apiKey>',
          };
        }

        // 尝试从已保存的供应商中查找
        await providerManager.initialize();
        const provider = await providerManager.getProvider(maybeId);

        if (!provider) {
          return {
            success: false,
            message: `未找到供应商: ${maybeId}\n使用 /provider list 查看已保存的供应商，或使用 /balance <baseUrl> <apiKey> 直接查询。`,
          };
        }

        if (!provider.apiKey) {
          return {
            success: false,
            message: `供应商 ${provider.name} 未设置 API Key，无法查询余额。`,
          };
        }

        baseUrl = provider.baseUrl;
        apiKey = provider.apiKey;
      } else {
        baseUrl = parts[0];
        apiKey = parts.slice(1).join(' ');
      }

      // 执行查询
      const result = await checkBalance(baseUrl, apiKey);
      const message = formatBalanceResult(result);

      return { success: result.success, message };
    } catch (error) {
      return {
        success: false,
        message: `余额查询失败: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

export default balanceCommand;
