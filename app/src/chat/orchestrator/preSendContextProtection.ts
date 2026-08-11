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
 * preSendContextProtection — 流式发送前的上下文保护辅助（streamMessageFlow 拆分）
 *
 * R04-001 治理：streamMessageFlow 超 800 行，将发送前保护/诊断日志/错误校准
 * 抽离至此。职责：
 *  1. logTokenSnapshot — 压缩前/压缩后 token 诊断日志
 *  2. applyPreSendProtection — 发送前估算截断 + 精确截断 + 工具预算检查
 *  3. logInferenceUsage — 推理完成"估算 vs 真实 usage"对比日志
 *  4. applyErrorCalibration — 400 context 超限错误 → 自动回写 DB 校准
 */

import { getLogger } from '@modules/monitoring';
import { estimateMessagesTokens } from '../../ai/tokenizer/TokenEstimator';
import { resolveMaxContextTokens } from '../services/ChatHelper';
import { truncateByPreciseTokens } from '../services/MessageContextPipeline';
import {
  parsePromptTokensFromError,
  parseContextLimitFromError,
  calibrateContextWindow,
} from '../../context/window/ContextWindowResolver';
import type { ChatOrchestratorHost } from './ChatOrchestrator.js';
import type { StreamMessageOptions } from '../types/message.js';
import type { ChatSession } from '../types/session.js';
import type { ToolDefinition } from '@modules/ai';

const logger = getLogger('chat:streamFlow');

/** 压缩前/压缩后 token 诊断日志（仅 info 级，前端日志面板按 streamMessage:token 过滤） */
export function logTokenSnapshot(
  label: string,
  sessionId: string,
  model: string,
  apiMessages: Record<string, unknown>[]
): void {
  logger.info(`streamMessage:token — ${label}`, {
    sessionId,
    model,
    messageCount: apiMessages.length,
    estimateTokens: estimateMessagesTokens(apiMessages),
  });
}

export interface PreSendProtectionParams {
  host: ChatOrchestratorHost;
  apiMessages: Record<string, unknown>[];
  toolDefinitions: ToolDefinition[];
  activeClient: { getProviderId(): string; getBaseUrl?(): string };
  options?: StreamMessageOptions;
  session: ChatSession;
}

/**
 * 发送前上下文保护：
 *  1. 估算截断（truncateApiMessages，以模型窗口为上限）
 *  2. llama.cpp 精确截断（/tokenize 真实计数，目标 = 窗口 × 0.6）
 *  3. 工具定义预算检查（tools schema 渲染进 prompt，小窗口超限时移除）
 * 返回是否因工具超预算而移除了工具定义。
 */
