/**
 * 策略门控来源（P33-a + P35，2026-11-02）
 *
 * 在 `EventSource` 与 `SourceRegistry` 之间插入一层准入判定：
 * - 策略 `enabled=false` ⇒ 原样透传（行为与 P35 初始实现一致）；
 * - `observe/off/来源关闭/规则未命中` ⇒ **丢弃事件**（不落 Trigger、不建 Ticket）；
 * - `accept` ⇒ 在 `payload` 上附加 `policyId/mandate`，由 sink 随 Ticket 同一次写入落库。
 *
 * 为什么在来源侧而不是 registry 侧：registry 的职责是幂等/位点/串行，**不做业务判定**；
 * 准入属于"这件事是否被授权启动"（P33），与来源一一对应，放在最外层最直观。
 */
import { getLogger } from '@openliri/infra/monitoring';

import {
  evaluateAutonomyTrigger,
  toAutonomyDecisionLog,
} from '../autonomy/gate';
import {
  loadAutonomyPolicy,
  type LoadedAutonomyPolicy,
} from '../autonomy/policyConfig';
import {
  getPolicyChangeTracker,
  type PolicyChangeDelivery,
} from '../autonomy/policyChange';
import { computeTriggerId, type EventSource, type InboundEvent } from './types';

const logger = getLogger('tasks:policy-gated-source');

export interface PolicyGatedSourceOptions {
  loadPolicy?: () => LoadedAutonomyPolicy;
  observePolicyChange?: (
    loaded: LoadedAutonomyPolicy
  ) => Promise<PolicyChangeDelivery | null>;
}

/**
 * 包装一个来源：订阅时对每条事件做准入判定。
 *
 * 返回的 `EventSource` id 不变（日志/幂等键仍按原来源计算）。
 */
export function withPolicyGate(
  source: EventSource,
  options: PolicyGatedSourceOptions = {}
): EventSource {
  const loadPolicy = options.loadPolicy ?? loadAutonomyPolicy;
  const observePolicyChange =
    options.observePolicyChange ??
    ((loaded: LoadedAutonomyPolicy) =>
      getPolicyChangeTracker().observe(loaded));

  return {
    id: source.id,
    async subscribe(handler) {
      return source.subscribe(async (event: InboundEvent) => {
        const loaded = loadPolicy();
        // 变更观察：仅 policyId 变化时做 IO；失败不阻断事件
        await observePolicyChange(loaded);

        const triggerId = computeTriggerId(source.id, event);
        const trigger = {
          sourceId: source.id,
          threadKey: event.threadKey,
          triggerId,
          ...(typeof event.payload.workspaceId === 'string'
            ? { workspaceId: event.payload.workspaceId }
            : {}),
        };
        const decision = evaluateAutonomyTrigger({
          policy: loaded.config,
          policyId: loaded.policyId,
          trigger,
        });

        if (loaded.config.enabled) {
          logger.info(
            'autonomy.policy.decision',
            toAutonomyDecisionLog({
              source: loaded.source,
              trigger,
              policy: loaded.config,
              policyId: decision.policyId,
              decision,
            })
          );
        }

        if (decision.action === 'ignore') return;

        // 仅在策略启用时附加 Mandate（关闭态不产生策略元数据）
        const annotated: InboundEvent = loaded.config.enabled
          ? {
              ...event,
              payload: {
                ...event.payload,
                policyId: decision.policyId,
                ...(decision.mandate ? { mandate: decision.mandate } : {}),
              },
            }
          : event;

        await handler(annotated);
      });
    },
  };
}
