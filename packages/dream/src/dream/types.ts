// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
/**
 * 梦境引擎类型定义
 */

/** 梦境阶段 */
export type DreamPhase = 'light' | 'deep' | 'rem';

/** 梦境触发源 */
export type DreamTriggerSource = 'idle' | 'cron' | 'manual';

/** 梦境调度器配置 */
export interface DreamSchedulerConfig {
  /** 空闲检测阈值（毫秒），连续无用户交互后触发 */
  idleThresholdMs: number;
  /** 最短梦境间隔（毫秒） */
  minIntervalMs: number;
  /** 定时触发 cron 表达式（可选） */
  cronTrigger: string;
  /** 空闲检测轮询间隔（毫秒） */
  idleCheckIntervalMs: number;
  /** D1-Step1：每日最多运行次数（对齐 PilotDeck dailyBudget，0 = 不限制） */
  maxDailyRuns?: number;
  /** D1-Step1：忙碌检测回调（agent 正在执行时跳过触发，对齐 PilotDeck agent_busy 门禁） */
  busyCheck?: () => boolean;
}

/** 梦境持久化记录 */
export interface DreamRecord {
  id: string;
  startedAt: number;
  completedAt: number;
  triggerSource: DreamTriggerSource;
  phase: DreamPhase;
  sessionsCount: number;
  insightsGenerated: number;
  success: boolean;
  error?: string;
}

/** 默认调度器配置 */
export const DEFAULT_DREAM_SCHEDULER_CONFIG: DreamSchedulerConfig = {
  idleThresholdMs: 5 * 60 * 1000, // 5 分钟（原 15 分钟，放宽松以更快触发）
  minIntervalMs: 1 * 60 * 60 * 1000, // 1 小时（原 6 小时）
  cronTrigger: '0 2 * * *',
  idleCheckIntervalMs: 60_000, // 每分钟检查一次
  maxDailyRuns: 8, // D1-Step1：每日最多 8 次（对齐 PilotDeck dailyBudget=4 的宽松版）
};

/** 梦境周期状态 */
export type DreamCycleStatus = 'completed' | 'partial' | 'failed';

/** 会话摘要（用于 Gather 阶段筛选高价值会话） */
export interface SessionDigest {
  sessionId: string;
  title: string;
  messageCount: number;
  firstMessageAt: number;
  lastMessageAt: number;
  /** 是否包含工具调用（高价值信号） */
  hasToolCalls: boolean;
  /** 是否包含代码块（高价值信号） */
  hasCodeBlocks: boolean;
}

/** 梦境周期完整记录 */
export interface DreamCycleRecord {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  triggerSource: DreamTriggerSource;
  status: DreamCycleStatus;
  /** 快照时间锚点（Gather 阶段设置），后续阶段只处理此时间点之前的数据 */
  snapshotTime: number;

  // 处理统计
  sessionsScanned: number;
  sessionsProcessed: number;
  knowledgeFilesProcessed: number;
  memoriesCreated: number;
  memoriesRefined: number;
  knowledgeFilesUpdated: number;
  soulUpdated: boolean;
  userProfileUpdated: boolean;

  // 来源追踪
  processedSessionIds: string[];
  processedKnowledgeFiles: string[];
  memoryCount: number;

  // LLM 分析摘要
  insights: string[];
  errors: string[];

  // SOUL/USER 纠偏结果
  soulConflicts?: number;
  userConflicts?: number;
}

/** 梦境周期摘要（列表接口使用，不含完整 detail） */
export interface DreamCycleSummary {
  cycleId: string;
  startedAt: number;
  completedAt: number;
  triggerSource: string;
  status: string;
  sessionsScanned: number;
  sessionsProcessed: number;
  memoriesCreated: number;
  memoriesRefined: number;
  knowledgeFilesUpdated: number;
  soulUpdated: boolean;
  userProfileUpdated: boolean;
  insights: string[];
  errors: string[];
  /** 已处理的会话 ID 列表（前端用于判断"已凝练"状态） */
  processedSessionIds: string[];
}

/** 来源索引条目 */
export interface SourceIndexEntry {
  sourceType: string;
  sourceIds: string[];
  dreamCycleId: string;
}

/** 知识文件变更增量 */
export interface KnowledgeDelta {
  fileName: string;
  /** sha256 of previous version */
  baseSnapshot: string;
  /** 新增的行 */
  additions: string[];
  /** 删除的行 */
  removals: string[];
  /** 上次内容行（用于行级 diff；旧格式文件缺失时重建基线） */
  oldLines?: string[];
  lastCheckedAt: number;
}
