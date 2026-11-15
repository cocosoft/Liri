// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * #4 自校验档的「生效面」：**轮首**判定 verify / refine 意图 → 验证线路配方（2026-11-15）
 *
 * 规格：`.trae/specs/self-verify-turn-surface.md` §3。
 *
 * **为什么需要**（取证见 spec §1）：`selectPattern` 与配方应用此前**只**在
 * `PdcaLaunchCoordinator.maybeLaunch`（PDCA 长任务升级闸门）内 ⇒ 普通轮说「先自检再输出」
 * 时既不判定、也不应用配方、也不落决策。本模块把这三件事提到**每轮入口**。
 *
 * 三条硬约束：
 * - **零行为变更**：`SELF_VERIFY_PATTERN` 默认 `false` ⇒ 不新建循环、不应用配方；
 *   命中意图时仅多一条 log-only 的 `pattern/decision`（供默认关判据① 度量）。
 * - **不新造判定**：意图 / 选择 / 装配 / 配方换算全部复用既有单一事实源（CS01）。
 * - **可单测**：选择与配置是纯函数；副作用只经注入的 ports。
 */

import { getLogger } from '@openliri/infra/monitoring';
import { patternFeatureFlag, selectPattern } from '@modules/query/patterns';
import {
  instantiatePattern,
  resolveFeatureGate,
  verifierConfigForRecipe,
} from '@modules/query';
import type { LiriEvent, LiriEventData } from '@modules/session/types/events';

import { hasRefineIntent, hasVerifyIntent } from '../taskIntent';

const logger = getLogger('chat:manager');

/** 验证线路配方的目标 route（`self_verify` 与 `iterative_refine` 共用） */
const VERIFY_ROUTE = 'verify';

/** 配方换算得到的验证器配置（与 `verifierConfigForRecipe` 的返回形状同源） */
export type TurnVerifierConfig = ReturnType<typeof verifierConfigForRecipe>;

/** TAOR 循环上本模块唯一使用的接缝（应用配方） */
interface TurnVerifyConfigSink {
  applyVerifierConfig(config: TurnVerifierConfig): void;
}

/** 轮首判定结果（`null` = 本轮无 verify/refine 意图，**零开销**） */
export interface TurnVerifyPlan {
  /** 命中的模式名（`self_verify` / `iterative_refine`） */
  pattern: string;
  /** 选择层给的可执行路由（非 verify ⇒ `null`，本模块**不消费**） */
  route: string | null;
  /** 装配状态（如实，供决策事件） */
  status: 'ready' | 'unavailable';
  /** 命中模式声明的功能门控名（无门控 ⇒ 缺省） */
  featureFlag?: string;
  /** 门控在**判定时刻**的值（`false` = 命中但未启用） */
  gateEnabled: boolean;
  /** 配方 → 验证器配置；路由非 verify 或装配 unavailable ⇒ `null` */
  verifierConfig: TurnVerifierConfig | null;
}

/** 副作用端口（全部由宿主注入 ⇒ 本模块无 I/O 依赖） */
export interface TurnVerifyRecipePorts {
  /** 取/建该会话的 TAOR 循环（仅门控开启时调用 ⇒ 默认关不建循环） */
  getOrCreateTAORLoop(sessionId: string): {
    applyVerifierConfig(config: TurnVerifierConfig): void;
  };
  /** 撤销**已存在**循环上的配方（不新建；门控关闭 / 未命中时用） */
  resetVerifierConfigIfActive(sessionId: string): void;
  /** 事件 seq 分配（宿主唯一入口） */
  getStreamTailSeq(sessionId: string): Promise<number>;
  /** 事件写入（宿主唯一入口） */
  appendStreamEvent(sessionId: string, event: LiriEvent): Promise<unknown>;
}

/** 落盘结果（供调用方日志/测试断言） */
export interface TurnVerifyApplyResult {
  plan: TurnVerifyPlan;
  /** 本轮是否真的应用了配方（= 门控开 + route=verify + 装配 ready） */
  applied: boolean;
  /** 本轮是否撤销了此前已应用的配方 */
  reset: boolean;
}

/**
 * 宿主端口（`ChatOrchestratorHost` 的结构子集）。
 *
 * `getOrCreateTAORLoop` 在宿主侧签名返回 `unknown`（宿主不引 query 重类型）⇒
 * 本模块在**调用点收窄**为需要的单个方法。
 */
export interface TurnVerifyHostPorts {
  getOrCreateTAORLoop(sessionId: string): unknown;
  resetVerifierConfigIfActive(sessionId: string): void;
  getStreamTailSeq(sessionId: string): Promise<number>;
  appendStreamEvent(sessionId: string, event: LiriEvent): Promise<unknown>;
}

/** 宿主侧一行入口（fire-and-forget；入口失败只留 debug 日志，不阻塞回合） */
export function applyTurnVerifyRecipeForHost(
  host: TurnVerifyHostPorts,
  sessionId: string,
  text: string
): void {
  void runTurnVerifyRecipe(
    {
      getOrCreateTAORLoop: (sid) =>
        host.getOrCreateTAORLoop(sid) as TurnVerifyConfigSink,
      resetVerifierConfigIfActive: (sid) =>
        host.resetVerifierConfigIfActive(sid),
      getStreamTailSeq: (sid) => host.getStreamTailSeq(sid),
      appendStreamEvent: (sid, event) => host.appendStreamEvent(sid, event),
    },
    sessionId,
    text
  ).catch(() => {
    // @ignore-catch — 轮首判定失败不影响本轮（CS03）
  });
}

