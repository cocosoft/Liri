// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * Proactive Shadow（2026-11-18，#2）—— **只记录不投递**的灰度模式。
 *
 * 目的（`dev_docs/20261115/google建议.md:38`）：在真正放开主动推送前，先观察
 * "如果现在投递，会发什么、发到哪、引用什么证据"，避免上线即扰民。
 *
 * 口径（用户 2026-11-18 裁定）：
 * - 开关 `PROACTIVE_SHADOW=true`（只认显式 true，**默认关** ⇒ 行为与改造前逐字一致）；
 * - 开启时：队列照常消费（`scanOnce` 仍把条目置为 delivered，避免重试风暴），但
 *   **不调用任何投递适配器**，只把候选写入 `<dataDir>/proactive/shadow.jsonl`；
 * - 本模式是**观察模式**：条目不会在关闭后补发（与"关闭 shadow 再发"不是同一批）。
 *
 * 为什么不用会话事件：shadow 记录**不是模型可见输入**（`project_rules §1.6` 只管
 * 模型可见 ⇔ 已落盘），且这里需要按运行周期批量观察 ⇒ 用独立 JSONL 台账，避免
 * 为观测新增事件类型（R02：不新建事件类型/存储）。
 */

import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { configManager } from '@openliri/infra/config';
import { resolveDataDir } from '@openliri/infra/environment';
import { handleError } from '@openliri/infra/error';
import { getLogger } from '@openliri/infra/monitoring';

import type { ProactiveMessagePayload } from './types';

const logger = getLogger('proactive:shadow');

/** 开关（默认关）：只认显式 `true` */
export function isProactiveShadowEnabled(): boolean {
  return configManager.env('PROACTIVE_SHADOW')?.trim().toLowerCase() === 'true';
}

/** 台账默认路径（`<dataDir>/proactive/shadow.jsonl`） */
export function resolveProactiveShadowPath(): string {
  return join(resolveDataDir(), 'proactive', 'shadow.jsonl');
}

/** 一条 shadow 记录（字段刻意扁平、无敏感内容） */
export interface ProactiveShadowRecord {
  at: number;
  kind: ProactiveMessagePayload['kind'];
  priority: ProactiveMessagePayload['priority'];
  dedupeKey: string;
  source?: { type: string; ref: string };
  ticketId?: string;
  targetMode?: string;
  title: string;
  /** 正文预览（≤500 字符；不落完整正文） */
  bodyPreview: string;
}

/** 由载荷构造记录（**纯函数**，便于单测） */
export function toProactiveShadowRecord(
  payload: ProactiveMessagePayload,
  now: number = Date.now()
): ProactiveShadowRecord {
  return {
    at: now,
    kind: payload.kind,
    priority: payload.priority,
    dedupeKey: payload.dedupeKey,
    ...(payload.source ? { source: payload.source } : {}),
    ...(payload.ticketId ? { ticketId: payload.ticketId } : {}),
    ...(payload.target?.mode ? { targetMode: payload.target.mode } : {}),
    title: payload.title.slice(0, 200),
    bodyPreview: payload.body.slice(0, 500),
  };
}

/**
 * 追加一条 shadow 记录（默认路径可由 `opts.file` 注入，供测试）。
 *
 * 失败只告警、不抛出：shadow 是观察面，写盘失败不应让扫描器整轮失败
 * （对应调用仍在 shadow 模式下不投递，语义不变）。
 */
export async function recordProactiveShadow(
  payload: ProactiveMessagePayload,
  opts: { file?: string; now?: number } = {}
): Promise<void> {
  const file = opts.file ?? resolveProactiveShadowPath();
  const record = toProactiveShadowRecord(payload, opts.now ?? Date.now());
  try {
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(record)}\n`, 'utf8');
    logger.info('proactive:shadow_recorded', {
      kind: record.kind,
      priority: record.priority,
      targetMode: record.targetMode,
    });
  } catch (err) {
    await handleError(err, {
      module: 'proactive:shadow',
      action: 'append',
      context: { dedupeKey: record.dedupeKey },
    });
  }
}
