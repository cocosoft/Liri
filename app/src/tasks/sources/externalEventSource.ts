/**
 * externalEventSource —— 外部系统推送 → 入站事件（D1，2026-11-14）
 *
 * 定位：webhook / GitHub issue / 邮件轮询等**外部事件**的统一适配层，
 * 接入既有 `SourceRegistry`（不新建调度器 / 不新建队列）。
 *
 * 数据流（与 `fsSignalSource` 同构）：
 * ```
 * POST /v1/events/external/<sourceId>（签名 + 去重 + 限速，见 externalEventIntake）
 *   → externalEventSource.emit(payload)
 *   → InboundEvent（线程 = external:<threadId>，幂等键 = eventId）
 *   → withPolicyGate（`autonomy.policy.sources.external === true` 才放行）
 *   → SourceRegistry（幂等 / 同线程串行）
 *   → ticketSink（`trigger:<id>` 工作项）→ ticketRunConsumer
 * ```
 *
 * 边界（如实）：
 * - 本模块**不解释**业务语义：`payload` 原样进入工作项；
 * - 未订阅时 `emit` 返回 `false`（不静默吞掉：调用方据此回 503）；
 * - 线程键缺省用 `eventId`（同一事件重投串行、不同事件并行）。
 */
import { getLogger } from '@openliri/infra/monitoring';
import {
  asThreadKey,
  THREAD_KEY_PREFIX,
  type EventSource,
  type InboundEvent,
} from './types';

const logger = getLogger('tasks:external-source');

/** 外部事件的来源标识（与 `policyConfig.sources` 的键同名） */
export const EXTERNAL_SOURCE_ID = 'external';

/** 一次外部推送的最小事实（由 HTTP 层/轮询器提供） */
export interface ExternalEventInput {
  /** 来源方事件 id（幂等键；重投必须相同） */
  eventId: string;
  /** 结构化载荷（原样进入工作项） */
  payload: Record<string, unknown>;
  /** 串行域（缺省 = eventId）；同一对象的事件应给同一 threadId */
  threadId?: string;
}

/** 纯函数：外部事件 → 入站事件（唯一翻译点） */
export function externalEventToInbound(
  input: ExternalEventInput
): InboundEvent {
  const threadId = input.threadId?.trim() || input.eventId;
  return {
    threadKey: asThreadKey(THREAD_KEY_PREFIX.external, threadId),
    externalId: input.eventId,
    type: 'external_event',
    payload: input.payload,
  };
}

/** 推送型事件来源（`emit` 由入站受理层调用） */
export interface ExternalEventSource extends EventSource {
  /** @returns 是否已投递给订阅方（未订阅 / handler 抛错 ⇒ `false`） */
  emit(input: ExternalEventInput): Promise<boolean>;
}

export function createExternalEventSource(options?: {
  id?: string;
}): ExternalEventSource {
  const id = options?.id ?? EXTERNAL_SOURCE_ID;
  let handler: ((event: InboundEvent) => void | Promise<void>) | null = null;

  return {
    id,
    async subscribe(next) {
      handler = next;
      return () => {
        if (handler === next) handler = null;
      };
    },
    async emit(input) {
      if (!handler) {
        logger.warn('外部事件到达但来源未订阅（流水线未启动）', {
          sourceId: id,
          eventId: input.eventId,
        });
        return false;
      }
      try {
        await handler(externalEventToInbound(input));
        return true;
      } catch (e) {
        logger.warn('外部事件投递失败', {
          sourceId: id,
          eventId: input.eventId,
          error: String(e),
        });
        return false;
      }
    },
  };
}
