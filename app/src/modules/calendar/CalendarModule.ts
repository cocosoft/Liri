/**
 * calendar 模块主类
 * 负责日历模块生命周期、CalendarTool 集成与 ToolManager 注册
 */

import { getLogger } from '@modules/monitoring';
import { feature } from '@modules/core';
import { globalToolManager } from '@modules/tools';

import { CalendarModuleStatus as Status } from './types';
import type { CalendarModuleStatus } from './types';
import {
  createCalendarAddTool,
  createCalendarListTool,
  createCalendarUpdateTool,
  createCalendarDeleteTool,
} from './tools/CalendarToolWrap';
import { ScheduleHook } from './ScheduleHook';

const logger = getLogger('calendar:lifecycle');

/** CalendarModule 单例 */
let calendarModuleInstance: CalendarModule | null = null;

export class CalendarModule {
  private status: CalendarModuleStatus = Status.UNINITIALIZED;
  private scheduleHook: ScheduleHook | null = null;

  /**
   * 获取模块单例
   */
  static getInstance(): CalendarModule {
    if (!calendarModuleInstance) {
      calendarModuleInstance = new CalendarModule();
    }
    return calendarModuleInstance;
  }

  async onLoad(): Promise<void> {
    logger.info('CalendarModule 加载中...');
  }

  async onReady(): Promise<void> {
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
      globalToolManager.registerTool(createCalendarListTool());
      globalToolManager.registerTool(createCalendarUpdateTool());
      globalToolManager.registerTool(createCalendarDeleteTool());

      // 初始化 ScheduleHook（事件总线 + Cron 提醒 + AI 索引）
      this.scheduleHook = new ScheduleHook();
      await this.scheduleHook.init();

      this.status = Status.READY;
      logger.info(
        'CalendarModule 就绪 — 4 个日历工具已注册，ScheduleHook 已启动'
      );
    } catch (error) {
      logger.warn('日历模块初始化失败', { error: String(error) });
      this.status = Status.DEGRADED;
    }
  }

  async onDestroy(): Promise<void> {
    logger.info('CalendarModule 销毁中...');
    // N-6：注销已注册工具，避免模块重启后工具重复注册
    for (const toolName of [
      'calendar:add',
      'calendar:list',
      'calendar:update',
      'calendar:delete',
    ]) {
      try {
        globalToolManager.unregisterTool(toolName);
      } catch {
        /* 单工具注销失败不阻塞销毁 */
      }
    }
    if (this.scheduleHook) {
      await this.scheduleHook.destroy();
      this.scheduleHook = null;
    }
    this.status = Status.SHUTDOWN;
  }

  getStatus(): CalendarModuleStatus {
    return this.status;
  }

  /**
   * 获取模块能力报告（前端的 /v1/calendar/status 数据来源）
   */
  getCapabilities() {
    return {
      status: this.status,
      toolCount: 4,
    };
  }
}
