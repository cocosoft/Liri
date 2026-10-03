/**
 * 经验自动演化编排测试（T-②06 阶段 2，2026-10-03）
 *
 * 覆盖：失败样本筛选 / 样本签名 / 防抖判定（纯函数）+ 编排（写回覆盖层与技能侧车、
 * 技能名越界不写、落盘失败不推进状态、LLM 无输出、异常不抛）。
 */
import { describe, it, expect } from 'bun:test';
import type { EvolutionState } from '../../../src/utils/promptEvolution';
import {
  MIN_FAILURE_SAMPLES,
  buildEvolutionPrompt,
  computeSampleSignature,
  decideEvolution,
  parseEvolutionOutput,
  runAdaptationEvolution,
  selectFailureSamples,
  type EvolutionDeps,
  type ReviewSampleLike,
} from '../../../src/tasks/evolution/AdaptationEvolutionService';

function sample(
  id: string,
  converged: number | null,
  reason = '未达成目标'
): ReviewSampleLike {
  return {
    pdcaTaskId: id,
    goalText: `目标 ${id}`,
    stage: 'pdca_completed',
    converged,
    reason,
  };
}

const NEVER: EvolutionState = { lastAppliedAt: 0, lastSampleSignature: '' };

/** 构造可覆写的假依赖 */
function fakeDeps(overrides: Partial<EvolutionDeps> = {}): {
  deps: EvolutionDeps;
  written: {
    overlay: string[];
    skills: Array<[string, string]>;
    state: EvolutionState[];
    events: unknown[];
  };
} {
  const written = {
    overlay: [] as string[],
    skills: [] as Array<[string, string]>,
    state: [] as EvolutionState[],
    events: [] as unknown[],
  };
  const deps: EvolutionDeps = {
    loadReviewSamples: async () => [sample('t1', 0), sample('t2', 0)],
    listSkillCandidates: () => ['demo-skill'],
    generate: async () => ({ overlay: '- 要点一', skill: '', skillPatch: '' }),
    readState: () => NEVER,
    writeState: (s) => {
      written.state.push(s);
      return true;
    },
    writeOverlay: (text) => {
      written.overlay.push(text);
      return Buffer.byteLength(text, 'utf-8');
    },
    writeSkillSidecar: (name, text) => {
      written.skills.push([name, text]);
      return Buffer.byteLength(text, 'utf-8');
    },
    now: () => 1_000_000,
    emitEvent: async (payload) => {
      written.events.push(payload);
    },
    ...overrides,
  };
  return { deps, written };
}

describe('纯函数：失败样本筛选（L7 三态口径）', () => {
  it('只用 converged===0（明确未收敛）；1/未决(null) 均不算失败', () => {
    const rows = [
      sample('a', 1),
      sample('b', 0),
      sample('c', null),
      sample('d', 0),
    ];
    const failures = selectFailureSamples(rows);
    expect(failures.map((f) => f.pdcaTaskId)).toEqual(['b', 'd']);
  });

  it('reason 缺省 ⇒ 空串（不臆造文案）', () => {
    const rows = [{ ...sample('a', 0), reason: null }];
    expect(selectFailureSamples(rows)[0].reason).toBe('');
  });
});

describe('纯函数：样本签名与防抖判定', () => {
  it('签名与样本顺序无关；内容不同则签名不同', () => {
    const a = selectFailureSamples([sample('t1', 0), sample('t2', 0, 'r2')]);
    const b = selectFailureSamples([sample('t2', 0, 'r2'), sample('t1', 0)]);
    expect(computeSampleSignature(a)).toBe(computeSampleSignature(b));
    const c = selectFailureSamples([sample('t1', 0), sample('t2', 0, 'r3')]);
    expect(computeSampleSignature(a)).not.toBe(computeSampleSignature(c));
  });

  it('样本不足 ⇒ insufficient-samples', () => {
    expect(
      decideEvolution({
        sampleCount: MIN_FAILURE_SAMPLES - 1,
        signature: 's',
        state: NEVER,
        now: 1,
      })
    ).toBe('insufficient-samples');
  });

  it('签名与上次相同 ⇒ duplicate-signature', () => {
    expect(
      decideEvolution({
        sampleCount: 3,
        signature: 'same',
        state: { lastAppliedAt: 1, lastSampleSignature: 'same' },
        now: 10_000_000_000,
      })
    ).toBe('duplicate-signature');
  });

  it('距上次演化不足最小间隔 ⇒ throttled', () => {
    expect(
      decideEvolution({
        sampleCount: 3,
        signature: 'new',
        state: { lastAppliedAt: 1000, lastSampleSignature: 'old' },
        now: 1000 + 60_000,
      })
    ).toBe('throttled');
  });

  it('新签名 + 已过间隔 ⇒ null（应演化）', () => {
    expect(
      decideEvolution({
        sampleCount: 3,
        signature: 'new',
        state: { lastAppliedAt: 1, lastSampleSignature: 'old' },
        now: 10_000_000_000,
      })
    ).toBeNull();
  });
});