export async function applyPreSendProtection(
  params: PreSendProtectionParams
): Promise<boolean> {
  const { host, apiMessages, toolDefinitions, activeClient, options, session } =
    params;
  const sendCtxLimit = resolveMaxContextTokens(options?.model);
  let toolsCleared = false;

  // 1) 估算截断：以 resolveMaxContextTokens 为上限截断旧消息
  if (sendCtxLimit > 0) {
    await host.truncateApiMessages(
      apiMessages,
      sendCtxLimit,
      session.id,
      options?.maxTokens
    );
  }

  // 2) llama.cpp 精确截断：/tokenize 真实计数（估算低估根治）。
  //    只要 baseUrl 存在即执行，truncateByPreciseTokens 内部先探测 /tokenize 端点，
  //    远程 API 无该端点时自动跳过（一次探测请求，无副作用）。
  const baseUrl = (
    activeClient as unknown as { getBaseUrl?: () => string }
  ).getBaseUrl?.();
  logger.info('streamMessage:precise_truncate_check', {
    sessionId: session.id,
    model: options?.model ?? 'unknown',
    providerId: activeClient.getProviderId(),
    baseUrl: baseUrl ?? '',
  });
  if (baseUrl && sendCtxLimit > 0) {
    await truncateByPreciseTokens(
      apiMessages,
      baseUrl,
      Math.floor(sendCtxLimit * 0.6)
    );
  }

  // 3) 工具定义 token 预算检查（根治 15903 > 8192 的最终一环）：
  //    /tokenize 只统计 messages content，但发送请求还带 tools——llama.cpp 的 chat template
  //    会把工具 schema 渲染进 prompt（实测占 ~12K tokens），小窗口下是 context 爆炸真正主因。
  //    工具 JSON 用 /tokenize 精确计算（估算会低估，导致漏判不移除）。
  if (toolDefinitions.length > 0) {
    const toolsJson = JSON.stringify(toolDefinitions);
    let toolsTokens = estimateMessagesTokens([
      { role: 'system' as const, content: toolsJson },
    ]);
    const normBase = baseUrl?.replace(/\/v1\/?$/, '');
    if (normBase) {
      try {
        const res = await fetch(`${normBase}/tokenize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: toolsJson }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = (await res.json()) as { tokens?: unknown[] };
          if (Array.isArray(data.tokens)) toolsTokens = data.tokens.length;
        }
      } catch {
        // @ignore-catch: 精确计算失败保留估算值
      }
    }
    const msgTokens = estimateMessagesTokens(
      apiMessages as { role?: string; content?: string | unknown }[]
    );
    const budget = Math.floor(sendCtxLimit * 0.6);
    if (msgTokens + toolsTokens > budget) {
      logger.warn('streamMessage:tools — 工具定义超出上下文预算，发送时移除', {
        sessionId: session.id,
        model: options?.model ?? 'unknown',
        msgTokens,
        toolsTokens,
        budget,
        toolCount: toolDefinitions.length,
      });
      toolDefinitions.length = 0;
      toolsCleared = true;
    }
  }

  return toolsCleared;
}

/**
 * 推理完成诊断：发送前估算 vs 发送后 API 返回真实 usage（inputTokens/prompt_tokens 兼容）。
 * 闭环对比估算是否贴近真实，判断截断/压缩是否真正把输入压到窗口内。
 */
export function logInferenceUsage(
  sessionId: string,
  model: string,
  finalResponse: { usage?: Record<string, number> } | null,
  apiMessages: Record<string, unknown>[]
): void {
  const usageRec = finalResponse?.usage as Record<string, number> | undefined;
  const actualInputTokens =
    usageRec?.inputTokens ?? usageRec?.prompt_tokens ?? 0;
  const actualOutputTokens =
    usageRec?.outputTokens ?? usageRec?.completion_tokens ?? 0;
  const estimatedTokens = estimateMessagesTokens(apiMessages);
  logger.info('streamMessage:token — 推理完成（估算 vs 真实）', {
    sessionId,
    model,
    estimatedTokens,
    actualInputTokens,
    actualOutputTokens,
    diff: actualInputTokens - estimatedTokens,
    pctError:
      estimatedTokens > 0
        ? Math.round(
            ((actualInputTokens - estimatedTokens) / estimatedTokens) * 100
          )
        : 0,
  });
}

/**
 * 错误校准（400 context 超限时）：
 *  - 提取真实 n_prompt_tokens 与发送前估算对比（量化估算偏差）
 *  - 提取服务端真实 n_ctx 自动回写 DB（全 provider 通用，一次 400 后永久自校正）
 */
export async function applyErrorCalibration(
  genErr: unknown,
  apiMessages: Record<string, unknown>[],
  sessionId: string,
  model?: string
): Promise<void> {
  const errMsg = genErr instanceof Error ? genErr.message : String(genErr);
  const actualPromptTokens = parsePromptTokensFromError(errMsg);
  if (actualPromptTokens !== null) {
    const estimated = estimateMessagesTokens(apiMessages);
    logger.warn('streamMessage:token — 上下文溢出校准（真实 vs 估算）', {
      sessionId,
      actualPromptTokens,
      estimatedTokens: estimated,
      diff: actualPromptTokens - estimated,
      pctError:
        estimated > 0
          ? Math.round(((actualPromptTokens - estimated) / estimated) * 100)
          : 0,
    });
  }
  const ctxLimit = parseContextLimitFromError(errMsg);
  if (ctxLimit !== null && ctxLimit > 0 && model) {
    await calibrateContextWindow(model, ctxLimit);
  }
}
