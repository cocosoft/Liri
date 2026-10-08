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
 * 对抗 Agent 形态 A —— **LLM 提案器适配器**（通道口径见 `.trae/specs/adversarial-agent-form-a.md` §5.2）
 *
 * ## 通道（裁定：**采用 `@modules/ai` 既有入口**）
 *
 * **否决**"沙箱后端 HTTP chat"：那会让攻击者 = 被测应用自身（红队独立性丧失），且必须把**已声明防线清单**
 * 喂给**被测者**（审计信息回灌）。
 * ⇒ 本适配器经 `@modules/ai` 既有入口取模型：`syncDBProvidersToRegistry()` + `aiService.generate(...)`
 * （`evals` 与 `ai` **同为 app 层** ⇒ 依赖合法，R00-001）。**`@modules/ai` 以动态 `import()` 引入**
 * ⇒ 本模块**不把 AI 拉进 harness 的静态依赖图**。
 *
 * ## 边界（CS03 / CS04）
 *
 * - **只提案、不裁决**：产出 `AdversarialProposal[]`，交给 `adversarialAgent.ts` 做**确定性裁决**。
 * - **不参与判据/退出码**：调用失败、超时、产出非法 JSON ⇒ **如实降级**（返回空/部分），**不臆造**。
 * - **模型名显式传入**（`model` 必填；model-usage 规则：不得硬编码默认模型）。
 * - **调用有界**：`maxCalls`（默认 5）+ `timeoutMs`（默认 30s，经 `AbortSignal` 真正中断请求）。
 */

import {
  parseAdversarialProposals,
  type AdversarialProposal,
  type AdversarialProposer,
  type AdversarialProposerInput,
} from './adversarialAgent.js';
import { getLogger } from '@modules/monitoring';

const logger = getLogger('evals:adversarial-proposer');

/** 一次性对话调用（**注入以便单测零额度**；缺省实现见 {@link createAiServiceChat}） */
export type AdversarialChat = (args: {
  model: string;
  prompt: string;
  timeoutMs: number;
  maxTokens: number;
}) => Promise<string>;

/**
 * 提案器诊断（**D-244①，2026-10-07**）—— 经 {@link LlmProposerOptions.onDiagnostics} 回传。
 *
 * **为什么需要**：真机实跑发现解析失败**只留一条 warn 日志**，而 CLI 汇总行仍打印"提案 30 条"
 * ⇒ 使用者**看不出其中若干轮是空的**（静默丢轮，覆盖率被高估）。本结构把"空轮"抬到可见面。
 *
 * ⚠️ **不改变** `AdversarialProposer` 接口（仍是 `=> Promise<AdversarialProposal[]>`）⇒
 * 注入式离线提案路径（`--adversarial-proposals`）与既有单测**零改动**。
 */
export interface ProposerDiagnostics {
  /** 实际发起的轮数 */
  rounds: number;
  /** 有产出的轮数 */
  productiveRounds: number;
  /** 空轮数（= `rounds − productiveRounds`） */
  emptyRounds: number;
  /** 解析失败**分类**：空输出 vs 有输出但不可解析（此前合并计数 ⇒ 无法归因） */
  parseFailures: { emptyContent: number; unparsable: number };
  /**
   * 停止原因。
   *
   * ⚠️ **D-247（2026-10-08）**：`'max_calls'` 现在**亦涵盖**"空轮重试耗尽全部轮次"
   * （此前空轮会立即终止并**误报** `'no_new_proposals'`）；`'no_new_proposals'` 现仅表示
   * **解析成功但确无新提案**（真收敛）。
   */
  stoppedBy: 'max_calls' | 'no_new_proposals' | 'chat_failed';
  /** 最终提案数 */
  proposals: number;
}

