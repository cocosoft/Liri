// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * IngestFunnel shadow 台账**汇总**（#1，2026-11-18）—— 纯函数，供报告脚本 / 设置页共用。
 *
 * 输入：`<dataDir>/ingest/funnel-shadow.jsonl` 的文本（每行一条记录，见
 * `recordIngestFunnelShadow`）。输出：按渠道 / 会话 / 发送者哈希 / 事件类型 / 决定 的频次分组。
 *
 * **用途**：S1 影子期用真实流量反推 R1 名单 —— 高频会话 ⇒ `conversationAllowlist` 候选，
 * 高频事件类型 ⇒ `eventTypeAllowlist` 候选。
 *
 * **限制（如实标注）**：台账里 sender 只存 8 位哈希 ⇒ 可看"某个发送者多吵"，
 * **无法**直接得到可写入 `senderAllowlist` 的原值（需另开显式采样，不在本文件职责内）。
 */

// MS_PER_DAY 走 infra 常量（CS01：不重复定义同值常量）
import { MS_PER_DAY } from '@openliri/infra/constants';

/** 单条 shadow 记录 */
export interface IngestFunnelShadowRecord {
  at: number;
  channelId: string;
  conversationId: string | null;
  senderIdHash: string;
  eventType: string | null;
  decision: 'pass' | 'drop';
  reason: string | null;
}

/** 一个频次分组（`count` 降序；同数按 `lastSeen` 降序） */
export interface IngestFunnelGroupRow {
  key: string;
  count: number;
  lastSeen: number;
}

export interface IngestFunnelShadowReport {
  /** 可解析记录总数 */
  total: number;
  /** 窗口内记录数（未给 `sinceDays` ⇒ 等于 `total`） */
  windowTotal: number;
  /** 丢弃的损坏行数 */
  skipped: number;
  byChannel: IngestFunnelGroupRow[];
  byConversation: IngestFunnelGroupRow[];
  bySenderHash: IngestFunnelGroupRow[];
  byEventType: IngestFunnelGroupRow[];
  byDecision: IngestFunnelGroupRow[];
  /** `drop` 的原因分布（`reason` 为 null 的 `pass` 不计入） */
  dropReasons: IngestFunnelGroupRow[];
}

export interface IngestFunnelSummarizeOptions {
  /** 只看最近 N 天（按记录 `at`） */
  sinceDays?: number;
  /** 每组最多保留多少行（缺省 20） */
  top?: number;
  /** 当前时刻（测试注入） */
  now?: number;
}

function isRecord(value: unknown): value is IngestFunnelShadowRecord {
  if (!value || typeof value !== 'object') return false;
  const rec = value as Record<string, unknown>;
  return (
    typeof rec['at'] === 'number' &&
    typeof rec['channelId'] === 'string' &&
    (rec['decision'] === 'pass' || rec['decision'] === 'drop')
  );
}

/** 按 key 计数 + 记录最近出现时间，并取前 `top` 名 */
function group(
  records: ReadonlyArray<{ key: string | null; at: number }>,
  top: number
): IngestFunnelGroupRow[] {
  const map = new Map<string, { count: number; lastSeen: number }>();
  for (const { key, at } of records) {
    if (!key) continue;
    const item = map.get(key);
    if (item) {
      item.count += 1;
      item.lastSeen = Math.max(item.lastSeen, at);
    } else {
      map.set(key, { count: 1, lastSeen: at });
    }
  }
  return [...map.entries()]
    .map(([key, v]) => ({ key, count: v.count, lastSeen: v.lastSeen }))
    .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen)
    .slice(0, top);
}

/**
 * 汇总台账文本。
 *
 * @param text JSONL 文本（空串 ⇒ 全零报告）
 */
export function summarizeIngestFunnelShadowText(
  text: string,
  opts: IngestFunnelSummarizeOptions = {}
): IngestFunnelShadowReport {
  const top = opts.top && opts.top > 0 ? opts.top : 20;
  const now = opts.now ?? Date.now();
  const sinceMs =
    opts.sinceDays && opts.sinceDays > 0
      ? now - opts.sinceDays * MS_PER_DAY
      : undefined;

  const records: IngestFunnelShadowRecord[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (isRecord(parsed)) records.push(parsed);
      else skipped += 1;
    } catch {
      // @ignore-catch — 损坏行只计数，不影响其余样本（台账为旁路观测）
      skipped += 1;
    }
  }

  const windowed =
    sinceMs === undefined ? records : records.filter((r) => r.at >= sinceMs);

  return {
    total: records.length,
    windowTotal: windowed.length,
    skipped,
    byChannel: group(
      windowed.map((r) => ({ key: r.channelId, at: r.at })),
      top
    ),
    byConversation: group(
      windowed.map((r) => ({ key: r.conversationId, at: r.at })),
      top
    ),
    bySenderHash: group(
      windowed.map((r) => ({ key: r.senderIdHash, at: r.at })),
      top
    ),
    byEventType: group(
      windowed.map((r) => ({ key: r.eventType, at: r.at })),
      top
    ),
    byDecision: group(
      windowed.map((r) => ({ key: r.decision, at: r.at })),
      top
    ),
    dropReasons: group(
      windowed
        .filter((r) => r.decision === 'drop')
        .map((r) => ({ key: r.reason, at: r.at })),
      top
    ),
  };
}
