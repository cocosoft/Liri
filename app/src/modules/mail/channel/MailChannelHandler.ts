/**
 * 邮件模块渠道处理器
 * 支持渠道内发送邮件通知
 *
 * ⚠️ 2026-10-31（P0.5）：原实现两处「假陈述」已改为**如实**——
 * ① `sendFromChannel` 只打一行 info 就正常返回（什么都没发）⇒ 改抛 `MAIL_CHANNEL_UNIMPLEMENTED`；
 * ② `registerTools()` 声称「工具已注册」但**零注册** ⇒ 改 warn。
 * 与 `DocChannelHandler`（G-12）已确立的「未接线一律显式报错，不假装成功」同口径。
 *
 * 落点（接线时）：渠道出站走 `ChannelRegistry.sendMessage`、邮件走 `mail:send`（`MailSendTool`）。
 * 注：原注释所指 `ChannelManager` 在本仓**已无实体**（project_rules §1.14 订正 2026-10-12）。
 */

import { getLogger } from '@openliri/kernel/loggerFacade.js';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
const logger = getLogger('mail:channel');

/**
 * MailChannelHandler
 */
export class MailChannelHandler {
  /**
   * 渠道内发送邮件并通知结果
   *
   * 未接线：显式报错（不返回成功，避免调用方误以为已发送）。
   */
  async sendFromChannel(
    channelId: string,
    args: { to: string; subject: string; body: string }
  ): Promise<void> {
    logger.warn('渠道邮件发送未实现（未接线）', {
      channelId,
      subject: args.subject,
    });
    throw new AppError(
      '渠道内发送邮件功能未实现',
      ErrorCategory.OPERATION,
      ErrorSeverity.MEDIUM,
      'MAIL_CHANNEL_UNIMPLEMENTED',
      { channelId, to: args.to }
    );
  }

  /**
   * 注册渠道感知工具到 ToolManager
   *
   * 未接线：不再输出「已注册」误导日志（对齐 G-12）。
   */
  registerTools(): void {
    logger.warn(
      '邮件渠道工具未注册：MailChannelHandler 尚未接入 ToolManager（P0.5）'
    );
  }
}
