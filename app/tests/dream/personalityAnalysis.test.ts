/**
 * 人格/偏好分析接线（2026-11-25 第 4 批，记录 #2）。
 *
 * 回归点：`UnifiedDreamCycle` 原先把字面 `'{}'` 当作分析结果传给
 * `analyzeSoulAlignment` / `analyzeUserProfileChanges` ⇒ `needsUpdate` 恒 false、
 * SOUL/USER 永不更新（阶段 1「LLM 分析」实际从未执行）。
 * 现由 `PersonalityReflector.analyzeWithModel()` 生成真实分析结果，并遵守
 * "无观测 / 无 provider / 调用失败 ⇒ '{}'（不更新、不伪造）"。
 */
import { describe, expect, it } from 'bun:test';
import {
  buildPersonalityAnalysisPrompt,
  PersonalityReflector,
} from '@modules/dream/reflect/PersonalityReflector';

const INPUT = {
  soul: '# SOUL\n你是克制、先求证再结论的助手。',
  user: '# USER\n- 偏好中文回答',
  sessionExcerpts: ['[user] 以后都先用证据再下结论\n[assistant] 明白'],
};

function stubAi(options: {
  modelId?: string | null;
  provider?: unknown;
  content?: string;
}) {
  const calls: unknown[] = [];
  return {
    calls,
    resolveAi: () => ({
      getModelRouter: () => ({
        resolveAsync: async () => options.modelId ?? null,
      }),
      getProviderRegistry: () => ({
        getByModel: () => options.provider ?? null,
        getDefaultProvider: () => options.provider ?? null,
      }),
      createToolAwareClient: () => ({
        sendMessage: async (messages: unknown) => {
          calls.push(messages);
          return { content: options.content ?? '{}' };
        },
      }),
    }),
  };
}

describe('buildPersonalityAnalysisPrompt', () => {
  it('当前 SOUL/USER 与真实会话片段都进入提示词，并要求只输出 JSON', () => {
    const prompt = buildPersonalityAnalysisPrompt(INPUT);
    expect(prompt).toContain('你是克制、先求证再结论的助手。');
    expect(prompt).toContain('偏好中文回答');
    expect(prompt).toContain('以后都先用证据再下结论');
    expect(prompt).toContain('"soul"');
    expect(prompt).toContain('"user"');
    expect(prompt).toContain('只输出 JSON');
  });
});

describe('PersonalityReflector.analyzeWithModel', () => {
  it('有会话观测 + 可用 provider ⇒ 返回模型给出的人格分析 JSON', async () => {
    const payload = JSON.stringify({
      soul: {
        needsUpdate: true,
        suggestedPatch: '- 回答前先给出证据出处',
        reason: '用户明确要求以证据为先',
        confidence: 0.9,
      },
      user: { needsUpdate: false, confidence: 0 },
    });
    const stub = stubAi({
      modelId: 'quick-model',
      provider: {},
      content: payload,
    });
    const reflector = new PersonalityReflector();

    const raw = await reflector.analyzeWithModel(INPUT, {
      resolveAi: stub.resolveAi,
    });

    expect(stub.calls).toHaveLength(1);
    const soul = reflector.analyzeSoulAlignment(INPUT.soul, raw);
    expect(soul.needsUpdate).toBe(true);
    expect(soul.confidence).toBe(0.9);
    expect(soul.suggestedPatch).toBe('- 回答前先给出证据出处');
  });

  it('无会话观测 ⇒ 直接返回 {} 且不调用模型（零成本）', async () => {
    const stub = stubAi({ modelId: 'quick-model', provider: {} });
    const reflector = new PersonalityReflector();

    const raw = await reflector.analyzeWithModel(
      { ...INPUT, sessionExcerpts: [] },
      { resolveAi: stub.resolveAi }
    );

    expect(raw).toBe('{}');
    expect(stub.calls).toHaveLength(0);
  });

  it('无可用 provider ⇒ 返回 {}（needsUpdate=false，不伪造更新）', async () => {
    const stub = stubAi({ modelId: null, provider: null });
    const reflector = new PersonalityReflector();

    const raw = await reflector.analyzeWithModel(INPUT, {
      resolveAi: stub.resolveAi,
    });

    expect(raw).toBe('{}');
    expect(stub.calls).toHaveLength(0);
    expect(reflector.analyzeSoulAlignment(INPUT.soul, raw).needsUpdate).toBe(
      false
    );
    expect(
      reflector.analyzeUserProfileChanges(INPUT.user, raw).needsUpdate
    ).toBe(false);
  });

  it('模型调用抛错 ⇒ 降级为 {}（不冒泡、不伪造）', async () => {
    const reflector = new PersonalityReflector();
    const raw = await reflector.analyzeWithModel(INPUT, {
      resolveAi: () => ({
        getModelRouter: () => null,
        getProviderRegistry: () => ({
          getByModel: () => ({}),
          getDefaultProvider: () => ({}),
        }),
        createToolAwareClient: () => ({
          sendMessage: async () => {
            throw new Error('provider down');
          },
        }),
      }),
    });

    expect(raw).toBe('{}');
  });
});
