/**
 * Mandate 重校验（P33，2026-11-02）
 *
 * 方案：`dev_docs/20261102/Liri常驻自主执行升级方案-20261102.md` §5 **P33-a** /
 * 参考实现 `docs/002:131-141`：
 * - 工作项已结束、被**人的消息**唤醒前，按当前 Policy 重校验 Mandate；
 * - 失败 ⇒ 工作项**保持 ended**（消息不被它接收，回落到普通会话）；
 * - **不撤销 Mandate、不取消在途工作**（`diffPolicyEffects` 只产效果）。
 *
 * 接入点：宿主在注入 `setSessionOwnerLoader` 时包一层 —— 仅当会话**当前无人持有**
 * （`kind==='none'`）且策略启用时执行；策略默认 `enabled=false` ⇒ 零行为变更。
 *
 * 本文件只读"已结束 + 带 mandate"的工作项；失败时在行上写 `mandateRevoked*` 标记，
 * 供后续唤醒/面板使用（不新增状态位）。
 */
import {
  revalidateMandate,
  resolveAdmission,
  type Mandate,
  type RevalidationFailure,
  type RevalidationFacts,
} from '@openliri/infra/permission';
import { getLogger } from '@openliri/infra/monitoring';

import {
  listPdcaWorkItemsBySession,
  PDCA_TERMINAL_STATUSES,
  writePdcaWorkItem,
} from '../PdcaWorkItemBridge';
import { loadAutonomyPolicy, type LoadedAutonomyPolicy } from './policyConfig';

const logger = getLogger('tasks:autonomy-revalidate');

export interface MandateRevalidationResult {
  ticketId: string;
  ok: boolean;
  reason?: RevalidationFailure;
  policyId: string;
}

export interface RevalidateOptions {
  /** 读取会话所属工作项（缺省走 `workitems`，按 `session_id` 索引） */
  listWorkItems?: (
    sessionId: string
  ) => Promise<ReadonlyArray<Record<string, unknown>>>;
  writeWorkItem?: (record: Record<string, unknown>) => Promise<void>;
  loadPolicy?: () => LoadedAutonomyPolicy;
  now?: () => number;
  /** 该状态是否"已结束"（缺省复用 `PDCA_TERMINAL_STATUSES`） */
  isEnded?: (status: string) => boolean;
}

/** 解析 `workitems.mandate`（不合法 ⇒ `undefined`，不猜） */
function parseMandate(raw: unknown): Mandate | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;

  const strength = record.strength;
  if (strength !== 'explicit' && strength !== 'inferred') return undefined;

  const basisRaw = record.basis;
  if (typeof basisRaw !== 'object' || basisRaw === null) return undefined;
  const basis = basisRaw as Record<string, unknown>;
  const via = basis.via;
  if (
    via !== 'addressed' &&
    via !== 'followup' &&
    via !== 'admission' &&
    via !== 'bot'
  ) {
    return undefined;
  }
  if (typeof basis.policyVersion !== 'string') return undefined;

  const scopeRaw = record.scope;
  if (typeof scopeRaw !== 'object' || scopeRaw === null) return undefined;
  const scope = scopeRaw as Record<string, unknown>;
  if (typeof scope.source !== 'string' || typeof scope.thread !== 'string') {
    return undefined;
  }

  const cell = basis.cell;
  const validCell =
    cell === 'listedUnaddressed' ||
    cell === 'unlistedAddressed' ||
    cell === 'unlistedUnaddressed'
      ? cell
      : undefined;
  const rules = Array.isArray(basis.rules)
    ? basis.rules.filter((r): r is string => typeof r === 'string')
    : undefined;

  return {
    strength,
    basis: {
      via,
      ...(validCell ? { cell: validCell } : {}),
      ...(typeof basis.sender === 'string' ? { sender: basis.sender } : {}),
      ...(rules ? { rules } : {}),
      policyVersion: basis.policyVersion,
    },
    scope: {
      source: scope.source,
      thread: scope.thread,
      ...(typeof scope.workspace === 'string'
        ? { workspace: scope.workspace }
        : {}),
    },
  };
}

