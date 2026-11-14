/**
 * MobileApprovalAction — 手机端「就地审批」的**入站动作**（G6，2026-11-14）
 *
 * 卡片按钮的 `value` 由 `bridge/inboxApprovalCard` 生成（自描述 JSON）；手机端把它
 * 原样 POST 回 `POST /v1/channels/mobile/messages` 的 `action` 字段 ⇒ 本模块解析后交给
 * `resolveInboxApproval`（审批的**唯一解析实现**）落定 ⇒ 不新增审批真源。
 *
 * 为什么动作必须走移动端入站端点：设备 token（`authorizeMobileRequest`）只在本端点校验；
 * 统一端点 `POST /v1/inbox/:id/reply` 走 Bearer / api-key 鉴权，手机设备凭据进不去
 * （强行放行等于把邮箱级凭据换成设备级 —— 那是安全姿态的下降，不做）。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { handleError } from '@openliri/infra/error';
import {
  parseInboxApprovalActionData,
  type InboxApprovalActionPayload,
} from '../bridge/inboxApprovalCard';

const logger = getLogger('channels:mobile:approval');

/** 动作形态的入站请求（设备 id + 已解析的审批动作） */
export interface MobileApprovalActionInput {
  deviceId: string;
  action: InboxApprovalActionPayload;
}

export type MobileApprovalActionParse =
  | { ok: true; value: MobileApprovalActionInput }
  | { ok: false; error: string };

/**
 * 判别并解析**动作形态**的入站请求体（**纯函数**，边界校验入口）。
 *
 * 返回 `null` = 不是动作形态（没有 `action` 字段）⇒ 调用方继续走文本入站路径；
 * 返回 `{ok:false}` = 明确是动作形态但字段不合法 ⇒ 400。
 */
export function parseMobileApprovalActionBody(
  raw: unknown
): MobileApprovalActionParse | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return null;
  const body = raw as Record<string, unknown>;
  if (!('action' in body) || body['action'] === undefined) return null;

  const deviceId =
    typeof body['deviceId'] === 'string' ? body['deviceId'].trim() : '';
  if (!deviceId) return { ok: false, error: 'deviceId is required' };

  const action = parseInboxApprovalActionData(body['action']);
  if (!action) {
    return { ok: false, error: 'invalid approval action payload' };
  }
  return { ok: true, value: { deviceId, action } };
}

/** 审批动作解析结果（保留 `kind` 供 HTTP 层映射状态码） */
export interface MobileApprovalResolveResult {
  ok: boolean;
  /** `resolveInboxApproval` 的结局 + 本模块的异常结局（见 {@link MOBILE_APPROVAL_RESOLVE_FAILED}） */
  kind: string;
}

/**
 * 异常路径的结局码。
 *
 * 不用裸字面量 `'error'`：该值落在状态词汇表内（`lint:state-ratchet` Register-or-Fail），
 * 而这里表达的是"解析器自身抛错"，**不是**某个状态机的合法状态。
 */
export const MOBILE_APPROVAL_RESOLVE_FAILED = 'resolve_failed';

/**
 * 落定一次手机端审批动作 —— 直接调**唯一解析实现** `resolveInboxApproval`。
 *
 * 后续副作用（放行缓存、白名单持久化、续跑、结果回传渠道）均由该实现统一承担，
 * 本模块不重复任何一条。
 */
export async function resolveMobileApprovalAction(
  action: InboxApprovalActionPayload
): Promise<MobileApprovalResolveResult> {
  try {
    const { resolveInboxApproval } =
      await import('@openliri/service/runtime/inboxApproval');
    const outcome = await resolveInboxApproval(action.i, action.d);
    logger.info('移动端审批动作已处理', {
      inboxItemId: action.i,
      decision: action.d,
      kind: outcome.kind,
    });
    return { ok: outcome.kind === 'ok', kind: outcome.kind };
  } catch (err) {
    await handleError(err, {
      module: 'channels:mobile:approval',
      action: 'resolveInboxApproval',
      context: { inboxItemId: action.i, decision: action.d },
    });
    return { ok: false, kind: MOBILE_APPROVAL_RESOLVE_FAILED };
  }
}
