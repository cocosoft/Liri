// MIT License
// Copyright (c) 2026 190615273@qq.com

/**
 * #4 自校验档「生效面」（2026-11-15，`.trae/specs/self-verify-turn-surface.md`）
 *
 * 钉住四件事：
 * ① **无意图 ⇒ 零开销**（不碰选择层、不建循环、不落事件）；
 * ② **门控关（默认）⇒ 只撤销**（`resetVerifierConfigIfActive`，绝不新建循环）；
 * ③ **门控开 ⇒ 应用既有配方**（`self_verify` maxCycles 2 / `iterative_refine` 4）；
 * ④ **决策可度量**：命中时落 `pattern/decision`，`site='turn_dispatch'`、`featureGate.enabled` 如实。
 */
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import type { LiriEvent } from '@modules/session/types/events';
import {
  applyTurnVerifyRecipe,
  planTurnVerifyRecipe,
  runTurnVerifyRecipe,
  type TurnVerifierConfig,
  type TurnVerifyRecipePorts,
} from '../../src/chat/manager/verifyRecipeTurn';

const ENV_FLAG = 'FEATURE_SELF_VERIFY_PATTERN';

/** 命中 verify 意图（词表见 `taskIntent.ts`） */
const VERIFY_TEXT = '执行完先自检一次再给我';
/** 命中 refine 意图（`iterative_refine` 的 deep 档） */
const REFINE_TEXT = '帮我把这份报告多轮打磨一下';
/** 无意图 */
const PLAIN_TEXT = '解释一下依赖注入是什么';

/** 假 ports（记录副作用次数；`seq` 恒为 0 = 交日志原子分配） */
function fakePorts(over: Partial<TurnVerifyRecipePorts> = {}) {
  const calls = {
    created: 0,
    applied: [] as TurnVerifierConfig[],
    reset: 0,
    events: [] as LiriEvent[],
  };
  const ports: TurnVerifyRecipePorts = {
    getOrCreateTAORLoop: () => {
      calls.created += 1;
      return {
        applyVerifierConfig: (config: TurnVerifierConfig) => {
          calls.applied.push(config);
        },
      };
    },
    resetVerifierConfigIfActive: () => {
      calls.reset += 1;
    },
    appendStreamEvent: async (_sessionId, event) => {
      calls.events.push(event);
      return undefined;
    },
    ...over,
  };
  return { ports, calls };
}

beforeEach(() => {
  // env 优先于用户设置 ⇒ 用例不受本机 config 影响
  delete process.env[ENV_FLAG];
});

afterEach(() => {
  delete process.env[ENV_FLAG];
});

describe('planTurnVerifyRecipe（纯判定）', () => {
  it('无 verify/refine 意图 ⇒ null（零开销）', () => {
    expect(planTurnVerifyRecipe(PLAIN_TEXT)).toBeNull();
    expect(planTurnVerifyRecipe('')).toBeNull();
  });

  it('verify 意图 + 门控关（默认）⇒ 命中 self_verify，但不启用', () => {
    process.env[ENV_FLAG] = 'false';
    const plan = planTurnVerifyRecipe(VERIFY_TEXT)!;
    expect(plan.pattern).toBe('self_verify');
    expect(plan.route).toBe('verify');
    expect(plan.featureFlag).toBe('SELF_VERIFY_PATTERN');
    expect(plan.gateEnabled).toBe(false);
    expect(plan.verifierConfig).toEqual({
      enabled: true,
      failClosed: true,
      maxCycles: 2,
    });
  });

  it('refine 意图 + 门控开 ⇒ iterative_refine（deep 档 maxCycles 4）', () => {
    process.env[ENV_FLAG] = 'true';
    const plan = planTurnVerifyRecipe(REFINE_TEXT)!;
    expect(plan.pattern).toBe('iterative_refine');
    expect(plan.gateEnabled).toBe(true);
    expect(plan.verifierConfig?.maxCycles).toBe(4);
  });
});

describe('applyTurnVerifyRecipe（应用 / 撤销）', () => {
  it('门控关 ⇒ 只撤销已存在循环的配方，不新建、不应用', () => {
    process.env[ENV_FLAG] = 'false';
    const plan = planTurnVerifyRecipe(VERIFY_TEXT)!;
    const { ports, calls } = fakePorts();
    expect(applyTurnVerifyRecipe(ports, 's1', plan)).toEqual({
      applied: false,
      reset: true,
    });
    expect(calls.created).toBe(0);
    expect(calls.applied).toHaveLength(0);
    expect(calls.reset).toBe(1);
  });

  it('门控开 ⇒ 应用既有配方（建/取循环一次）', () => {
    process.env[ENV_FLAG] = 'true';
    const plan = planTurnVerifyRecipe(VERIFY_TEXT)!;
    const { ports, calls } = fakePorts();
    expect(applyTurnVerifyRecipe(ports, 's1', plan)).toEqual({
      applied: true,
      reset: false,
    });
    expect(calls.created).toBe(1);
    const config = calls.applied[0] as TurnVerifierConfig;
    expect(config).toEqual({ enabled: true, failClosed: true, maxCycles: 2 });
    expect(calls.reset).toBe(0);
  });
});

describe('runTurnVerifyRecipe（判定 → 应用 → 落决策）', () => {
  it('命中即落 turn_dispatch（含门控真值与 applied）', async () => {
    process.env[ENV_FLAG] = 'false';
    const { ports, calls } = fakePorts();
    const result = await runTurnVerifyRecipe(ports, 's1', VERIFY_TEXT);
    expect(result?.applied).toBe(false);
    expect(calls.events).toHaveLength(1);
    const event = calls.events[0] as LiriEvent;
    expect(event.type).toBe('pattern/decision');
    expect(event.seq).toBe(0); // 交 EventLog 在 mutex 内原子分配（勿自行 tail+1）
    const data = event.data as {
      site: string;
      selected: string;
      applied: boolean;
      featureGate: { flag: string; enabled: boolean };
    };
    expect(data.site).toBe('turn_dispatch');
    expect(data.selected).toBe('self_verify');
    expect(data.applied).toBe(false);
    expect(data.featureGate).toEqual({
      flag: 'SELF_VERIFY_PATTERN',
      enabled: false,
    });
  });

  it('无意图 ⇒ 不落事件、不建循环', async () => {
    const { ports, calls } = fakePorts();
    expect(await runTurnVerifyRecipe(ports, 's1', PLAIN_TEXT)).toBeNull();
    expect(calls.events).toHaveLength(0);
    expect(calls.created).toBe(0);
    expect(calls.reset).toBe(0);
  });

  it('落决策失败不抛（log-only 轨迹）', async () => {
    process.env[ENV_FLAG] = 'true';
    const { ports } = fakePorts({
      appendStreamEvent: async () => {
        throw new Error('disk full');
      },
    });
    const result = await runTurnVerifyRecipe(ports, 's1', VERIFY_TEXT);
    expect(result?.applied).toBe(true);
  });
});