/** 把当前 Policy 解析成重校验事实（内部来源按来源开关作为 sender/bot 白名单） */
function factsFromPolicy(
  config: LoadedAutonomyPolicy['config'],
  mandate: Mandate
): RevalidationFacts {
  const source = mandate.scope.source;
  const sourceEnabled = config.sources[source] === true;
  const senders = config.allowlist?.senders ?? [];
  const senderStillAllowed = mandate.basis.sender
    ? senders.includes(mandate.basis.sender)
    : sourceEnabled;

  const admissionStrengthNow =
    mandate.basis.via === 'admission' && mandate.basis.cell
      ? resolveAdmission(config.admission, source, mandate.basis.cell)
      : undefined;

  return {
    sourceStillListens: sourceEnabled,
    mode: config.acceptMode,
    enabledRuleIds: new Set(
      config.rules.filter((rule) => rule.enabled).map((rule) => rule.id)
    ),
    senderStillAllowed,
    botStillListed: sourceEnabled,
    ...(admissionStrengthNow ? { admissionStrengthNow } : {}),
  };
}

/**
 * 对某会话下**已结束且带 Mandate** 的工作项做重校验。
 *
 * - 策略未启用 ⇒ 直接返回（不读库、不写、不记日志）；
 * - 失败 ⇒ 行上写 `mandateRevoked: true + reason + at`（仅在状态变化时写）；
 * - 成功且此前被标记撤销 ⇒ 清除标记；
 * - 任何读/写失败只告警，不阻断消息处理。
 */
export async function revalidateEndedTicketsForSession(
  sessionId: string,
  options: RevalidateOptions = {}
): Promise<MandateRevalidationResult[]> {
  if (!sessionId) return [];

  const loaded = (options.loadPolicy ?? loadAutonomyPolicy)();
  if (!loaded.config.enabled) return [];

  const list = options.listWorkItems ?? listPdcaWorkItemsBySession;
  const write = options.writeWorkItem ?? writePdcaWorkItem;
  const isEnded =
    options.isEnded ?? ((status: string) => PDCA_TERMINAL_STATUSES.has(status));
  const now = options.now ?? Date.now;

  let rows: ReadonlyArray<Record<string, unknown>>;
  try {
    rows = await list(sessionId);
  } catch (error) {
    logger.warn('读取会话工作项失败（跳过 Mandate 重校验）', {
      sessionId,
      error: String(error),
    });
    return [];
  }

  const results: MandateRevalidationResult[] = [];
  for (const row of rows) {
    const ticketId = typeof row.id === 'string' ? row.id : '';
    if (!ticketId) continue;
    if (!isEnded(String(row.status ?? ''))) continue;

    const mandate = parseMandate(row.mandate);
    if (!mandate) continue;

    const outcome = revalidateMandate(
      mandate,
      factsFromPolicy(loaded.config, mandate)
    );
    results.push({
      ticketId,
      ok: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
      policyId: loaded.policyId,
    });
    logger.info('autonomy.mandate.revalidation', {
      ticketId,
      sessionId,
      policyId: loaded.policyId,
      mandatePolicyVersion: mandate.basis.policyVersion,
      ok: outcome.ok,
      ...(outcome.ok ? {} : { reason: outcome.reason }),
    });

    const revoked = row.mandateRevoked === true;
    try {
      if (!outcome.ok && !revoked) {
        const at = new Date(now()).toISOString();
        await write({
          ...row,
          mandateRevoked: true,
          mandateRevokedReason: outcome.reason,
          mandateRevokedAt: at,
          updatedAt: at,
        });
      } else if (outcome.ok && revoked) {
        const next = { ...row };
        delete next.mandateRevoked;
        delete next.mandateRevokedReason;
        delete next.mandateRevokedAt;
        next.updatedAt = new Date(now()).toISOString();
        await write(next);
      }
    } catch (error) {
      logger.warn('Mandate 重校验结果落盘失败（不影响消息处理）', {
        ticketId,
        sessionId,
        error: String(error),
      });
    }
  }

  return results;
}