describe('纯函数：提示词与输出解析', () => {
  it('提示词含样本行与候选清单；无候选显示（无）', () => {
    const p = buildEvolutionPrompt({
      samples: selectFailureSamples([sample('t1', 0, '某原因')]),
      skillCandidates: ['demo-skill'],
    });
    expect(p).toContain('demo-skill');
    expect(p).toContain('某原因');
    expect(
      buildEvolutionPrompt({
        samples: selectFailureSamples([sample('t1', 0)]),
        skillCandidates: [],
      })
    ).toContain('（无）');
  });

  it('解析：纯 JSON / 代码块围栏均可；非 JSON ⇒ null', () => {
    expect(
      parseEvolutionOutput('{"overlay":"- a","skill":"","skillPatch":""}')
    ).toEqual({ overlay: '- a', skill: undefined, skillPatch: undefined });
    expect(parseEvolutionOutput('```json\n{"overlay":"- b"}\n```')).toEqual({
      overlay: '- b',
      skill: undefined,
      skillPatch: undefined,
    });
    expect(parseEvolutionOutput('不是 JSON')).toBeNull();
  });
});

describe('编排：runAdaptationEvolution（假依赖）', () => {
  it('样本不足 ⇒ 不调用 LLM、不写盘、不推进状态', async () => {
    const { deps, written } = fakeDeps({
      loadReviewSamples: async () => [sample('t1', 0)],
    });
    const r = await runAdaptationEvolution(deps);
    expect(r.skipped).toBe('insufficient-samples');
    expect(written.overlay).toEqual([]);
    expect(written.state).toEqual([]);
    expect(written.events).toEqual([]);
  });

  it('正常路径 ⇒ 写覆盖层 + 推进状态 + 落审计事件', async () => {
    const { deps, written } = fakeDeps();
    const r = await runAdaptationEvolution(deps);
    expect(r.skipped).toBeUndefined();
    expect(r.applied).toEqual([
      { scope: 'prompt', bytes: Buffer.byteLength('- 要点一', 'utf-8') },
    ]);
    expect(written.overlay).toEqual(['- 要点一']);
    expect(written.state).toHaveLength(1);
    expect(written.state[0].lastSampleSignature).not.toBe('');
    expect(written.events).toEqual([
      {
        scope: 'prompt',
        sampleCount: 2,
        bytes: Buffer.byteLength('- 要点一', 'utf-8'),
      },
    ]);
  });

  it('技能名不在候选清单 ⇒ 不写侧车（禁止臆造技能名）', async () => {
    const { deps, written } = fakeDeps({
      generate: async () => ({
        overlay: '- 要点',
        skill: 'not-in-candidates',
        skillPatch: '- 补丁',
      }),
    });
    const r = await runAdaptationEvolution(deps);
    expect(written.skills).toEqual([]);
    expect(r.applied.map((a) => a.scope)).toEqual(['prompt']);
  });

  it('技能名在候选清单 ⇒ 同时写侧车并各落一条审计', async () => {
    const { deps, written } = fakeDeps({
      generate: async () => ({
        overlay: '- 要点',
        skill: 'demo-skill',
        skillPatch: '- 侧车补丁',
      }),
    });
    const r = await runAdaptationEvolution(deps);
    expect(written.skills).toEqual([['demo-skill', '- 侧车补丁']]);
    expect(r.applied.map((a) => a.scope)).toEqual(['prompt', 'skill']);
    expect(written.events).toHaveLength(2);
  });

  it('LLM 无输出 ⇒ no-output，不写盘不推进状态', async () => {
    const { deps, written } = fakeDeps({ generate: async () => null });
    const r = await runAdaptationEvolution(deps);
    expect(r.skipped).toBe('no-output');
    expect(written.overlay).toEqual([]);
    expect(written.state).toEqual([]);
  });

  it('落盘失败 ⇒ write-failed 且**不推进状态**（经验不被吞，下次可重试）', async () => {
    const { deps, written } = fakeDeps({ writeOverlay: () => null });
    const r = await runAdaptationEvolution(deps);
    expect(r.skipped).toBe('write-failed');
    expect(written.state).toEqual([]);
    expect(written.events).toEqual([]);
  });

  it('依赖抛错 ⇒ error（不向外抛）', async () => {
    const { deps } = fakeDeps({
      loadReviewSamples: async () => {
        throw new Error('db down');
      },
    });
    const r = await runAdaptationEvolution(deps);
    expect(r.skipped).toBe('error');
    expect(r.sampleCount).toBe(0);
  });
});
