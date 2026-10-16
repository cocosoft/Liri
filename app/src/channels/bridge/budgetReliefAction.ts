// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 预算挂起「就地放行」的**入站动作**（平台无关）
//
// Spec：`.trae/specs/channel-budget-inline-relief.md` §D3/§D4。
// 平台适配器（QQ 的 `INTERACTION_CREATE` / 未来源码的卡片回调）只需把**按钮原始数据**交进来，
// 由本模块统一：解析（**不猜**）→ 交**注入的动作端口**（组合根注册，内部走 query 层的放行链）
// → 返回平台可用的结果码。
//
// 分层（R01-007）：channels **不得** import `query/**` ⇒ 放行链经**注入**到达（先例：
// `ChatManager` 注入 `coordinator.setResumeHandler` / `ChatBootstrapDeps.installBudgetSuspendResume`）。

import { getLogger } from '@modules/monitoring';
import { handleError } from '@modules/error';

const logger = getLogger('channels:budgetReliefAction');

/** 放行档位（与 `POST /v1/cost/daily-budget/relief` 的 kind 同值域；通道内不做 `waive-once`） */
export type ChannelReliefKind = 'boost' | 'waive-once' | 'unlock-today';

/** 解析后的动作请求 */
export interface ChannelReliefRequest {
  /** 会话 id（**收窄**唤醒到本会话；服务端须复核其确实处于挂起态） */
  sessionId: string;
  kind: ChannelReliefKind;
}

/**
 * 平台可用的结果码（**与 QQ `PUT /interactions/{id}` 的 `code` 同值域**；其它平台可自行映射）。
 * `0` 成功 / `1` 失败 / `2` 操作频繁 / `3` 重复操作 / `4` 无权限 / `5` 仅管理员
 */
export type ChannelReliefCode = 0 | 1 | 2 | 3 | 4 | 5;

export interface ChannelReliefActionResult {
  code: ChannelReliefCode;
  /** 面向用户的短回执（平台可弹 toast；可缺省） */
  message?: string;
}

/**
 * 动作端口：由**组合根**注册（内部读协调器复核 + 调放行链）。
 *
 * 未注册 ⇒ 记 warn 并回 `{code:1}`（**不静默**，守 CS03）。
 */
export type BudgetReliefActionHandler = (
  req: ChannelReliefRequest
) => Promise<ChannelReliefActionResult>;

let handler: BudgetReliefActionHandler | null = null;

/** 注册动作端口（传 `null` 解绑；仅供组合根与测试使用） */
export function setBudgetReliefActionHandler(
  h: BudgetReliefActionHandler | null
): void {
  handler = h;
}

/** 仅供测试：读取当前是否已注册 */
export function hasBudgetReliefActionHandler(): boolean {
  return handler !== null;
}

/**
 * 解析按钮原始数据（**纯函数**）：必须是本动作的自描述载荷，字段齐全且值域合法 ⇒ 否则 `null`。
 *
 * 守 CS01（单一真源：写出与读入共用 `a==='budget-relief'` 约定）与 CS02（**不做**任何文案匹配）。
 */
export function parseBudgetReliefActionData(
  raw: unknown
): ChannelReliefRequest | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const o = parsed as Record<string, unknown>;
  if (o['a'] !== 'budget-relief') return null;
  const kind = o['k'];
  const sessionId = o['s'];
  if (kind !== 'boost' && kind !== 'waive-once' && kind !== 'unlock-today') {
    return null;
  }
  if (typeof sessionId !== 'string' || sessionId.trim() === '') return null;
  return { sessionId, kind };
}

/**
 * 处理一次按钮动作（平台适配器调用）。
 *
 * **永不抛错**（平台调用方必须能拿到回应码）；解析失败 / 端口缺失 / 端口抛错都**如实**映射为
 * 非零码并留痕（守 CS03：不静默、不假装成功）。
 */
export async function handleBudgetReliefAction(
  raw: unknown
): Promise<ChannelReliefActionResult> {
  const req = parseBudgetReliefActionData(raw);
  if (!req) {
    logger.warn('handleBudgetReliefAction: 按钮数据无法识别，已忽略', {
      rawType: typeof raw,
    });
    return { code: 1, message: '无法识别的按钮数据' };
  }
  if (!handler) {
    logger.warn(
      'handleBudgetReliefAction: 动作端口未注册，无法放行（组合根未接线）',
      { sessionId: req.sessionId, kind: req.kind }
    );
    return { code: 1, message: '放行入口未就绪' };
  }
  try {
    const result = await handler(req);
    logger.info('handleBudgetReliefAction: 放行已处理', {
      sessionId: req.sessionId,
      kind: req.kind,
      code: result.code,
    });
    return result;
  } catch (err) {
    await handleError(err, {
      module: 'channels:budgetReliefAction',
      action: 'handleBudgetReliefAction:动作端口抛错',
      context: { sessionId: req.sessionId, kind: req.kind },
    });
    return { code: 1, message: '放行失败' };
  }
}
