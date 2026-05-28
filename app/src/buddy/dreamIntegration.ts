/**
 * dreamIntegration.ts — Buddy 梦境集成模块
 *
 * 连接 AutoDream 后台事件与 Buddy 前端反馈。
 * 当 AutoDream 完成一次梦境（记忆整合）后，
 * Buddy 会生成一条通知消息，并可选地触发伙伴成长联动。
 *
 * 架构说明：
 *   AutoDream (onDreamEvent) → 桥接层 (EventBus publish) → Buddy (subscribe)
 */

import type { DreamEvent } from '../chronos/autoDream/AutoDream';
import { onDreamEvent, offDreamEvent } from '../chronos/autoDream/AutoDream';
import type { EventBus } from '../core/events/EventBus';
import { globalEventBus } from '../core/events/EventBus';
import {
  createInfoNotification,
  createAchievementNotification,
  createLevelUpNotification,
} from './notifications';
import { ifNotificationsEnabled } from './conditional';
import { getCompanion } from './companion';
import type { Companion } from './types';
import { addDreamLogEntry } from './dreamLogStore';

/** EventBus 事件名称 */
export const DREAM_EVENT = 'buddy:dream';

// ==================== 梦境成长跟踪器 ====================

/**
 * 梦境成长追踪器
 * 记录梦境完成情况，检测里程碑并触发 Buddy 成长联动
 */
export class DreamGrowthTracker {
  private totalCompleted = 0;
  private totalSessions = 0;
  private totalInsights = 0;
  private lastCompletedDate = '';
  private consecutiveDays = 0;
  private unlockedAchievements = new Set<string>();

  /**
   * 记录一次梦境完成，更新统计数据并检测里程碑
   */
  recordCompletion(event: DreamEvent): void {
    this.totalCompleted++;
    this.totalSessions += event.sessionsCount;
    this.totalInsights += event.insightsGenerated;

    const today = new Date().toISOString().slice(0, 10);
    if (this.lastCompletedDate) {
      const lastDate = new Date(this.lastCompletedDate);
      const diffDays = Math.floor(
        (Date.now() - lastDate.getTime()) / 86_400_000
      );
      if (diffDays === 1) {
        this.consecutiveDays++;
      } else if (diffDays > 1) {
        this.consecutiveDays = 1;
      }
    } else {
      this.consecutiveDays = 1;
    }
    this.lastCompletedDate = today;
  }

  /**
   * 获取当前统计快照
   */
  getStats(): DreamGrowthStats {
    return {
      totalCompleted: this.totalCompleted,
      totalSessions: this.totalSessions,
      totalInsights: this.totalInsights,
      consecutiveDays: this.consecutiveDays,
    };
  }

  /**
   * 检查是否达成新的里程碑
   */
  checkAchievements(): AchievementMilestone | null {
    const companion = getCompanion();
    if (!companion) return null;

    if (
      this.totalCompleted === 1 &&
      !this.unlockedAchievements.has('first_dream')
    ) {
      this.unlockedAchievements.add('first_dream');
      return {
        id: 'first_dream',
        title: '🌙 初次入梦',
        description: 'Buddy 完成了第一次记忆整合',
        companion,
      };
    }

    if (
      this.totalCompleted === 5 &&
      !this.unlockedAchievements.has('dreamer_5')
    ) {
      this.unlockedAchievements.add('dreamer_5');
      return {
        id: 'dreamer_5',
        title: '🌙 梦境探索者',
        description: '累计完成 5 次梦境整合',
        companion,
      };
    }

    if (
      this.totalCompleted === 10 &&
      !this.unlockedAchievements.has('dreamer_10')
    ) {
      this.unlockedAchievements.add('dreamer_10');
      return {
        id: 'dreamer_10',
        title: '🌙 梦境大师',
        description: '累计完成 10 次梦境整合',
        companion,
      };
    }

    if (
      this.totalCompleted === 25 &&
      !this.unlockedAchievements.has('dreamer_25')
    ) {
      this.unlockedAchievements.add('dreamer_25');
      return {
        id: 'dreamer_25',
        title: '🌙 梦境传说',
        description: '累计完成 25 次梦境整合',
        companion,
      };
    }

    if (
      this.consecutiveDays >= 7 &&
      !this.unlockedAchievements.has('week_dream')
    ) {
      this.unlockedAchievements.add('week_dream');
      return {
        id: 'week_dream',
        title: '📅 一周好梦',
        description: '连续 7 天都有梦境整合',
        companion,
      };
    }

    if (
      this.totalSessions >= 100 &&
      !this.unlockedAchievements.has('sessions_100')
    ) {
      this.unlockedAchievements.add('sessions_100');
      return {
        id: 'sessions_100',
        title: '📚 记忆宝库',
        description: '累计整理了 100+ 条会话记忆',
        companion,
      };
    }

    return null;
  }
}

interface DreamGrowthStats {
  totalCompleted: number;
  totalSessions: number;
  totalInsights: number;
  consecutiveDays: number;
}

