// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// 对抗 Agent 形态 A —— **LLM 提案器适配器**契约用例（`.trae/specs/adversarial-agent-form-a.md` §5.2/§10）
//
// 全部用**注入式假 chat**（零额度、零网络）：覆盖有界调用 / 去重收敛 / 解析容错 / 调用失败降级 /
// 提示词组装（安全面：含目标闭集与已声明防线）。

import { describe, expect, it } from 'bun:test';
import {
  buildRedTeamPrompt,
  createLlmProposer,
  extractJsonArray,
  RED_TEAM_SYSTEM_PROMPT,
  type AdversarialChat,
} from '../../src/evals/adversarialProposer';
import type { AdversarialProposerInput } from '../../src/evals/adversarialAgent';

const INPUT: AdversarialProposerInput = {
  declaredShields: ['/x/report'],
  targets: [
    { id: 'C-1', title: '报告目录已屏蔽' },
    { id: 'C-3', title: '沙箱根不在 bash 可写放行区内' },
  ],
};

const arr = (items: unknown[]): string => JSON.stringify(items);

describe('extractJsonArray（容忍围栏与噪声；失败 ⇒ null，不臆造）', () => {
  it('裸数组 / ```json 围栏 / 前后噪声 均可解析', () => {
    expect(extractJsonArray('[{"id":"P-1"}]')).toEqual([{ id: 'P-1' }]);
    expect(extractJsonArray('```json\n[{"id":"P-1"}]\n```')).toEqual([
      { id: 'P-1' },
    ]);
    expect(extractJsonArray('好的，如下：\n[{"id":"P-1"}]\n以上。')).toEqual([
      { id: 'P-1' },
    ]);
  });

  it('无数组 / 非法 JSON ⇒ null', () => {
    expect(extractJsonArray('没有数组')).toBeNull();
    expect(extractJsonArray('[{"id": ]')).toBeNull();
    expect(extractJsonArray('[]')).toEqual([]);
  });
});

describe('buildRedTeamPrompt（安全面：只给目标闭集 + 已声明防线）', () => {
  it('包含目标 id 与已声明防线；含系统提示词约束', () => {
    const prompt = `${RED_TEAM_SYSTEM_PROMPT}\n\n${buildRedTeamPrompt(INPUT, [])}`;
    expect(prompt).toContain('C-1');
    expect(prompt).toContain('C-3');
    expect(prompt).toContain('/x/report');
    expect(prompt).toContain('JSON');
  });
});

describe('createLlmProposer（有界 + 去重收敛 + 降级）', () => {
  it('单轮产出 ⇒ 原样返回', async () => {
    const chat: AdversarialChat = async () =>
      arr([{ id: 'P-1', target: 'C-1', steps: [], expectation: 'e1' }]);
    const proposer = createLlmProposer({ model: 'm', chat });
    const out = await proposer(INPUT);
    expect(out.map((p) => p.id)).toEqual(['P-1']);
  });

  it('跨轮去重：重复项不算新增 ⇒ 提前收敛', async () => {
    let calls = 0;
    const chat: AdversarialChat = async () => {
      calls++;
      // 第 2 轮起只重复第 1 轮的内容 ⇒ 无新增 ⇒ 停止
      return arr([{ id: 'P-1', target: 'C-1', steps: [], expectation: 'e1' }]);
    };
    const out = await createLlmProposer({ model: 'm', chat, maxCalls: 5 })(
      INPUT
    );
    expect(out.length).toBe(1);
    expect(calls).toBe(2); // 第 1 轮新增 → 第 2 轮无新增 → 收敛
  });

  it('调用上限：每轮都有新增 ⇒ 恰好停在 maxCalls', async () => {
    let calls = 0;
    const chat: AdversarialChat = async () => {
      calls++;
      return arr([
        {
          id: `P-${calls}`,
          target: 'C-3',
          steps: [],
          expectation: `e${calls}`,
        },
      ]);
    };
    const out = await createLlmProposer({ model: 'm', chat, maxCalls: 3 })(
      INPUT
    );
    expect(calls).toBe(3);
    expect(out.length).toBe(3);
  });

  it('解析失败 ⇒ 视为无产出（不抛错、不臆造）', async () => {
    const chat: AdversarialChat = async () => '抱歉，我无法完成。';
    const out = await createLlmProposer({ model: 'm', chat })(INPUT);
    expect(out).toEqual([]);
  });

  it('调用抛错（超时/网络） ⇒ 如实停止并保留已产出（不静默伪造）', async () => {
    let calls = 0;
    const chat: AdversarialChat = async () => {
      calls++;
      if (calls === 1) {
        return arr([
          { id: 'P-1', target: 'C-1', steps: [], expectation: 'e1' },
        ]);
      }
      throw new Error('aborted');
    };
    const out = await createLlmProposer({ model: 'm', chat, maxCalls: 5 })(
      INPUT
    );
    expect(out.map((p) => p.id)).toEqual(['P-1']);
    expect(calls).toBe(2);
  });
});

describe('extractJsonArray 截断容错（e2e 实证：max_tokens 截断 ⇒ 数组不闭合）', () => {
  it('截断在最后一个完整对象之后 ⇒ 保留已完成对象（不臆造、不补字段）', () => {
    const truncated =
      '[{"id":"P-1","target":"C-1","steps":[],"expectation":"e1"},' +
      '{"id":"P-2","target":"C-3","steps":[],"expectation":"e2"},' +
      '{"id":"P-3","target":"C-5","steps":["半截';
    const arr = extractJsonArray(truncated) as Array<{ id: string }>;
    expect(arr.map((x) => x.id)).toEqual(['P-1', 'P-2']);
  });

  it('没有完整对象可保留 ⇒ null', () => {
    expect(extractJsonArray('[{"id":"P-1","tar')).toBeNull();
  });
});

describe('createLlmProposer：maxTokens 透传（e2e 实证的修复）', () => {
  it('显式传入 maxTokens ⇒ 原样透传给 chat（避免供应商默认 4096 截断）', async () => {
    const seen: number[] = [];
    const chat: AdversarialChat = async ({ maxTokens }) => {
      seen.push(maxTokens);
      return '[]';
    };
    await createLlmProposer({ model: 'm', chat, maxTokens: 1234 })(INPUT);
    expect(seen).toEqual([1234]);
  });
});
