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

import type { LiriEventMap } from './eventPayloads';

// ─── 事件类型枚举 ─────────────────────────────────────────────────────────────

/**
 * 事件类型（细粒度）
 *
 * 命名约定：`<分类>/<动作>`
 *   - conversation 分类：user/message, assistant/*
 *   - tool 分类：assistant/tool_call, tool/result
 *   - context 分类：context/*
 *   - system 分类：system/*, metric/*
 *   - channel 分类：channel/*
 *   - lifecycle 分类：turn/*, session/*
 */
export type LiriEventType =
  // ─── 对话核心 ───
  | 'turn/start'
  | 'turn/end'
  | 'user/message'
  | 'assistant/thinking'
  | 'assistant/text'
  // F-2（2026-09-02）：text 流式 chunk 聚合批事件（服务端 64KB/2s 合并落盘）
  | 'assistant/text-batch'
  | 'assistant/tool_call'
  | 'tool/result'
  | 'tool/canceled'
  // ─── 富块（M4-1-a 扩展，覆盖 question/todo/progress/doc_workflow/status） ───
  | 'assistant/status'
  | 'assistant/progress'
  | 'assistant/question'
  | 'assistant/todo'
  | 'assistant/doc_workflow'
  // P2-A（2026-09-17）：PDCA 自动启动快照富块（聊天正文内嵌卡片）
  | 'assistant/pdca_workflow'
  | 'assistant/truncation'
  // ─── 交付物/diff（E-1，2026-08-23：deliverable/diff 事件化，T-H.2） ───
  | 'assistant/deliverable'
  | 'assistant/diff'
  // ─── 上下文管理 ───
  | 'context/compaction'
  | 'context/summary'
  // TR-12-B（2026-09-22）：模型输入快照（工具清单 + 系统提示词分段，引用式去重）
  | 'context/model-input'
  // D-1（2026-09-02）：会话远期摘要事件化落盘（摘要也是轨迹，见 §8 设计）
  | 'session/summary'
  // ─── 系统与日志 ───
  | 'system/error'
  | 'system/warning'
  | 'system/info'
  | 'metric/timing'
  // ─── 通道 ───
  | 'channel/connect'
  | 'channel/disconnect'
  | 'channel/message'
  // P2-2（2026-09-23）：请求边界事件 —— turn × request 双边界
  // （见 `.trae/specs/request-boundary-events.md` v0.2；requestId = 本事件的 seq）
  | 'request/start'
  // B2-2（2026-09-23）：目标（Goal）生命周期事件族 —— 见 `.trae/specs/goal-entity.md` §4.1。
  // `goal/injected` 是 §1.6「模型可见 ⇔ 已落盘」红线（缺口 X2）的正面修复：
  // 目标指令（预算收尾 / 停滞停止 / idle 续接）进了模型输入，就必须有事件可重建。
  | 'goal/created'
  | 'goal/updated'
  | 'goal/status_changed'
  | 'goal/injected'
  // B4-1（2026-09-23）：子代理恢复通路审计事件（认领 / 恢复 / 放弃各一条）——
  // log-only（不入消息 surface，与 `session/title` 同口径）：它描述的是**恢复通路**，
  // 不是模型看到的内容。修复前这三个可判定节点**只有 logger 文本**，
  // 崩溃后"这次恢复到底发生了什么"无法从持久层按序重建。
  | 'agent/recovery'
  // ─── 生命周期 ───
  | 'session/start'
  | 'session/end'
  // ─── 标题（D5，2026-08-24：标题事件化，log-only 不入消息 surface） ───
  | 'session/title'
  // ─── Code Mode（CM-5，2026-08-25：code_run 执行事件） ───
  | 'assistant/code_run';

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
