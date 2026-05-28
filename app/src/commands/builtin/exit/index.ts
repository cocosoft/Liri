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
 * 退出命令
 * 退出系统
 */
import type { Command } from '@modules/commands/types';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';

const logger = new Logger({ level: LogLevel.INFO });

const GOODBYE_MESSAGES = [
  'Goodbye!',
  'See ya!',
  'Bye!',
  'Catch you later!',
  'Farewell!',
];

function getRandomGoodbyeMessage(): string {
  return GOODBYE_MESSAGES[Math.floor(Math.random() * GOODBYE_MESSAGES.length)];
}

/**
 * 退出命令
 */
export const exitCommand: Command = {
  type: 'action',
  name: 'exit',
  description: '退出应用程序',
  aliases: ['quit', 'q'],
  argumentHint: '[--force]',
  whenToUse: '当你需要退出PY_APP时',
  load: async () => ({
    execute: async (args: string, context: any) => {
      const parts = args.trim().split(/\s+/);
      const force = parts.includes('--force') || parts.includes('-f');

      if (!force) {
        return {
          success: true,
          message: `Are you sure you want to exit?\n${getRandomGoodbyeMessage()}\n\nUse /exit --force to exit immediately without confirmation.`,
          data: {
            requiresConfirmation: true,
            command: 'exit',
            args: '--force',
          },
        };
      }

      // 保存当前会话（如果存在）
      if (context.chatManager && context.sessionId) {
        try {
          await context.chatManager.saveSession(context.sessionId);
        } catch (error) {
          logger.warning('Failed to save session on exit:', { error });
        }
      }

      logger.info(`${getRandomGoodbyeMessage()} Exiting PY_APP...`);

      // 延迟退出以显示消息
      setTimeout(() => {
        process.exit(0);
      }, 100);

      return {
        success: true,
        message: `${getRandomGoodbyeMessage()} Exiting...`,
      };
    },
  }),
};
