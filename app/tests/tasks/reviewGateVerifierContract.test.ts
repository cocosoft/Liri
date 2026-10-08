// MIT License
// Copyright (c) 2026 190615273@qq.com
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

/**
 * `ReviewGate` → `VerifierAgent` **证据通道契约**守卫（2026-10-08 真机取证定位）。
 *
 * 缺陷：`VerifierAgent` 的验证提示词**只读 `input.toolResults`**（全文 0 处引用
 * `input.messages`；规范调用方 `TAORLoop` 正把上轮工具结果填进 `toolResults`），
 * 而 `ReviewGate.reviewStep` 原先恒传 **`toolResults: []`**、证据却放在 `messages` 里
 * ⇒ 验证器收到 "(无工具调用)" ⇒ 叠加骨架规则「无法判定 ⇒ `passed:false`」
 * ⇒ `checkPassRate` 恒 0 ⇒ **恒 REJECT**（实测历史 35/35 样本 0 通过；
 * 模型自述"本轮不存在任何工具调用结果，无法证明…"）。
 *
 * 本守卫：以探测用 verifier **记录** `verify()` 的入参，断言
 * ① `toolResults` 非空；② 其中**确实携带**本步骤的执行证据（`step.result`）；③ 验收标准骨架已注入。
 */
import { describe, expect, it } from 'bun:test';
import {
  DefaultReviewGate,
  type ReviewGateContext,
} from '../../src/tasks/review/ReviewGate';
import type { AgentIsolation } from '@modules/agent';

const EVIDENCE_TOKEN = 'EVIDENCE_TOKEN_9f3c';

/** 探测用 verifier：记录入参并直接放行（本测试只关心**契约**，不关心判定） */
class RecordingVerifier {
  lastInput: unknown = null;
  resetCalls = 0;

  reset(): void {
    this.resetCalls++;
  }

  async verify(input: unknown): Promise<{
    passed: boolean;
    confidence: number;
    verdict: 'APPROVE';
  }> {
    this.lastInput = input;
    return { passed: true, confidence: 0.9, verdict: 'APPROVE' };
  }
}

describe('ReviewGate → VerifierAgent 证据通道契约', () => {
  it('reviewStep 必须把步骤执行证据放进 toolResults（验证器唯一读取的字段）', async () => {
    const gate = new DefaultReviewGate({ enableMechanicalVerify: false });
    const verifier = new RecordingVerifier();
    const ctx = {
      taskId: 'task-contract-1',
      planId: 'plan-contract-1',
      step: {
        id: 'step-1',
        description: '创建文件 f.txt 并写入 v',
        acceptanceCriteria: 'file_read 读取 f.txt 返回内容为 v',
        result: `[TAORLoop] turns=1\n[tool] {"data":"${EVIDENCE_TOKEN}"}`,
        status: 'completed',
      },
      isolation: {
        abortController: new AbortController(),
      } as unknown as AgentIsolation,
      executor: async () =>
        '{"pass":true,"score":90,"issues":[],"summary":"ok"}',
      verifier,
    } as unknown as ReviewGateContext;

    await gate.reviewStep(ctx);

    const input = verifier.lastInput as {
      toolResults?: Array<{ toolName?: string; result?: unknown }>;
      successCriteria?: { items: unknown[] };
    } | null;

    expect(input).not.toBeNull();
    // ① 证据通道非空（原缺陷：恒为 []）
    expect(Array.isArray(input?.toolResults)).toBe(true);
    expect(input?.toolResults?.length ?? 0).toBeGreaterThan(0);
    // ② 证据确实携带本步骤产出（而非空壳）
    expect(JSON.stringify(input?.toolResults)).toContain(EVIDENCE_TOKEN);
    // ③ 验收标准骨架已注入（验证器据此产出 checks[]）
    expect(input?.successCriteria?.items.length ?? 0).toBeGreaterThan(0);
    // ④ 每次审查独立计数（与 TAORLoop 在 run 起点 reset 同口径）
    expect(verifier.resetCalls).toBe(1);
  });
});
