/**
 * UnattendedModeManager — 离线/无人值守模式管理器
 *
 * 当 UNATTENDED_MODE 启用时：
 * - 所有需要用户交互的操作自动降级为 Inbox 排队
 * - PDCA 计划自动审批通过
 * - 与 CronScheduler 结合实现自主运行
 */

import { getLogger } from '@modules/monitoring';
import { FEATURE_FLAGS } from '@modules/core/featureFlags.js';
import { inboxManager } from '@modules/runtime/InboxManager.js';
import type { InboxItemType } from '@modules/runtime/InboxManager.js';

const logger = getLogger('runtime:unattended');

export class UnattendedModeManager {
  /** 检查是否处于无人值守模式 */
  isUnattended(): boolean {
    return (FEATURE_FLAGS as Record<string, boolean>).UNATTENDED_MODE === true;
  }

  /** 启用/禁用无人值守模式 */
  setEnabled(enabled: boolean): void {
    (FEATURE_FLAGS as Record<string, boolean>).UNATTENDED_MODE = enabled;
    logger.info('Unattended mode toggled', { enabled });
  }

  /**
   * 在无人值守模式下将交互降级为 Inbox
   * @returns true 表示已降级（调用方可跳过阻塞等待）
   */
  async delegateToInbox(params: {
    sessionId: string;
    type: InboxItemType;
    title: string;
    message: string;
    source: string;
    options?: string[];
  }): Promise<boolean> {
    if (!this.isUnattended()) return false;

    await inboxManager.submit({
      sessionId: params.sessionId,
      type: params.type,
      title: `[无人值守] ${params.title}`,
      message: params.message,
      options: params.options,
      offlineCapable: true,
      source: params.source,
    });

    logger.info('Interaction delegated to Inbox (unattended)', {
      type: params.type,
      title: params.title,
    });
    return true;
  }

  /**
   * 无人值守模式下应自动批准计划
   */
  shouldAutoApprove(): boolean {
    return this.isUnattended();
  }
}

/** 全局单例 */
export const unattendedMode = new UnattendedModeManager();
