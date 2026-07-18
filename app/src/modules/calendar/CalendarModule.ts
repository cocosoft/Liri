/**
 * calendar 模块主类
 * 负责日历模块生命周期、CalendarTool 集成与 ToolManager 注册
 */

import { Logger, LogLevel } from '@modules/monitoring';
import { feature } from '@modules/core';
import { isBuildVariant } from '@modules/core/featureFlags';
import { globalToolManager } from '@modules/tools';

import { CalendarModuleStatus as Status } from './types';
import type { CalendarModuleStatus } from './types';
import { createCalendarAddTool } from './tools/CalendarToolWrap';

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

    try {
      // 验证 CalendarTool 可用性（预加载确保 .ics 存储目录就绪）
      const { CalendarTool } =
        await import('../../../packages/office/calendar/CalendarTool');
      new CalendarTool(); // 触发 ensureStorageDir()

      // 注册日历工具到全局 ToolManager
      globalToolManager.registerTool(createCalendarAddTool());

      this.status = Status.READY;
      logger.info('CalendarModule 就绪 — 日历工具已注册');
    } catch (error) {
      logger.warn('日历模块初始化失败', { error: String(error) });
      this.status = Status.DEGRADED;
    }
  }

  async onDestroy(): Promise<void> {
    logger.info('CalendarModule 销毁中...');
    this.status = Status.SHUTDOWN;
  }

  getStatus(): CalendarModuleStatus {
    return this.status;
  }
}
