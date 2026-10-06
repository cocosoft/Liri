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
 * U4 / D3（LLM 复核）：把既有 `VerifierAgent` 装配成 U4 的「可疑轮复核器」。
 *
 * 规格：`.trae/specs/online-quality-evaluation.md` §3 **D3**。设计要点与依据：
 *
 * 1. **复用而非新造判分器（CS01）**：直接复用 `VerifierAgent` —— 它已具备三态
 *    （`APPROVE`/`REJECT`/`ESCALATE`）、`checkPassRate`（客观项通过率）、`confidence`，
 *    以及 **13-P0-1 的 `failClosed`**（自身不可用/解析失败 ⇒ `ESCALATE` 不放行）。
 * 2. **模型只来自任务分工**：模型名由 `modelRouter.resolveRole('verifier')` 解析
 *    （= 设置里的"任务分工 → verifier"）；**未配置 ⇒ 本工厂返回 `null`**（评估器随即记
 *    `reviewSkipped:'no-model'`）。**绝不回退**到"随便挑一个模型"（`model-usage.md` 红线）。
 * 3. **语义切换**：注入 `reviewGuidelines` ⇒ `VerifierAgent` 的 system prompt 由
 *    "严格的代码审查员"变为"严格的**对抗评审员**"（`VerifierAgent.ts:347-356`），
 *    与本场景（评审"一轮已完成的答复"而非"代码 diff"）对齐。
 * 4. **每轮新建实例（关键，勿"优化"为复用）**：`VerifierAgent.cycleCount` 是**实例态**，
 *    `verify()` 在 `cycleCount >= maxCycles` 时**直接返回 `ESCALATE`**
 *    （`VerifierAgent.ts:315-327`）。空闲期一张 pass 要连评多轮 ⇒ 若复用同一实例，
 *    **从第 2 轮起全部被误判为"需人工介入"**。故这里每轮 `new VerifierAgent({ maxCycles: 1 })`。
 * 5. **输入最小化**：只喂该轮**正文摘录**（已在 `deriveTurnSignals` 截断到 4000 字符），
 *    **无正文 ⇒ 返回 `null`**（不臆断质量）。
 */

import { VerifierAgent } from '@modules/query';
import type { ChatMessage } from '@modules/ai';
import type { TurnQualityReview } from '@modules/evals';

/** 复核输入（与 `TurnQualityEvaluatorPorts['reviewTurn']` 的入参对齐） */
export interface TurnReviewInput {
  sessionId: string;
  turnNumber: number;
  /** 该轮助手正文摘录；缺省 = 无正文可评 */
  assistantText?: string;
}

/** 复核器签名（可直接作为 `TurnQualityEvaluatorPorts.reviewTurn` 注入） */
export type TurnReviewFn = (
  input: TurnReviewInput
) => Promise<TurnQualityReview | null>;

/** 装配依赖（全部由调用方注入 ⇒ 本模块不引 chat 内部状态、便于单测） */
export interface VerifierTurnReviewerDeps {
  /**
   * 取"复核用模型名"（= `modelRouter.resolveRole('verifier')` 的结果）。
   * 返回 `''` / 空 ⇒ 返回 `null`（不回退选模型）。
   */
  resolveVerifierModelName(): Promise<string> | string;
  /** 按模型名取**裸**流式客户端（chat 侧注入 `ChatOrchestratorHost.getClientForModel`） */
  getClientForModel(modelName: string): {
    chatStream(messages: ChatMessage[]): AsyncGenerator<unknown>;
  };
}

/**
 * 复核准则（注入后把 `VerifierAgent` 切到"对抗评审员"语义）。
 *
 * 明确"看不到执行细节时不得臆测 ⇒ 输出 ESCALATE"：把 `failClosed` 的精神延伸到**证据不足**，
 * 避免复核器凭想象打分（CS06：不臆断）。
 */
const REVIEW_GUIDELINES = [
  '审查对象：**一次已完成的助手回复正文**（不是代码 diff、不是工具结果）。',
  '审查维度：① 是否切题并正面回答了用户诉求；② 是否存在自相矛盾、明显事实错误、或承诺了却没做的事；',
  '③ 是否用"已完成/已修复"等断言掩盖并未真正执行的动作。',
  '判断**仅依据给出的回复正文**；看不到执行细节时**不得臆测**，证据不足应输出 ESCALATE。',
].join('\n');

/**
 * 创建「可疑轮复核器」。
 *
 * @returns `null` = **未配置 verifier 分工**（调用方据此记 `reviewSkipped:'no-model'`）。
 */
export async function createVerifierTurnReviewer(
  deps: VerifierTurnReviewerDeps
): Promise<TurnReviewFn | null> {
  const modelName = await deps.resolveVerifierModelName();
  if (!modelName) return null;
  const client = deps.getClientForModel(modelName);

  return async (input: TurnReviewInput): Promise<TurnQualityReview | null> => {
    const text = (input.assistantText ?? '').trim();
    if (!text) return null;

    // 见文件头第 4 条：每轮**新实例**（`cycleCount` 是实例态，复用会让后续轮次恒 ESCALATE）
    const agent = new VerifierAgent({ maxCycles: 1 });
    agent.setCallModel(async function* (messages, signal) {
      if (signal?.aborted) return;
      const chatMessages: ChatMessage[] = messages.map((m) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
      }));
      for await (const chunk of client.chatStream(chatMessages)) {
        if (typeof chunk === 'string') {
          if (chunk) yield { content: chunk };
          continue;
        }
        const content = (chunk as { content?: unknown } | null)?.content;
        if (typeof content === 'string' && content) yield { content };
      }
    });

    const controller = new AbortController();
    const result = await agent.verify(
      {
        messages: [{ role: 'assistant', content: text }],
        toolResults: [],
        turnCount: input.turnNumber,
        sessionId: input.sessionId,
        reviewGuidelines: REVIEW_GUIDELINES,
      },
      controller.signal
    );

    return {
      verdict: result.verdict,
      confidence: result.confidence,
      ...(typeof result.checkPassRate === 'number'
        ? { checkPassRate: result.checkPassRate }
        : {}),
      ...(result.feedback ? { reason: result.feedback.slice(0, 500) } : {}),
    };
  };
}