/**
 * 轮首判定（纯函数）。
 *
 * ① 无 verify/refine 意图 ⇒ `null`（早退，不触碰选择层）；
 * ② 命中 ⇒ 走既有 `selectPattern`（`verify` / `refine` 信号）与 `instantiatePattern`；
 * ③ 仅当 `route==='verify'` 时把配方换算为验证器配置，并按门控真值给出 `gateEnabled`。
 */
export function planTurnVerifyRecipe(text: string): TurnVerifyPlan | null {
  const verify = hasVerifyIntent(text);
  const refine = hasRefineIntent(text);
  if (!verify && !refine) return null;

  const selection = selectPattern({
    complexity: 'complex',
    verify,
    refine,
  });
  if (!selection) return null;

  const pattern = selection.descriptor.name;
  const instantiation = instantiatePattern(selection);
  const featureFlag = patternFeatureFlag(pattern);
  const gateEnabled = featureFlag ? resolveFeatureGate(featureFlag) : true;

  if (
    instantiation.status !== 'ready' ||
    instantiation.route !== VERIFY_ROUTE
  ) {
    return {
      pattern,
      route: null,
      status: instantiation.status,
      ...(featureFlag ? { featureFlag } : {}),
      gateEnabled,
      verifierConfig: null,
    };
  }
  return {
    pattern,
    route: instantiation.route,
    status: 'ready',
    ...(featureFlag ? { featureFlag } : {}),
    gateEnabled,
    verifierConfig: verifierConfigForRecipe(instantiation.recipe),
  };
}

/**
 * 应用本轮配方（有副作用，只经 ports）。
 *
 * - 门控开 + route=verify ⇒ `applyVerifierConfig`（**建/取循环**）；
 * - 其余（门控关 / 路由非 verify）⇒ `resetVerifierConfigIfActive`（只撤销，不新建）——
 *   与 2026-11-03 既有语义一致：`configure` 是合并式长期生效，只停写会让会话停留在旧档位。
 */
export function applyTurnVerifyRecipe(
  ports: TurnVerifyRecipePorts,
  sessionId: string,
  plan: TurnVerifyPlan
): { applied: boolean; reset: boolean } {
  const config = plan.verifierConfig;
  if (config && plan.gateEnabled) {
    ports.getOrCreateTAORLoop(sessionId).applyVerifierConfig(config);
    logger.info('轮首应用验证线路配方', {
      sessionId,
      pattern: plan.pattern,
      verifier: config,
    });
    return { applied: true, reset: false };
  }
  if (plan.route === VERIFY_ROUTE) {
    ports.resetVerifierConfigIfActive(sessionId);
    logger.info('验证线路门控未启用，撤销验证器配方', {
      sessionId,
      pattern: plan.pattern,
    });
    return { applied: false, reset: true };
  }
  return { applied: false, reset: false };
}

/** 决策事件载荷（`site='turn_dispatch'`；`applied` 取自实际落盘结果） */
export function buildTurnVerifyDecision(
  plan: TurnVerifyPlan,
  applied: boolean
): LiriEventData<'pattern/decision'> {
  return {
    site: 'turn_dispatch',
    selected: plan.pattern,
    status: plan.status,
    ...(plan.route ? { route: plan.route } : {}),
    ...(plan.featureFlag
      ? { featureGate: { flag: plan.featureFlag, enabled: plan.gateEnabled } }
      : {}),
    applied,
  };
}

/**
 * 完整流程：判定 → 应用/撤销 → 落决策。
 *
 * 调用方（两个聊天入口）**只需**转交宿主端口；`text` 为本轮用户文本。
 */
export async function runTurnVerifyRecipe(
  ports: TurnVerifyRecipePorts,
  sessionId: string,
  text: string
): Promise<TurnVerifyApplyResult | null> {
  const plan = planTurnVerifyRecipe(text);
  if (!plan) return null;

  const { applied, reset } = applyTurnVerifyRecipe(ports, sessionId, plan);
  await persistTurnVerifyDecision(ports, sessionId, plan, applied);
  return { plan, applied, reset };
}

/** 落决策（失败不阻断本轮：`pattern/decision` 是 log-only 轨迹） */
async function persistTurnVerifyDecision(
  ports: TurnVerifyRecipePorts,
  sessionId: string,
  plan: TurnVerifyPlan,
  applied: boolean
): Promise<void> {
  try {
    const tail = await ports.getStreamTailSeq(sessionId);
    await ports.appendStreamEvent(sessionId, {
      type: 'pattern/decision',
      seq: tail + 1,
      time: Date.now(),
      sessionId,
      data: buildTurnVerifyDecision(plan, applied),
    } as LiriEvent);
  } catch (error) {
    // @ignore-catch — 轨迹落盘失败不影响回合（与 PdcaLaunch 同口径，CS03）
    logger.debug('pattern:decision_persist_failed', { error: String(error) });
  }
}
