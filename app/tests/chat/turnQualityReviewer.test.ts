/**
 * U4 / D3：可疑轮 LLM 复核器（`VerifierAgent` 装配）单测。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 **D3**。
 *
 * ⚠️ 本文件**反向锁定**两条硬约束：
 *  ① 未配置"任务分工 → verifier"（模型名为 `''`）⇒ **不创建复核器**（**不回退选模型**）；
 *  ② **每轮新建 `VerifierAgent` 实例** —— 复用实例会因 `cycleCount` 累积达 `maxCycles`
 *     使**第 2 轮起恒 `ESCALATE`**（见用例"连续多轮"）。
 */
import { describe, expect, it } from 'bun:test';
import { createVerifierTurnReviewer } from '../../src/chat/quality/turnQualityReviewer';

/** 假流式客户端：记录调用次数 + 逐块吐出预设文本（默认一句合法 JSON） */
function makeClient(script: () => string[] | 'throw') {
  let calls = 0;
  const client = {
    get calls() {
      return calls;
    },
    // 与 `ToolAwareClient.chatStream` 结构兼容（忽略入参）
    async *chatStream(): AsyncGenerator<unknown> {
      calls += 1;
      const chunks = script();
      if (chunks === 'throw') throw new Error('model exploded');
      for (const c of chunks) yield c;
    },
  };
  return client;
}

const APPROVE_JSON = '{"verdict":"APPROVE","confidence":0.9}';
const CHECKS_ALL_PASS_JSON =
  '{"verdict":"REJECT","confidence":0.9,"checks":[{"item":"切题","passed":true},{"item":"无矛盾","passed":true}]}';

describe('U4 D3：复核器创建前置', () => {
  it('未配置 verifier 分工（模型名空） ⇒ 返回 null，且不取客户端', async () => {
    let gotClient = false;
    const reviewer = await createVerifierTurnReviewer({
      resolveVerifierModelName: () => '',
      getClientForModel: () => {
        gotClient = true;
        return makeClient(() => [APPROVE_JSON]);
      },
    });
    expect(reviewer).toBeNull();
    expect(gotClient).toBe(false);
  });

  it('无正文可评 ⇒ 返回 null 且**零 LLM 调用**（不臆断质量）', async () => {
    const client = makeClient(() => [APPROVE_JSON]);
    const reviewer = await createVerifierTurnReviewer({
      resolveVerifierModelName: () => 'verifier-model',
      getClientForModel: () => client,
    });
    expect(reviewer).not.toBeNull();
    expect(await reviewer!({ sessionId: 's1', turnNumber: 1 })).toBeNull();
    expect(
      await reviewer!({ sessionId: 's1', turnNumber: 2, assistantText: '   ' })
    ).toBeNull();
    expect(client.calls).toBe(0);
  });
});

describe('U4 D3：复核结论映射', () => {
  it('无 checks ⇒ 单指标路径，verdict/confidence 透传', async () => {
    const client = makeClient(() => [APPROVE_JSON]);
    const reviewer = await createVerifierTurnReviewer({
      resolveVerifierModelName: () => 'verifier-model',
      getClientForModel: () => client,
    });
    const r = await reviewer!({
      sessionId: 's1',
      turnNumber: 3,
      assistantText: '这是本轮答复正文。',
    });
    expect(r).not.toBeNull();
    expect(r!.verdict).toBe('APPROVE');
    expect(r!.confidence).toBeCloseTo(0.9, 10);
    expect(r!.checkPassRate).toBeUndefined();
    expect(client.calls).toBe(1);
  });

  it('有 checks 全过 ⇒ 通过率**推翻**模型自报的 REJECT（双指标语义）', async () => {
    const client = makeClient(() => [CHECKS_ALL_PASS_JSON]);
    const reviewer = await createVerifierTurnReviewer({
      resolveVerifierModelName: () => 'verifier-model',
      getClientForModel: () => client,
    });
    const r = await reviewer!({
      sessionId: 's1',
      turnNumber: 4,
      assistantText: '这是本轮答复正文。',
    });
    expect(r!.verdict).toBe('APPROVE');
    expect(r!.checkPassRate).toBe(1);
  });

  it('模型异常 ⇒ fail-closed：ESCALATE（不放行，不降级为通过）', async () => {
    const client = makeClient(() => 'throw');
    const reviewer = await createVerifierTurnReviewer({
      resolveVerifierModelName: () => 'verifier-model',
      getClientForModel: () => client,
    });
    const r = await reviewer!({
      sessionId: 's1',
      turnNumber: 5,
      assistantText: '这是本轮答复正文。',
    });
    expect(r).not.toBeNull();
    expect(r!.verdict).toBe('ESCALATE');
    expect(r!.confidence).toBe(0);
  });

  it('响应不可解析（非 JSON）⇒ 也走 fail-closed ESCALATE', async () => {
    const client = makeClient(() => ['抱歉，我无法判断。']);
    const reviewer = await createVerifierTurnReviewer({
      resolveVerifierModelName: () => 'verifier-model',
      getClientForModel: () => client,
    });
    const r = await reviewer!({
      sessionId: 's1',
      turnNumber: 6,
      assistantText: '这是本轮答复正文。',
    });
    // 非 JSON ⇒ `_parseResponse` 抛错 ⇒ fail-closed
    expect(r!.verdict).toBe('ESCALATE');
  });
});

describe('U4 D3：每轮独立实例（关键回归）', () => {
  it('连续复核 4 轮结果一致 —— 复用实例会使第 2 轮起恒 ESCALATE', async () => {
    const client = makeClient(() => [APPROVE_JSON]);
    const reviewer = await createVerifierTurnReviewer({
      resolveVerifierModelName: () => 'verifier-model',
      getClientForModel: () => client,
    });
    const verdicts: string[] = [];
    for (let turn = 1; turn <= 4; turn++) {
      const r = await reviewer!({
        sessionId: 's1',
        turnNumber: turn,
        assistantText: `第 ${turn} 轮答复正文。`,
      });
      verdicts.push(r!.verdict);
    }
    expect(verdicts).toEqual(['APPROVE', 'APPROVE', 'APPROVE', 'APPROVE']);
    expect(client.calls).toBe(4);
  });
});