interface AchievementMilestone {
  id: string;
  title: string;
  description: string;
  companion: Companion;
}

const growthTracker = new DreamGrowthTracker();

// ==================== 消息生成 ====================

/**
 * 根据梦境成果生成 Buddy 消息文本
 */
export function formatDreamMessage(event: DreamEvent): string {
  switch (event.type) {
    case 'dream:started':
      return `🌙 我开始做梦了……正在整理 ${event.sessionsCount} 条会话记忆，也许会发现一些有趣的东西~`;
    case 'dream:completed':
      if (event.sessionsCount >= 20) {
        return `🌙 我刚刚做了一个很长的梦！整理了 ${event.sessionsCount} 条会话，生成了 ${event.insightsGenerated} 条新洞察……感觉又成长了不少呢！`;
      }
      if (event.sessionsCount >= 5) {
        return `🌙 刚刚做完梦~整理了 ${event.sessionsCount} 条会话记忆，生成了 ${event.insightsGenerated} 条新洞察。`;
      }
      return `🌙 我做了一个小梦，整理了 ${event.sessionsCount} 条会话。${event.summary}`;
    case 'dream:failed':
      return `🌙 我做了个不太好的梦……梦境整合失败了：${event.summary}。下次再试试吧~`;
  }
}

/**
 * 根据梦境规模和累计数据生成伙伴对话文本
 */
export function formatGrowthDialogue(
  event: DreamEvent,
  stats: DreamGrowthStats
): string {
  const parts: string[] = [];

  if (event.insightsGenerated >= 10) {
    parts.push(`这次收获了好多新知识！`);
  }

  if (stats.totalCompleted >= 5) {
    parts.push(`已经做了 ${stats.totalCompleted} 次梦了呢。`);
  }

  if (stats.consecutiveDays >= 3) {
    parts.push(
      `连续 ${stats.consecutiveDays} 天都在做梦，感觉和你越来越有默契了~`
    );
  }

  if (event.sessionsCount >= 20) {
    parts.push(`整理这么多会话让我觉得好充实！`);
  }

  return parts.length > 0 ? parts.join(' ') : '';
}

// ==================== 事件处理 ====================

/**
 * 处理梦境事件的 Buddy 通知反馈
 */
function handleDreamEvent(event: DreamEvent): void {
  addDreamLogEntry(event);
  const baseMessage = formatDreamMessage(event);

  if (event.type === 'dream:completed') {
    growthTracker.recordCompletion(event);
    const stats = growthTracker.getStats();
    const growthMessage = formatGrowthDialogue(event, stats);
    const fullMessage = growthMessage
      ? `${baseMessage}\n\n${growthMessage}`
      : baseMessage;

    ifNotificationsEnabled(() => {
      createInfoNotification('🌙 梦境消息', fullMessage);
    });

    const achievement = growthTracker.checkAchievements();
    if (achievement) {
      ifNotificationsEnabled(() => {
        createAchievementNotification(
          achievement.companion,
          achievement.title,
          achievement.description
        );
        createLevelUpNotification(
          achievement.companion,
          'WISDOM',
          0,
          stats.totalCompleted
        );
      });
    }

    console.log(`[BuddyDream] ${event.type}: ${fullMessage}`);
    if (event.insightsGenerated >= 10) {
      console.log(
        `[BuddyDream] large dream — ${event.insightsGenerated} insights, ${stats.totalCompleted} total dreams`
      );
    }
  } else if (event.type === 'dream:failed') {
    ifNotificationsEnabled(() => {
      createInfoNotification('🌙 梦境消息', baseMessage);
    });
    console.log(`[BuddyDream] ${event.type}: ${baseMessage}`);
  } else {
    console.log(`[BuddyDream] ${event.type}: ${baseMessage}`);
  }
}

// ==================== 集成入口 ====================

/**
 * 初始化 Buddy 梦境集成
 * 将 AutoDream 事件桥接到 EventBus，Buddy 通过 EventBus 接收反馈
 *
 * @param bus 可选的 EventBus 实例，默认使用 globalEventBus
 */
export function initBuddyDreamIntegration(bus?: EventBus): void {
  const eventBus = bus || globalEventBus;

  onDreamEvent((event: DreamEvent) => {
    eventBus.publish(DREAM_EVENT, event);
  });

  eventBus.subscribe(DREAM_EVENT, (event: unknown) => {
    handleDreamEvent(event as DreamEvent);
  });

  console.log('[BuddyDream] integration initialized via EventBus');
}

/**
 * 启动 Buddy 梦境集成（使用全局 EventBus）
 */
export function startDreamIntegration(): void {
  initBuddyDreamIntegration(globalEventBus);
}

/**
 * 停止 Buddy 梦境集成
 */
export function stopDreamIntegration(): void {
  offDreamEvent((event: DreamEvent) => {
    globalEventBus.publish(DREAM_EVENT, event);
  });
}
