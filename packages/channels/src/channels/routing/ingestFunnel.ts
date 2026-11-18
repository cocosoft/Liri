// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * IngestFunnel（#1，2026-11-18）—— 通道入站噪音漏斗（**S1 影子优先**）。
 *
 * 规则一页纸：`dev_docs/20261118/噪音漏斗-规则一页纸-20261118.md`
 * 位置：`messageRouter.routeChannelMessageInner` 内、**去重与限流之后**、共享会话写入之前。
 *
 * 默认关闭：
 * - `INGEST_FUNNEL_SHADOW=true` ⇒ 只记录"本应被过滤"的候选，**不丢任何消息**；
 * - `INGEST_FUNNEL=true` ⇒ 真正丢弃（S2 灰度，需规则确认后开启）；
 * - 两者都关 ⇒ 不读规则、不产生任何副作用（零行为变更）。
 *
 * 判定只看**结构化字段**（sender / conversation / eventType），不扫正文（CS02）。
 */

import { createHash } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { configManager } from '@openliri/infra/config';
import { resolveDataDir } from '@openliri/infra/environment';
import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';

const logger = getLogger('channels:ingestFunnel');

/** 配置（`channels.funnel`）；全部可选 ⇒ 空规则 = 一律 pass */
export interface IngestFunnelRules {
  /** 直聊/可信发送者白名单（非空 ⇒ 不在名单内的一律过滤） */
  senderAllowlist?: string[];
  /** 发送者黑名单（优先于白名单） */
  senderBlocklist?: string[];
  /** 会话白名单（非空 ⇒ 其他会话过滤；用于只放行指定群/私聊） */
  conversationAllowlist?: string[];
  /** 事件类型白名单（仅在消息带 eventType 时生效） */
  eventTypeAllowlist?: string[];
}

/** 一次判定的输入（全部为结构化字段） */
export interface IngestFunnelInput {
  channelId: string;
  conversationId?: string;
  senderId: string;
  /** 结构化事件类型（如 `bot.message` / `ci.failed`；缺省 ⇒ 不参与判定） */
  eventType?: string;
}

export type IngestFunnelReason =
  | 'sender_blocked'
  | 'sender_not_allowed'
  | 'conversation_not_allowed'
  | 'event_type_not_allowed';

export type IngestFunnelDecision =
  | { action: 'pass' }
  | { action: 'drop'; reason: IngestFunnelReason };

/** 开关：影子（默认关） */
export function isIngestFunnelShadowEnabled(): boolean {
  return (
    configManager.env('INGEST_FUNNEL_SHADOW')?.trim().toLowerCase() === 'true'
  );
}

/** 开关：真实过滤（默认关；S2 才开） */
export function isIngestFunnelEnabled(): boolean {
  return configManager.env('INGEST_FUNNEL')?.trim().toLowerCase() === 'true';
}

/** 判定（**纯函数**；规则为空 ⇒ pass） */
export function evaluateIngestFunnel(
  input: IngestFunnelInput,
  rules: IngestFunnelRules
): IngestFunnelDecision {
  const blocked = rules.senderBlocklist ?? [];
  if (blocked.includes(input.senderId)) {
    return { action: 'drop', reason: 'sender_blocked' };
  }
  const conversations = rules.conversationAllowlist ?? [];
  if (
    conversations.length > 0 &&
    (!input.conversationId || !conversations.includes(input.conversationId))
  ) {
    return { action: 'drop', reason: 'conversation_not_allowed' };
  }
  const senders = rules.senderAllowlist ?? [];
  if (senders.length > 0 && !senders.includes(input.senderId)) {
    return { action: 'drop', reason: 'sender_not_allowed' };
  }
  const eventTypes = rules.eventTypeAllowlist ?? [];
  if (
    eventTypes.length > 0 &&
    input.eventType &&
    !eventTypes.includes(input.eventType)
  ) {
    return { action: 'drop', reason: 'event_type_not_allowed' };
  }
  return { action: 'pass' };
}

/** shadow 台账路径（`<dataDir>/ingest/funnel-shadow.jsonl`） */
export function resolveIngestFunnelShadowPath(): string {
  return join(resolveDataDir(), 'ingest', 'funnel-shadow.jsonl');
}

/** senderId 只落 8 位哈希（不写原值，降低敏感面） */
function hashSender(senderId: string): string {
  return createHash('sha256').update(senderId).digest('hex').slice(0, 8);
}

/** 记录一条 shadow（失败只告警，不影响入站链路） */
export async function recordIngestFunnelShadow(
  input: IngestFunnelInput & { reason: IngestFunnelReason },
  opts: { file?: string; now?: number } = {}
): Promise<void> {
  const file = opts.file ?? resolveIngestFunnelShadowPath();
  const record = {
    at: opts.now ?? Date.now(),
    channelId: input.channelId,
    conversationId: input.conversationId ?? null,
    senderIdHash: hashSender(input.senderId),
    eventType: input.eventType ?? null,
    decision: 'drop' as const,
    reason: input.reason,
  };
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
    logger.info('ingest:funnel_shadow', {
      channelId: input.channelId,
      reason: input.reason,
    });
  } catch (err) {
    await handleError(err, {
      module: 'channels:ingestFunnel',
      action: 'appendShadow',
      context: { channelId: input.channelId },
    });
  }
}

/** 读取配置（`channels.funnel`）；缺失/损坏 ⇒ 空规则（fail-open 到 pass） */
export function readIngestFunnelRules(): IngestFunnelRules {
  try {
    const channels =
      configManager.getConfigValue<Record<string, unknown>>('channels');
    const funnel = channels?.['funnel'];
    if (!funnel || typeof funnel !== 'object') return {};
    const obj = funnel as Record<string, unknown>;
    const arr = (key: string): string[] | undefined => {
      const v = obj[key];
      return Array.isArray(v)
        ? v.filter((x): x is string => typeof x === 'string')
        : undefined;
    };
    return {
      ...(arr('senderAllowlist')
        ? { senderAllowlist: arr('senderAllowlist') }
        : {}),
      ...(arr('senderBlocklist')
        ? { senderBlocklist: arr('senderBlocklist') }
        : {}),
      ...(arr('conversationAllowlist')
        ? { conversationAllowlist: arr('conversationAllowlist') }
        : {}),
      ...(arr('eventTypeAllowlist')
        ? { eventTypeAllowlist: arr('eventTypeAllowlist') }
        : {}),
    };
  } catch (err) {
    // @ignore-catch — 配置读取失败按"空规则"继续（fail-open 到 shadow/pass，不丢消息）
    logger.warning('ingest:funnel_rules_unreadable', {
      error: err instanceof Error ? err.message : String(err),
    });
    return {};
  }
}
