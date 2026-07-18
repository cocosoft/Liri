/**
 * mail 模块主类
 * 负责邮件模块生命周期管理、Feature Flag 路由、EmailTool 初始化与 ToolManager 注册
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { feature } from '@modules/core';
import { isBuildVariant } from '@modules/core/featureFlags';
import { globalToolManager } from '@modules/tools';

import { MailModuleStatus as Status } from './types';
import type { MailModuleStatus } from './types';
import { createMailSendTool } from './tools/MailSendTool';

const logger = new Logger({
  module: 'mail:lifecycle',
  level: LogLevel.INFO,
});

export class MailModule {
  private status: MailModuleStatus = Status.UNINITIALIZED;
  private emailTool: any = null;

  async onLoad(): Promise<void> {
    logger.info('MailModule 加载中...');
  }

  async onReady(): Promise<void> {
    if (!isBuildVariant('enterprise')) {
      logger.info('非 enterprise 构建变体，跳过 mail 模块');
      return;
    }

    if (!feature('MAIL_MODULE')) {
      logger.info('MAIL_MODULE feature flag 已关闭，跳过 mail 模块');
      return;
    }

    try {
      const { EmailTool } =
        await import('../../../packages/office/email/EmailTool');
      this.emailTool = new EmailTool();
      await this.emailTool.configService.load();

      // 注册邮件工具到全局 ToolManager
      globalToolManager.registerTool(createMailSendTool());

      this.status = Status.READY;
      logger.info('MailModule 就绪 — 邮件工具已注册', {
        accounts: this.emailTool.getAccounts().length,
      });
    } catch (error) {
      logger.warn('邮件模块初始化失败', { error: String(error) });
      this.status = Status.DEGRADED;
    }
  }

  async onDestroy(): Promise<void> {
    logger.info('MailModule 销毁中...');
    this.emailTool = null;
    this.status = Status.SHUTDOWN;
  }

  getStatus(): MailModuleStatus {
    return this.status;
  }
}
