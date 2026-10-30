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
 * G-10（2026-10-19）：主动式智能体 —— **数据契约（P1）**。
 *
 * 设计真源：`dev_docs/20261019/proactive-draft.md` §2/§3。
 * 本文件只定义 DTO 与门禁上下文/决定；**不含**队列、通道投递或任何执行副作用。
 */

/** 主动消息类别（决定默认冷却与优先级） */
export type ProactiveKind =
  | 'task_result'
  | 'risk_alert'
  | 'reminder'
  | 'suggestion';

/** 主动消息优先级（`critical` 是唯一可穿透 DND / 速率限制的级别） */
export type ProactivePriority = 'low' | 'normal' | 'high' | 'critical';

/** 主动消息动作（白名单；禁止携带任意命令字符串） */
export interface ProactiveAction {
  /** 稳定 id（按钮回调幂等键） */
  id: string;
  label: string;
  kind: 'open_session' | 'open_url' | 'dismiss' | 'run_task';
  /**
   * - `open_session`：sessionId
   * - `open_url`：https URL
   * - `run_task`：**已登记任务模板 id**（不得是任意命令）
   * - `dismiss`：无需 target
   */
  target?: string;
}

/** 主动消息投递目标 */
export interface ProactiveTarget {
  mode: 'local' | 'origin' | 'channel';
  channelId?: string;
  conversationId?: string;
  sessionId?: string;
}

/** 主动消息 DTO（设计稿 §2；`id`/`dedupeKey` 为幂等与审计键） */
export interface ProactiveMessagePayload {
  /** 全局唯一（ULID/uuid）；投递幂等键 */
  id: string;
  kind: ProactiveKind;
  priority: ProactivePriority;
  /** 去重键：同 key 在有效期内只投一次（如 `task:<id>:done`） */
  dedupeKey: string;
  title: string;
  /** 纯文本 / Markdown 子集；不得含 HTML/脚本 */
  body: string;
  actions?: ProactiveAction[];
  target?: ProactiveTarget;
  /** 创建时刻（epoch ms） */
  createdAt: number;
  /** 过期后不再投递（epoch ms） */
  expiresAt: number;
  /** 可追溯来源（任务/执行/规则 id；不得放敏感内容） */
  source?: { type: string; ref: string };
}

/** 免打扰窗口（本地时间 `HH:MM`，支持跨午夜；如 22:00–08:00） */
export interface ProactiveDndWindow {
  start: string;
  end: string;
}

/** 用户偏好（来自 config；本层只读） */
export interface ProactiveGatePrefs {
  /** 总开关；false ⇒ 门禁直接 drop */
  enabled: boolean;
  dnd?: ProactiveDndWindow;
  /** 覆盖默认冷却（毫秒）；缺省按 constants 的默认表 */
  cooldownMs?: Partial<Record<ProactiveKind, number>>;
  /** 每小时非 CRITICAL 上限；<=0 / 非法 ⇒ 视为 0（全部排队） */
  maxPerHour: number;
  /**
   * **来源级**每小时上限（键 = `payload.source.type`；覆盖门禁的
   * `DEFAULT_SOURCE_MAX_PER_HOUR`）。用于给"机器高频生产者"兜底，
   * 避免某个来源（如 5 分钟一拍的 AlwaysOn）把收件箱刷满。
   */
  sourceMaxPerHour?: Record<string, number>;
}

/** 门禁输入上下文 */
export interface ProactiveGateContext {
  /** 当前时刻（epoch ms） */
  now: number;
  /** 用户本地时区（IANA，如 `Asia/Shanghai`） */
  timezone: string;
  prefs: ProactiveGatePrefs;
  /**
   * 最近投递记录（**调用方须已按去重 TTL 过滤**：只传仍有效的记录）。
   * `deliveredAt` 为 epoch ms。
   */
  recent: ReadonlyArray<{
    dedupeKey: string;
    kind: ProactiveKind;
    deliveredAt: number;
  }>;
}

/** 门禁决定（`queue` 时给出最早可重试时刻） */
export type ProactiveGateDecision =
  | { action: 'deliver'; reason: 'ok' | 'critical_bypass' }
  | {
      action: 'queue';
      reason: 'dnd' | 'cooldown' | 'rate_limited';
      retryAt: number;
    }
  | {
      action: 'drop';
      reason: 'disabled' | 'expired' | 'duplicate';
    };
