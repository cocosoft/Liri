/**
 * calendar 模块主类
 * 负责日历模块生命周期、Chronos reminder 注册
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { feature } from '@modules/core';
import { isBuildVariant } from '@modules/core/featureFlags';

import { CalendarModuleStatus as Status } from './types';
import type { CalendarModuleStatus } from './types';

const logger = new Logger({
  module: 'calendar:lifecycle',
  level: LogLevel.INFO,
});

export class CalendarModule {
  private status: CalendarModuleStatus = Status.UNINITIALIZED;

  async onLoad(): Promise<void> {
    logger.info('CalendarModule 加载中...');
  }

  async onReady(): Promise<void> {
    if (!isBuildVariant('enterprise')) {
      logger.info('非 enterprise 构建变体，跳过 calendar 模块');
      return;
    }

    if (!feature('CALENDAR_MODULE')) {
      logger.info('CALENDAR_MODULE feature flag 已关闭，跳过 calendar 模块');
      return;
    }

    this.status = Status.READY;
    logger.info('CalendarModule 就绪');
  }

  async onDestroy(): Promise<void> {
    logger.info('CalendarModule 销毁中...');
    this.status = Status.SHUTDOWN;
  }

  getStatus(): CalendarModuleStatus {
    return this.status;
  }
}