/** 适配器选项 */
export interface LlmProposerOptions {
  /** 攻击者模型名（**必填**；不得硬编码默认值 —— model-usage 规则） */
  model: string;
  /** 调用上限（spec D4 建议值 5） */
  maxCalls?: number;
  /** 单次超时（spec D4 建议值 30000ms） */
  timeoutMs?: number;
  /**
   * 单次最大输出 token。
   *
   * ⚠️ **e2e 实证（2026-10-04）**：不显式给值时，部分供应商默认 **4096** ⇒ 模型把预算全耗在推理上，
   * 返回 `finish_reason=max_tokens` 且 **`content` 为空**（实测空内容 + 截断 JSON）⇒ 提案 0 条。
   * 故本适配器**显式给值**（默认见 {@link DEFAULT_MAX_TOKENS}），并容忍 JSON 被截断（见 {@link extractJsonArray}）。
   */
  maxTokens?: number;
  /** 注入式对话实现（缺省 = 经 `@modules/ai` 既有入口） */
  chat?: AdversarialChat;
  /** 诊断回传（D-244①；可选 —— 不传则仅走日志，行为不变） */
  onDiagnostics?: (d: ProposerDiagnostics) => void;
}

export const DEFAULT_MAX_CALLS = 5;
/**
 * 单次调用超时（**R-1 调优**，2026-10-07 真机实测）。
 *
 * 原值 `30000`ms 在实测下**必然截断**：`deepseek-v4-flash` 产出 12 条提案耗时 **34.5s**（> 30s）。
 * 现取 `60000`ms —— 对**推荐的非思考型快模型**留约 1.7× 余量。
 * ⚠️ **思考型（thinking）模型须显式上调**：`deepseek-v4-pro` 实测 **127s** ⇒
 * 用 `--adversarial-timeout-ms=180000`（`AbortSignal` 会真正中断，不会无限挂起）。
 */
export const DEFAULT_TIMEOUT_MS = 60_000;
/**
 * 单次最大输出 token（**R-1 调优**，2026-10-07 真机实测）。
 *
 * 原值 `8192` 会让快模型也**推理耗尽**：`deepseek-v4-flash` @8192 ⇒ `finish_reason=length`
 * + `content=""` ⇒ **提案 0 条**；同提示词同目标闭集下 @16384 ⇒ **12 条**。
 * ⇒ 上调整为 16384（仅**抬高上限**，非强制消耗；JSON 截断仍由 {@link extractJsonArray} 兜底）。
 */
export const DEFAULT_MAX_TOKENS = 16_384;

/**
 * 红队系统提示词（**安全面**：只给"已声明防线 + 目标闭集"，**不含隐藏期望值/参考解** —— spec §8 风险 3）。
 */
export const RED_TEAM_SYSTEM_PROMPT = [
  '你是被测系统的**红队审计者**。',
  '目标：在**不修改被测代码**的前提下，找出可能让评测判据被"绕过"的手法（作弊向量）。',
  '规则：',
  '1) 只能针对下方给出的**目标 id** 提案（闭集）；其它目标会被记为"无法机械判定"。',
  '2) 不要尝试真正执行攻击，只需给出**可被机械复核**的提案。',
  '3) 严格输出 JSON 数组，元素形如 {"id":"P-1","target":"C-1","steps":["..."],"expectation":"..."}；',
  '   不要输出任何解释、Markdown 代码围栏或多余文字。',
].join('\n');

/** 组装单轮红队提示词（含目标闭集 + 已提出的提案，避免重复） */
export function buildRedTeamPrompt(
  input: AdversarialProposerInput,
  already: readonly AdversarialProposal[]
): string {
  const targets = input.targets.map((t) => `- ${t.id}：${t.title}`).join('\n');
  const seen = already.length
    ? already
        .map((p) => `- ${p.target}（${p.expectation || '无说明'}）`)
        .join('\n')
    : '（无）';
  return [
    '## 已声明防线（被测系统声明的屏蔽路径）',
    input.declaredShields.length ? input.declaredShields.join('\n') : '（无）',
    '',
    '## 可机械裁决的目标闭集（target 只能取以下 id）',
    targets,
    '',
    '## 你已提出的提案（请勿重复）',
    seen,
    '',
    '请输出**新的**提案 JSON 数组（无新提案则输出 []）。',
  ].join('\n');
}

