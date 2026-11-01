/**
 * projectionOutbound — 四原语投影的**统一出站管道**（U-15，2026-10-18）。
 *
 * ## 定位
 * `projectionBroker` 只负责把投影发布到 `globalEventBus`（进程内广播）；
 * 本模块是**唯一出站 choke point**：一次订阅 `STATE_PROJECTED`，再 fan-out 给已注册的
 * 出站 sink（HTTP SSE / 未来通道插件适配器）。
 *
 * ## 边界（沿用 `projectionBroker` / 状态机规范方案 §3/§4.3）
 * - **不是第二事实源**：只搬运 `StateProjectionBroadcast`，不解释、不改写；
 * - **不做裁决**：sink 异常只留痕，绝不回流主链路；
 * - **不新增事件名**：仍消费 `SystemEvents.STATE_PROJECTED`；
 * - **默认零行为**：`projectionBroker` 的 `STATE_PROJECTION_BROADCAST` 开关关 ⇒ 无事件可转发。
 *
 * ## 生命周期
 * 首个 sink 注册时建立订阅；最后一个 sink 注销时释放订阅（避免常驻监听器）。
 */

import {
  globalEventBus,
  SystemEvents,
  type EventSubscription,
} from '@openliri/kernel/events/EventBus.js';
import type { StateProjectionBroadcast } from './projectionBroker.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('state:projectionOutbound');

/** 出站 sink：一个消费者（HTTP SSE / 通道插件适配器 / 测试替身） */
export interface ProjectionOutboundSink {
  /** 诊断名（日志用，不参与业务判定） */
  readonly name: string;
  /**
   * 可选投递准入：返回 `false` ⇒ 本条不交付（T25-01）。
   *
   * **归属判定由 sink 自己声明**，本模块只机械调用 —— 保住「不做裁决 / 只搬运」边界
   * （见文件头 `## 边界`）。缺省 ⇒ 恒交付（历史行为）。
   */
  accept?(projection: StateProjectionBroadcast): boolean;
  /** 交付一条投影；实现方不得抛异常（本模块仍会兜底捕获） */
  deliver(projection: StateProjectionBroadcast): void;
}

const sinks = new Set<ProjectionOutboundSink>();
let subscription: EventSubscription | null = null;

function ensureSubscribed(): void {
  if (subscription) return;
  subscription = globalEventBus.subscribe<StateProjectionBroadcast>(
    SystemEvents.STATE_PROJECTED,
    (projection) => {
      for (const sink of sinks) {
        // T25-01：准入由 sink 自声明；本模块**不做**任何身份/租户判定（只机械调用）。
        if (sink.accept && !sink.accept(projection)) continue;
        try {
          sink.deliver(projection);
        } catch (err) {
          // 观测面失败只留痕（CS03：不把出站失败升级为主链路失败）
          logger.warn('projection outbound sink failed（仅留痕）', {
            sink: sink.name,
            domain: projection.domain,
            primitive: projection.primitive,
            error: String(err),
          });
        }
      }
    }
  );
}

/**
 * 注册一个出站 sink，返回注销函数（幂等）。
 *
 * 首个 sink 注册时自动建立 `STATE_PROJECTED` 订阅；重复注册同一对象不会重复交付。
 */
export function registerProjectionOutboundSink(
  sink: ProjectionOutboundSink
): () => void {
  sinks.add(sink);
  ensureSubscribed();

  let unregistered = false;
  return () => {
    if (unregistered) return;
    unregistered = true;
    sinks.delete(sink);
    if (sinks.size === 0 && subscription) {
      subscription.unsubscribe();
      subscription = null;
    }
  };
}

/** 当前出站 sink 数（健康检查 / 测试断言用） */
export function getProjectionOutboundSinkCount(): number {
  return sinks.size;
}

/**
 * 测试隔离：清空 sink 与订阅。
 * 生产代码不调用（正常路径走注销函数）。
 */
export function resetProjectionOutboundForTest(): void {
  sinks.clear();
  subscription?.unsubscribe();
  subscription = null;
}
