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

import type { DreamEvent } from '@modules/chronos';
import { offDreamEvent } from '@modules/chronos';
import type { EventBus } from '@modules/core';
import { globalEventBus, SystemEvents } from '@modules/core';
import {
  createInfoNotification,
  createAchievementNotification,
  createLevelUpNotification,
} from './notifications';
import { getLogger } from '@modules/monitoring';
import {
  type GrowthState,
  loadGrowthState,
  saveGrowthState,
} from './growthPersistence';

const logger = getLogger('BuddyDream');
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
 * 状态持久化到 ~/.pyapp/data/buddy-growth.json（重启不丢失）
 */
export class DreamGrowthTracker {
  private totalCompleted = 0;
  private totalSessions = 0;
  private totalInsights = 0;
  private lastCompletedDate = '';
  private consecutiveDays = 0;
  private unlockedAchievements = new Set<string>();
  /** 用户对话轮数（每轮用户对话递增，与 totalSessions 梦境整理会话数双计数并存） */
  private userSessions = 0;

  /** 任务完成次数计数器 */
  private taskCompletionCount = 0;
  /** 任务累计经验值 */
  private totalTaskExp = 0;

  private initialized = false;

  /** 从持久层加载状态（幂等，启动时调用一次） */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    const state = await loadGrowthState();
    this.totalCompleted = state.totalCompleted;
    this.totalSessions = state.totalSessions;
    this.totalInsights = state.totalInsights;
    this.lastCompletedDate = state.lastCompletedDate;
    this.consecutiveDays = state.consecutiveDays;
    this.unlockedAchievements = new Set(state.unlockedAchievements);
    this.taskCompletionCount = state.taskCompletionCount;
    this.totalTaskExp = state.totalTaskExp;
    this.userSessions = state.userSessions;
    logger.info('成长状态已加载', {
      totalCompleted: this.totalCompleted,
      totalSessions: this.totalSessions,
      userSessions: this.userSessions,
      totalTaskExp: this.totalTaskExp,
      achievements: this.unlockedAchievements.size,
    });
  }

  /** 将当前状态落盘（fire-and-forget，失败仅记录） */
  private async persist(): Promise<void> {
    const state: GrowthState = {
      totalCompleted: this.totalCompleted,
      totalSessions: this.totalSessions,
      totalInsights: this.totalInsights,
      lastCompletedDate: this.lastCompletedDate,
      consecutiveDays: this.consecutiveDays,
      unlockedAchievements: [...this.unlockedAchievements],
      taskCompletionCount: this.taskCompletionCount,
      totalTaskExp: this.totalTaskExp,
      userSessions: this.userSessions,
    };
    await saveGrowthState(state);
  }

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
    void this.persist();
  }

  /**
   * 记录一轮用户对话（Buddy 成长"对话轮数"计数，双计数并存）
   * 与 totalSessions（梦境整理会话数）相互独立；sessions_100 里程碑基于此值
   */
  recordUserSession(): void {
    this.userSessions++;
    void this.persist();
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
      userSessions: this.userSessions,
    };
  }

  /**
   * 记录一次任务完成（非梦境），累计经验值
   *
   * @param source 任务来源模块（cron / daemon / local_bash 等）
   * @param exp    本次任务获得的经验值
   */
  recordTaskCompletion(source: string, exp: number): void {
    this.taskCompletionCount++;
    this.totalTaskExp += exp;
    void this.persist();
  }

  /**
   * 获取任务完成统计
   */
  getTaskStats(): { taskCompletionCount: number; totalTaskExp: number } {
    return {
      taskCompletionCount: this.taskCompletionCount,
      totalTaskExp: this.totalTaskExp,
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
      this.userSessions >= 100 &&
      !this.unlockedAchievements.has('sessions_100')
    ) {
      this.unlockedAchievements.add('sessions_100');
      return {
        id: 'sessions_100',
        title: '📚 记忆宝库',
        description: '累计完成了 100 轮对话',
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
  userSessions: number;
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

    logger.info('梦境事件', { type: event.type, message: fullMessage });
    if (event.insightsGenerated >= 10) {
      logger.info('大型梦境', {
        insights: event.insightsGenerated,
        totalDreams: stats.totalCompleted,
      });
    }
  } else if (event.type === 'dream:failed') {
    ifNotificationsEnabled(() => {
      createInfoNotification('🌙 梦境消息', baseMessage);
    });
    logger.info('梦境事件', { type: event.type, message: baseMessage });
  } else {
    logger.info('梦境事件', { type: event.type, message: baseMessage });
  }
}

// ==================== 集成入口 ====================

/**
 * 初始化 Buddy 梦境集成
 * 通过标准 EventBus 事件接收 AutoDream 的生命周期通知，
 * 同时保留对旧 DREAM_EVENT 通道的向后兼容。
 *
 * @param bus 可选的 EventBus 实例，默认使用 globalEventBus
 */
export function initBuddyDreamIntegration(bus?: EventBus): void {
  const eventBus = bus || globalEventBus;
  void growthTracker.init();

  /** 已处理的事件 ID 集合（用于新旧通道去重） */
  const recentDreamIds = new Set<string>();

  function markProcessed(taskId: string): void {
    recentDreamIds.add(taskId);
    setTimeout(() => recentDreamIds.delete(taskId), 3000);
  }

  function isAlreadyProcessed(taskId: string): boolean {
    return recentDreamIds.has(taskId);
  }

  // 主路径：订阅标准 EventBus 事件
  eventBus.subscribe(SystemEvents.DREAM_STARTED, (event: unknown) => {
    const de = event as DreamEvent;
    markProcessed(de.taskId);
    handleDreamEvent(de);
  });
  eventBus.subscribe(SystemEvents.DREAM_COMPLETED, (event: unknown) => {
    const de = event as DreamEvent;
    markProcessed(de.taskId);
    handleDreamEvent(de);
  });
  eventBus.subscribe(SystemEvents.DREAM_FAILED, (event: unknown) => {
    const de = event as DreamEvent;
    markProcessed(de.taskId);
    handleDreamEvent(de);
  });

  // 兼容路径：旧 DREAM_EVENT 通道（用于尚未迁移的发布者）
  eventBus.subscribe(DREAM_EVENT, (event: unknown) => {
    const de = event as DreamEvent;
    if (isAlreadyProcessed(de.taskId)) return;
    markProcessed(de.taskId);
    handleDreamEvent(de);
  });

  logger.info('梦境集成已初始化');
}

/**
 * 初始化 Buddy 与 Tasks 的成长联动
 * 订阅 task:completed 事件，根据任务完成情况驱动伙伴成长统计。
 * 梦境任务已在 dreamIntegration 中处理，此处跳过避免重复。
 */
export function initBuddyTaskGrowthIntegration(): void {
  globalEventBus.subscribe(SystemEvents.TASK_COMPLETED, (event: unknown) => {
    const payload = event as Record<string, unknown>;
    if (payload.type === 'dream') {
      return;
    }

    const expMap: Record<string, number> = {
      cron: 5,
      daemon: 10,
      local_bash: 15,
      local_agent: 25,
    };
    const source = String(payload.type || 'unknown');
    const exp = expMap[source] || 10;

    growthTracker.recordTaskCompletion(source, exp);

    logger.info('任务完成', { taskId: payload.taskId, exp, source });
  });

  logger.info('成长联动已初始化');
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

/**
 * 记录一轮用户对话（Buddy 成长"对话轮数"，供 ChatManager 用户消息入口埋点调用）
 * 双计数并存：不修改梦境整理会话数 totalSessions
 */
export function recordUserSession(): void {
  growthTracker.recordUserSession();
}

/**
 * 初始化 Buddy 对 Cron 定时任务的反馈
 * 订阅 BUDDY_GROWTH 事件，将 Cron 任务执行结果转化为 Buddy 通知。
 */
export function initBuddyCronFeedbackIntegration(): void {
  globalEventBus.subscribe(SystemEvents.BUDDY_GROWTH, (event: unknown) => {
    const payload = event as Record<string, unknown>;
    if (payload.source !== 'cron') return;

    const taskId = String(payload.taskId || '');
    const prompt = String(payload.prompt || '');
    const success = payload.success === true;

    let message: string;
    if (success) {
      message = prompt
        ? `⏰ 定时任务「${prompt.slice(0, 60)}」已完成`
        : `⏰ 定时任务 ${taskId} 已完成`;
    } else {
      message = prompt
        ? `⏰ 定时任务「${prompt.slice(0, 60)}」执行失败`
        : `⏰ 定时任务 ${taskId} 执行失败`;
    }

    ifNotificationsEnabled(() => {
      createInfoNotification('⏰ 定时任务', message);
    });

    logger.info('定时任务反馈', { message });
  });

  logger.info('定时任务反馈集成已初始化');
}
