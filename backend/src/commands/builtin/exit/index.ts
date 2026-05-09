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

      console.log(`${getRandomGoodbyeMessage()} Exiting PY_APP...`);

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
