/**
 * mail 模块主类
 * 负责邮件模块生命周期管理、Feature Flag 路由、EmailTool 初始化
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { feature } from '@modules/core';
import { isBuildVariant } from '@modules/core/featureFlags';

import { MailModuleStatus as Status } from './types';
import type { MailModuleStatus } from './types';

const logger = new Logger({
  module: 'mail:lifecycle',
  level: LogLevel.INFO,
});

export class MailModule {
  private status: MailModuleStatus = Status.UNINITIALIZED;
  private emailTool: any = null; // EmailTool from @pyapp/office

  /**
   * 模块加载阶段
   */
  async onLoad(): Promise<void> {
    logger.info('MailModule 加载中...');
  }

  /**
   * 就绪阶段：按 Feature Flag 路由，动态加载 EmailTool
   */
  async onReady(): Promise<void> {
    if (!isBuildVariant('enterprise')) {
      logger.info('非 enterprise 构建变体，跳过 mail 模块');
      return;
    }

    if (!feature('MAIL_MODULE')) {
      logger.info('MAIL_MODULE feature flag 已关闭，跳过 mail 模块');
      return;
    }

    // 动态导入 EmailTool（packages 目录不在 tsconfig include 中，运行时动态加载）
    try {
      const { EmailTool } =
        await import('../../../packages/office/email/EmailTool');
      this.emailTool = new EmailTool();

      // 加载已保存的邮箱配置
      await this.emailTool.configService.load();

      // TODO: 注册到 ToolManager
      // ToolManager.registerTool('mail:send', this.emailTool.send.bind(this.emailTool));
      // ToolManager.registerTool('mail:inbox', this.emailTool.inbox.bind(this.emailTool));

      this.status = Status.READY;
      logger.info('MailModule 就绪', {
        accounts: this.emailTool.getAccounts().length,
      });
    } catch (error) {
      logger.warn('邮件模块初始化失败', { error: String(error) });
      this.status = Status.DEGRADED;
    }
  }

  /**
   * 销毁阶段
   */
  async onDestroy(): Promise<void> {
    logger.info('MailModule 销毁中...');
    this.emailTool = null;
    this.status = Status.SHUTDOWN;
  }

  getStatus(): MailModuleStatus {
    return this.status;
  }
}
