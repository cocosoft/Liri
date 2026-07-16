/**
 * 邮件模块渠道处理器
 * 支持渠道内发送邮件通知
 */

import { Logger, LogLevel } from '@modules/monitoring';

const logger = new Logger({
  module: 'mail:channel',
  level: LogLevel.INFO,
});

/**
 * MailChannelHandler
 * 通过 DI 注入 ChannelManager 实例
 */
export class MailChannelHandler {
  constructor(/* channelManager: ChannelManager */) {}

  /**
   * 渠道内发送邮件并通知结果
   */
  async sendFromChannel(
    channelId: string,
    args: { to: string; subject: string; body: string }
  ): Promise<void> {
    logger.info('渠道邮件发送', { channelId, subject: args.subject });
    // TODO: EmailTool.send + channelManager.sendText
  }

  /**
   * 注册渠道感知工具到 ToolManager
   */
  registerTools(): void {
    logger.info('MailChannelHandler 工具已注册');
  }
}
