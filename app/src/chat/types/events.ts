/**
 * 事件溯源 — 事件类型定义
 *
 * 设计参考：deepseek-harness packages/core/session/src/types.ts
 * 父方案：dev_docs/20260821/M1-事件溯源迁移-详细技术方案.md §1
 *
 * 核心原则：
 *   1. seq 全局单调递增（会话内）—— 追加时 seq <= tailSeq 直接拒绝
 *   2. type 细粒度 —— thinking 和 text 是不同 type，不可能串话
 *   3. ignorable 安全 —— 未知 type 可跳过，向前兼容
 *   4. sourceEventSeqs 溯源 —— 聚合事件可引用合成它的更早事件
 *
 * 与现有 Message 类型的关系：并行存在，不替换（M1 兼容期双写）。
 * 事件流是真相源，messages.jsonl 仅为兼容期保留。
 *
 * 载荷（LiriEventMap）见 ./eventPayloads.ts —— 拆出仅为巨型文件治理，
 * 三处同步（LiriEventType / LiriEventMap / ALL_SESSION_EVENT_TYPES）语义不变。
 */

import { LIRI_EVENT_NAMES } from '@shared/events/eventNames';
import type { LiriEventMap } from './eventPayloads';

// ─── 事件类型枚举 ─────────────────────────────────────────────────────────────

/**
 * 事件类型（细粒度）
 *
 * **事件名单一事实源**：`shared/events/eventNames.ts`（双端共用，2026-09-30，台账 D-57）。
 * 本联合由其派生；原分组注释与命名约定（`<分类>/<动作>`）已随清单移入该文件。
 *
 * 三处同步不变：① 本联合（派生）；② `LiriEventMap` 载荷（由 `LiriEvent<T>.data` 泛型索引强制）；
 * ③ `ALL_SESSION_EVENT_TYPES` 清单（文件末穷尽断言）。
 */
export type LiriEventType = (typeof LIRI_EVENT_NAMES)[number];

// ─── 事件结构 ───────────────────────────────────────────────────────────────

/**
 * 事件结构
 *
 * @typeParam T - 事件类型，用于推断 data 字段类型
 */
export interface LiriEvent<T extends LiriEventType = LiriEventType> {
  /** 事件类型 */
  type: T;
  /** 事件 schema 版本：无字段 = v0；v1 起消息级事件带 messageId */
  schemaVersion?: 1;
  /** 会话内全局单调递增序号，从 1 开始 */
  seq: number;
  /** epoch ms 时间戳 */
  time: number;
  /** 会话 ID */
  sessionId: string;
  /** 类型安全的载荷 */
  data: LiriEventMap[T];
  /**
   * 溯源引用：本事件由哪些更早事件合成（seq 列表）
   * 例：聚合后的 turn/end 可引用其包含的 user/message + assistant/text 的 seq
   */
  sourceEventSeqs?: number[];
  /** 未知 type 安全跳过标记（向前兼容） */
  ignorable?: true;
}

// ─── 类型守卫 ───────────────────────────────────────────────────────────────

/**
 * 类型守卫：判断未知值是否为 LiriEvent
 *
 * 用于 EventLogStorage.read 的反序列化校验。
 * 注意：只校验结构，不校验 type 是否在枚举中（向前兼容）。
 */
export function isLiriEvent(x: unknown): x is LiriEvent {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return (
    typeof e.type === 'string' &&
    typeof e.seq === 'number' &&
    Number.isFinite(e.seq) &&
    e.seq > 0 &&
    typeof e.time === 'number' &&
    Number.isFinite(e.time) &&
    typeof e.sessionId === 'string' &&
    typeof e.data === 'object' &&
    e.data !== null
  );
}

// ─── 事件分类（用于面板过滤） ──────────────────────────────────────────────

/**
 * 事件分类（用于轨迹面板按分类过滤）
 *
 * 比 LiriEventType 更粗粒度，便于 UI 分组。
 */
export type LiriEventCategory =
  | 'conversation'
  | 'tool'
  | 'context'
  | 'system'
  | 'channel'
  | 'lifecycle';

/**
 * 按事件 type 推断分类
 *
 * 规则：
 *   - user/message → conversation
 *   - assistant/thinking, assistant/text → conversation
 *   - assistant/tool_call, tool/result → tool
 *   - context/* → context
 *   - system/*, metric/* → system
 *   - channel/* → channel
 *   - turn/*, session/* → lifecycle
 */
export function categorizeEvent(type: LiriEventType): LiriEventCategory {
  if (
    type === 'assistant/tool_call' ||
    type === 'tool/result' ||
    type === 'tool/canceled'
  ) {
    return 'tool';
  }
  if (type.startsWith('user/') || type.startsWith('assistant/')) {
    return 'conversation';
  }
  if (type.startsWith('context/')) {
    return 'context';
  }
  if (type.startsWith('system/') || type.startsWith('metric/')) {
    return 'system';
  }
  if (type.startsWith('channel/')) {
    return 'channel';
  }
  return 'lifecycle';
}

// ─── 工具类型 ───────────────────────────────────────────────────────────────

/**
 * 提取特定 type 事件的 data 类型
 *
 * 用法：`type TextData = LiriEventData<'assistant/text'>` → `{ content: string }`
 */
export type LiriEventData<T extends LiriEventType> = LiriEventMap[T];

/**
 * 提取特定 type 事件的完整类型
 *
 * 用法：`type TextEvent = LiriEventOf<'assistant/text'>`
 */
export type LiriEventOf<T extends LiriEventType> = LiriEvent<T>;