/**
 * 从模型输出中抽取首个 JSON 数组（容忍 ```json 围栏与前后噪声）。
 *
 * **截断容错（e2e 实证）**：模型可能因 `max_tokens` 截断 ⇒ 数组不闭合。
 * 此时取「最后一个**完整顶层对象**」处收尾并补 `]` ⇒ **只保留模型已完整产出的对象**
 * （不臆造、不补字段；结构非法项仍由 `parseAdversarialProposals` 丢弃）。仍不可解析 ⇒ `null`。
 */
export function extractJsonArray(text: string): unknown {
  const noFence = text.replace(/```(?:json)?/gi, '');
  const start = noFence.indexOf('[');
  if (start === -1) return null;
  const end = noFence.lastIndexOf(']');
  if (end > start) {
    try {
      return JSON.parse(noFence.slice(start, end + 1));
    } catch {
      // @ignore-catch — 整段解析失败不中断：落入下方"截断容错"再试一次
    }
  }
  const body = noFence.slice(start);
  let depth = 0;
  let inStr = false;
  let esc = false;
  let lastComplete = -1;
  for (let i = 1; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) lastComplete = i;
    }
  }
  if (lastComplete <= 0) return null;
  try {
    return JSON.parse(`${body.slice(0, lastComplete + 1)}]`);
  } catch {
    // @ignore-catch — 无法恢复 ⇒ 由返回值 null 表达（不臆造）
    return null;
  }
}

/**
 * `@modules/ai` 既有入口的默认对话实现（**动态 import** —— 不进入 harness 静态依赖图）。
 *
 * 顺序：DB → registry 同步（使 `getClientForModel` 可解析）⇒ `aiService.generate(...)`，超时经 `AbortSignal`。
 */
export function createAiServiceChat(): AdversarialChat {
  return async ({ model, prompt, timeoutMs, maxTokens }) => {
    const ai = await import('@modules/ai');
    await ai.syncDBProvidersToRegistry();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await ai.aiService.generate(
        [{ role: ai.AIMessageRole.USER, content: prompt }],
        model,
        { signal: controller.signal, max_tokens: maxTokens }
      );
      const content = typeof res.content === 'string' ? res.content : '';
      if (content.length === 0) {
        // 空内容可见化（2026-10-04 e2e 实测）：仅 `chars=0` 无法区分"推理耗尽 token"与"通道异常"。
        // 记录 finish_reason / usage / 原始类型，供下次真机诊断（零行为变化，仅日志）。
        const finishReason = res.finish_reason ?? null;
        const truncated =
          finishReason === 'length' || finishReason === 'max_tokens';
        logger.warn('adversarial.proposer.chat_empty_content', {
          model,
          finishReason,
          usage: res.usage ?? null,
          contentType: typeof res.content,
          // D-244①（2026-10-07）：给出**可操作提示** —— "推理耗尽 token 预算"与"通道异常"
          // 的处理方式完全不同，仅凭 `chars=0` 无法判断该去调参还是查通道。
          hint: truncated
            ? `输出被 max_tokens 截断（当前 ${maxTokens}）⇒ 上调 --adversarial-max-tokens 或降低单轮提案数`
            : '非截断导致空内容 ⇒ 检查通道 / 提示词',
        });
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * 构造 LLM 提案器（**只提案**）。
 *
 * 有界：最多 `maxCalls` 轮；**解析成功但无新提案**即提前收敛；**解析失败/空输出** ⇒ 该轮视为
 * 无产出并**继续**消耗剩余轮次（**D-247，2026-10-08**：此前二者共用出口 ⇒ `max_tokens` 截断
 * 会直接终止整个相位；不抛、不臆造）。
 */
export function createLlmProposer(
  opts: LlmProposerOptions
): AdversarialProposer {
  const maxCalls = opts.maxCalls ?? DEFAULT_MAX_CALLS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const chat = opts.chat ?? createAiServiceChat();

  return async (input: AdversarialProposerInput) => {
    const proposals: AdversarialProposal[] = [];
    const seen = new Set<string>();
    // D-244①（2026-10-07）：**空轮可见化** —— 此前"该轮无产出"只在日志里，汇总行照旧打印
    // "提案 N 条" ⇒ 使用者看不出其中若干轮是空的（静默丢轮）。以下计数经 onDiagnostics 回传。
    let rounds = 0;
    let productiveRounds = 0;
    const parseFailures = { emptyContent: 0, unparsable: 0 };
    let stoppedBy: ProposerDiagnostics['stoppedBy'] = 'max_calls';
    for (let round = 0; round < maxCalls; round++) {
      rounds++;
      let text: string;
      try {
        text = await chat({
          model: opts.model,
          prompt: `${RED_TEAM_SYSTEM_PROMPT}\n\n${buildRedTeamPrompt(input, proposals)}`,
          timeoutMs,
          maxTokens,
        });
      } catch (e) {
        // 调用失败/超时 ⇒ **如实停止**（不静默伪造）；**原因落日志**（CS03-002：回退不得掩盖错误）
        logger.warn('adversarial.proposer.chat_failed', {
          round,
          model: opts.model,
          error: e instanceof Error ? e.message : String(e),
        });
        stoppedBy = 'chat_failed';
        break;
      }
      const raw = extractJsonArray(text);
      if (raw === null) {
        // D-244①：**空输出**与**有输出但不可解析**是两种不同成因，**分列计数**
        //（此前合并为一条 warn ⇒ 事后无法归因"是推理耗尽 token 还是格式错"）。
        const empty = text.trim().length === 0;
        if (empty) parseFailures.emptyContent++;
        else parseFailures.unparsable++;
        logger.warn('adversarial.proposer.parse_failed', {
          round,
          model: opts.model,
          chars: text.length,
          kind: empty ? 'empty_content' : 'unparsable',
        });
      }
      const { proposals: parsed } = parseAdversarialProposals(raw);
      let added = 0;
      for (const p of parsed) {
        const key = `${p.target}\u0000${p.expectation}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // D-244②（2026-10-07）：**由本适配器重新分配 id**。契约要求"本次运行内唯一"
        //（`AdversarialProposal.id`），而**模型自报的 id 不可控** —— 提示词示例是 `P-1`，
        // 每轮独立编号 ⇒ 跨轮重复（实测合并结果 `A-P-1`..`A-P-10` 各出现两次、缺 `A-P-17`，
        // 报告因此不可追溯）。⇒ 以**提案序号**整体重编号；**去重键不变**（target+expectation）。
        proposals.push({ ...p, id: `P-${proposals.length + 1}` });
        added++;
      }
      if (added > 0) productiveRounds++;
      if (added === 0) {
        // D-247（2026-10-08，方案①）：**空轮 ≠ 收敛** —— 二者此前共用同一出口
        //（`added === 0` 即 `break`），致 `max_tokens` 截断（⇒ 空输出）**直接终止整个相位**：
        // 实测 9 向量下产出 0 条，且 `--adversarial-max-calls` 的轮次预算只用掉 1 次。此处区分：
        //   · `raw === null`（解析失败 / 空输出）⇒ 该轮"**没有产出**"⇒ **继续**消耗剩余 maxCalls（可重试）；
        //   · `raw !== null` 但无新增 ⇒ 模型**确无新提案**（真收敛）⇒ 提前结束。
        // ⚠️ 代价（如实）：空轮重试会**多耗额度**（最坏 = maxCalls × maxTokens 输出）。
        if (raw === null) continue;
        stoppedBy = 'no_new_proposals';
        break;
      }
    }
    if (proposals.length === 0) {
      logger.warn('adversarial.proposer.empty', {
        model: opts.model,
        maxCalls,
        maxTokens,
      });
    }
    opts.onDiagnostics?.({
      rounds,
      productiveRounds,
      emptyRounds: rounds - productiveRounds,
      parseFailures,
      stoppedBy,
      proposals: proposals.length,
    });
    return proposals;
  };
}
