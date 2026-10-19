// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 飞书「卡片回传交互」入站载荷解析 + 回执体构造（**纯函数**，无实例状态）
//
// 为什么要单独一个模块（而非塞进 `FeishuChannel`）：飞书同一个回调地址会收到**两种不同体**——
// ① 事件订阅（消息事件，`{type:'event_callback', event:{message:…}}`）；
// ② 卡片回传（**另一种体**，见下）。识别规则是**纯数据判定**，把它抽成纯函数才能单测覆盖
// （守 CS02：不靠正文/字符串匹配，只认平台给出的**结构化字段**）。
//
// 依据（**外部权威，2026-10-17 取数**）：
// - 新版 `card.action.trigger`：https://open.feishu.cn/document/feishu-cards/card-callback-communication
//   体 = `{ schema:'2.0', header:{ event_type:'card.action.trigger', … },
//           event:{ action:{ value,tag }, context:{ open_message_id, open_chat_id } } }`
// - 旧版 `card.action.trigger_v1`：https://open.larkoffice.com/document/deprecated-guide/message-card/configuring-card-callbacks/card-callback-structure
//   体 = **扁平**（**无** `type`/`event` 包裹）：`{ open_id, token, open_message_id, action:{ value,tag } }`
//   ⚠️ 本仓飞书**出站**卡片用的是**旧版结构**（`FeishuChannel.sendInteractiveMessage`：`header/elements/action/actions`）
//   ⇒ 两版回调体**都必须认**，不能只按新版写。
// - 响应体：`{ toast:{ type, content }, card? }`（3 秒内 HTTP 200；**不得**用 3xx）。本模块只构造
//   `toast`（**不带** `card` ⇒ 保持原卡片不变，避免把挂起卡改成未知结构）。
//
// ⚠️ 长连接（2026-10-19 起走官方 SDK `WSClient`）：SDK 会把 v2 体**拍平**（header + event）
//    后交给 handler；handler 的返回值会由 SDK 作为响应体回传。调用方先把扁平体还原成 v2
//    形状再交本模块识别，并把 `buildFeishuCardActionResponse()` 作为 handler 返回值（toast 生效）。
// - `toast.type` 的完整枚举未获权威文档 ⇒ 只用官方示例中出现过的 `info`（不臆造 `success/error`）。

import type { ChannelReliefActionResult } from '../bridge/budgetReliefAction';

/** 新版回调类型标识（webhook 体在 `header.event_type`；长连接帧在 `data.type`） */
const CARD_ACTION_EVENT_TYPE = 'card.action.trigger';

/** 识别出的回调**形态**（留痕用：真机上出事时能一眼看出走的是哪版体） */
export type FeishuCardActionShape = 'v2' | 'v2-ws' | 'v1-flat';

/** 一次卡片回传命中的结果 */
export interface FeishuCardActionHit {
  /** 按钮回传载荷的**字符串**形态（交 `handleBudgetReliefAction`，与 QQ 同一入口） */
  payload: string;
  /** 命中的回调体形态 */
  shape: FeishuCardActionShape;
  /** 卡片所在消息 id（飞书给出时带上，便于排查） */
  openMessageId?: string;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/**
 * 取按钮回传载荷的**字符串**形态。
 *
 * 本仓**出站**把载荷包成 `value: { key:'action', value: <载荷> }`（见 `FeishuChannel`）⇒ 此处按
 * **自家契约**取内层 `value`；平台也允许 `value` 直接是字符串 ⇒ 原样透传。
 * 其余对象（他方卡片）⇒ `JSON.stringify` 交下游 `parseBudgetReliefActionData` 判定，
 * 非本动作的载荷一律被拒（**不猜**、不误放行）。
 */
function normalizeButtonValue(v: unknown): string | null {
  if (typeof v === 'string') return v === '' ? null : v;
  if (isObj(v)) {
    const inner = v['value'];
    if (typeof inner === 'string') return inner === '' ? null : inner;
    return JSON.stringify(v);
  }
  return null;
}

/** 新版体（`header.event_type` = 顶层；长连接帧内 `data.type` = 同值） */
function fromV2(
  node: Record<string, unknown>,
  shape: FeishuCardActionShape
): FeishuCardActionHit | null {
  const header = node['header'];
  const byHeader =
    isObj(header) && header['event_type'] === CARD_ACTION_EVENT_TYPE;
  const byFrameType = node['type'] === CARD_ACTION_EVENT_TYPE;
  if (!byHeader && !byFrameType) return null;

  const event = node['event'];
  if (!isObj(event)) return null;
  const action = event['action'];
  if (!isObj(action)) return null;
  const payload = normalizeButtonValue(action['value']);
  if (payload === null) return null;

  const ctx = event['context'];
  const openMessageId = isObj(ctx)
    ? (ctx['open_message_id'] as string | undefined)
    : undefined;
  return {
    payload,
    shape,
    ...(typeof openMessageId === 'string' ? { openMessageId } : {}),
  };
}

/** 旧版扁平体（**无** `type`/`event` 包裹；以顶层 `open_message_id` 作判别，不与新版/事件体相撞） */
function fromV1Flat(node: Record<string, unknown>): FeishuCardActionHit | null {
  const openMessageId = node['open_message_id'];
  if (typeof openMessageId !== 'string' || openMessageId === '') return null;
  const action = node['action'];
  if (!isObj(action)) return null;
  const payload = normalizeButtonValue(action['value']);
  if (payload === null) return null;
  return { payload, shape: 'v1-flat', openMessageId };
}

/**
 * 从**任意**入站体里识别「卡片回传交互」并按形态取出载荷；不是卡片回传 ⇒ `null`（**不抢**消息路径）。
 *
 * 判定顺序（长连接帧 → 新版体 → 旧版扁平体）**互斥**：帧体形状是 `{type:'event', data:{…}}`，
 * 新版体带 `header.event_type`，旧版体是扁平且带 `open_message_id` ⇒ 三者不会互相误命中。
 */
export function extractFeishuCardAction(
  body: unknown
): FeishuCardActionHit | null {
  if (!isObj(body)) return null;

  // ① 长连接帧（沿用本通道既有帧形：`{ type:'event', data:{…} }`）
  if (body['type'] === 'event' && isObj(body['data'])) {
    const hit = fromV2(body['data'], 'v2-ws');
    if (hit) return hit;
  }
  // ② 新版 webhook 体（schema 2.0）
  const hitV2 = fromV2(body, 'v2');
  if (hitV2) return hitV2;
  // ③ 旧版 webhook 体（扁平；本仓出站卡片即旧版结构 ⇒ 真机更可能落这里）
  return fromV1Flat(body);
}

/**
 * 动作结果 ⇒ 回调响应体（`{toast}`；**不带** `card` ⇒ 保持原卡片）。
 *
 * 结果码语义与 QQ 同源（`0` 成功 / 非零失败），故 toast 文案按**码**取词，不解析 `message` 之外的东西。
 */
export function buildFeishuCardActionResponse(
  result: ChannelReliefActionResult
): {
  toast: { type: string; content: string };
} {
  const content =
    result.code === 0
      ? (result.message ?? '已放行：本会话将从挂起点自动续跑')
      : `未放行：${result.message ?? '操作未生效（按钮可能已失效）'}`;
  // 只用官方示例中的 `info`（枚举未获权威文档 ⇒ 不臆造其它取值）
  return { toast: { type: 'info', content } };
}
