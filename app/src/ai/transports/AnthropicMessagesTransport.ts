/**
 * Messages API 传输实现（协议名，非供应商绑定）
 *
 * 将内部消息/工具格式转换为 Anthropic Messages API 格式。
 * 该协议同样被其他服务采用（如 Amazon Bedrock Converse API 等），
 * 因此以协议命名而非供应商命名。
 *
 * 参考: hermes agent/transports/anthropic.py
 */

import { BaseTransport } from './BaseTransport';
import { CACHE_BOUNDARY } from '@modules/constants/systemPromptSections';
import {
  DEFAULT_CACHE_CONFIG,
  STRATEGY_SPEC,
  assertBreakpointInvariants,
  calculateBreakpoints,
} from '../clients/PromptCacheConfig';
import type { PromptCacheConfig } from '../clients/PromptCacheConfig';
import type {
  NormalizedResponse,
  NormalizedToolCall,
  NormalizedUsage,
  TransportRequestParams,
} from './types';

interface MessagesTextBlock {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral' };
}

interface MessagesToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface MessagesToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  cache_control?: { type: 'ephemeral' };
}

type MessagesContentBlock =
  | MessagesTextBlock
  | MessagesToolUseBlock
  | MessagesToolResultBlock;

interface MessagesAPIMessage {
  role: 'user' | 'assistant';
  content: MessagesContentBlock[];
}

interface MessagesAPIToolDef {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
  cache_control?: { type: 'ephemeral' };
}

export class MessagesApiTransport extends BaseTransport {
  readonly provider = 'messages_api';

  /**
   * 兼容 Messages API 协议格式的模型。
   * 不限于 Anthropic —— 任何实现同格式的 provider 均可使用。
   */
  readonly supportedModels = ['*'];

  /** 是否启用 prompt caching */
  enableCaching = true;

  convertMessages(
    messages: Array<{
      role: string;
      content: string | null;
      tool_calls?: Array<Record<string, unknown>>;
      tool_call_id?: string;
    }>
  ): MessagesAPIMessage[] {
    const result: MessagesAPIMessage[] = [];

    // N-1 修复（2026-09-24）：`cache_control` **不得随会话历史线性增长**。
    //
    // 修复前每个 `tool_result` 块都注入断点 ⇒ 断点数 ≈ `#tool_result + 2`（另含 tools 末个与
    // system 稳定块），超过本仓自述的 Anthropic 硬上限 4（`ai/clients/PromptCacheConfig.ts:9`）。
    //
    // O2-3 接线（2026-09-24 晚，用户裁定"启用编排层"）：断点的**位置与预算不再由本文件决定**，
    // 统一收敛到 `PromptCacheConfig.calculateBreakpoints()`（末尾锚定 + 预算 + 不变量断言）
    // —— 见本类 `applyMessageBreakpoints()`。此处只负责按输入构造块。

    for (let i = 0; i < messages.length; i++) {
      const m = messages[i]!;
      const blocks: MessagesContentBlock[] = [];

      if (m.role === 'system') {
        continue; // 由 buildRequest 处理为顶层 system 参数
      }

      if (m.role === 'user') {
        blocks.push({ type: 'text', text: m.content ?? '' });
      } else if (m.role === 'assistant') {
        if (m.content) {
          blocks.push({ type: 'text', text: m.content });
        }
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            const fn =
              (tc.function as Record<string, unknown> | undefined) || tc;
            blocks.push({
              type: 'tool_use',
              id:
                (tc.id as string) ||
                `tc_${Math.random().toString(36).slice(2)}`,
              name: (fn.name as string) || '',
              input: (typeof fn.arguments === 'string'
                ? JSON.parse(fn.arguments)
                : fn.arguments || {}) as Record<string, unknown>,
            });
          }
        }
      } else if (m.role === 'tool') {
        blocks.push({
          type: 'tool_result',
          tool_use_id: m.tool_call_id || '',
          content: m.content ?? '',
        });
      }

      if (blocks.length > 0) {
        const role: 'user' | 'assistant' =
          m.role === 'tool' || m.role === 'user' ? 'user' : 'assistant';
        result.push({ role, content: blocks });
      }
    }

    if (this.cachingEnabled) {
      this.applyMessageBreakpoints(result);
    }

    return result;
  }

  /**
   * 编排配置（唯一事实来源 = `PromptCacheConfig`；transport 不再自行决定断点位置）。
   * 与 `enableCaching` 同惯例设为可变字段，便于按部署 / 测试切换策略。
   */
  cacheConfig: PromptCacheConfig = DEFAULT_CACHE_CONFIG;

  /** 缓存是否生效（总开关 `enableCaching` × 策略非 `none` 的双重门） */
  private get cachingEnabled(): boolean {
    return this.enableCaching && this.cacheConfig.strategy !== 'none';
  }

  /**
   * 编排 message 层断点：**位置由 `calculateBreakpoints()` 决定**（末尾锚定 —— 自最后一条
   * 消息往前每步长一条，至预算用尽），本方法只负责"落到该消息的哪个块"。
   *
   * 为什么必须末尾锚定：Anthropic 对多轮会话的推荐是断点覆盖**缓存前缀的末尾**；而原
   * `calculateBreakpoints` 自 `i=0` 每 N 条放置，长会话下末尾无断点（实测转换后 61 条消息
   * 时落在 `[2,5]`）⇒ 最后一段永不进缓存，比不接线更差。
   *
   * 块类型限制：只落在 `text` / `tool_result` 上 —— `tool_use` 块在本文件未声明
   * `cache_control` 字段，且"`tool_use` 是否接受 `cache_control`"未经官方确认（不臆断）
   * ⇒ 在该消息内自后往前找最近的可加块；找不到则跳过该断点（不静默改语义）。
   */
  private applyMessageBreakpoints(result: MessagesAPIMessage[]): void {
    const breakpoints = calculateBreakpoints(result.length, this.cacheConfig);
    assertBreakpointInvariants(breakpoints, this.cacheConfig.maxBreakpoints);
    for (const bp of breakpoints) {
      if (bp.type !== 'message') continue;
      const blocks = result[bp.index]?.content;
      if (!blocks) continue;
      for (let i = blocks.length - 1; i >= 0; i--) {
        const block = blocks[i]!;
        if (block.type === 'text' || block.type === 'tool_result') {
          block.cache_control = { type: 'ephemeral' };
          break;
        }
      }
    }
  }

  convertTools(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>
  ): MessagesAPIToolDef[] {
    return tools.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: 'object',
        properties: (t.parameters.properties as Record<string, unknown>) || {},
        required: (t.parameters.required as string[]) || [],
      },
      ...(this.cachingEnabled &&
      STRATEGY_SPEC[this.cacheConfig.strategy].placesToolsBreakpoint &&
      i === tools.length - 1
        ? { cache_control: { type: 'ephemeral' as const } }
        : {}),
    }));
  }

  buildRequest(params: TransportRequestParams): Record<string, unknown> {
    const messages = this.convertMessages(params.messages);
    const tools = params.tools?.length
      ? this.convertTools(params.tools)
      : undefined;

    // P2（提示词分层治理）：system 多块 cache_control 拆分。
    // 含 CACHE_BOUNDARY 时拆两块：[稳定前缀(cache_control)] + [动态区(无 cache)]——
    // 每轮变化的动态段（goal/memory/rules 等）不再让整个 system 缓存块失效；
    // 不含 boundary 或未启用缓存时保持原单块行为。
    const systemMsg = (
      params.messages as Array<{ role: string; content: string | null }>
    )
      .filter((m) => m.role === 'system' && m.content)
      .flatMap((m) => {
        const text = m.content!;
        const boundaryIdx = this.cachingEnabled
          ? text.indexOf(CACHE_BOUNDARY)
          : -1;
        if (boundaryIdx < 0) {
          return [
            {
              type: 'text',
              text,
              ...(this.cachingEnabled
                ? { cache_control: { type: 'ephemeral' as const } }
                : {}),
            },
          ];
        }
        const stable = text.slice(0, boundaryIdx).replace(/\s+$/, '');
        const dynamic = text
          .slice(boundaryIdx + CACHE_BOUNDARY.length)
          .replace(/^\s+/, '');
        const blocks: Array<Record<string, unknown>> = [];
        if (stable) {
          blocks.push({
            type: 'text',
            text: stable,
            cache_control: { type: 'ephemeral' as const },
          });
        }
        if (dynamic) {
          blocks.push({ type: 'text', text: dynamic });
        }
        return blocks;
      });

    const body: Record<string, unknown> = {
      model: params.model,
      max_tokens: params.maxTokens ?? 4096,
      messages,
    };

    if (systemMsg.length > 0) {
      body.system = systemMsg;
    }

    if (tools) {
      body.tools = tools;
    }

    // N-55 修复（2026-09-24）：原条件为 `> 0` ⇒ `temperature: 0`（要求确定性输出）被**静默丢弃**、
    // 实际按 API 默认 1.0 处理。改为仅判 `undefined`（不传 = 用 API 默认；传 0 = 真的是 0）。
    if (params.temperature !== undefined) {
      body.temperature = params.temperature;
    }

    if (params.stopSequences?.length) {
      body.stop_sequences = params.stopSequences;
    }

    // N-55 修复（2026-09-24）：`stream` 此前**从未下发** ⇒ Messages API 默认 `stream:false`
    // 返回**非流式 JSON**，而 AnthropicProvider.chatStreamInternal 按 **SSE** 逐行解析
    // ⇒ 流式链路拿不到任何事件。同族 4 处实现早已消费该字段（BedrockTransport /
    // ChatCompletionsTransport / OllamaTransport / TransportProviderAdapter），此处对齐。
    if (params.stream) {
      body.stream = true;
    }

    return body;
  }

  normalizeResponse(raw: unknown): NormalizedResponse {
    const r = raw as Record<string, unknown>;
    const content = (r.content as Array<Record<string, unknown>>) || [];
    const textBlocks = content.filter((b) => b.type === 'text');
    const toolUseBlocks = content.filter((b) => b.type === 'tool_use');

    const text = textBlocks.map((b) => b.text as string).join('\n');
    const toolCalls: NormalizedToolCall[] = toolUseBlocks.map((b) => ({
      id: b.id as string,
      name: b.name as string,
      arguments: JSON.stringify(b.input),
    }));

    const usageData = (r.usage || {}) as Record<string, number>;

    const usage: NormalizedUsage = {
      inputTokens: usageData.input_tokens ?? 0,
      outputTokens: usageData.output_tokens ?? 0,
      totalTokens:
        (usageData.input_tokens ?? 0) + (usageData.output_tokens ?? 0),
      cacheReadTokens: usageData.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usageData.cache_creation_input_tokens ?? 0,
    };

    return {
      id: (r.id as string) || '',
      model: r.model as string,
      finishReason: (r.stop_reason as string) || 'stop',
      content: text || null,
      toolCalls: toolCalls,
      reasoning: null,
      usage,
      raw: r,
    };
  }

  override extractCacheStats(raw: unknown): NormalizedUsage | null {
    const r = raw as Record<string, unknown>;
    const usageData = r.usage as Record<string, number> | undefined;
    if (
      usageData?.cache_read_input_tokens ||
      usageData?.cache_creation_input_tokens
    ) {
      return {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheReadTokens: usageData.cache_read_input_tokens || 0,
        cacheCreationTokens: usageData.cache_creation_input_tokens || 0,
      };
    }
    return null;
  }

  override mapFinishReason(
    rawStopReason: string,
    hasToolCalls: boolean
  ): string {
    // 一期 O1-4（2026-09-24「会话暴露问题分析与优化方案」§五）：**截断信号优先** ——
    // `hasToolCalls` 不得覆盖 provider 的真实结束原因。原实现首行即
    // `if (hasToolCalls) return 'tool_calls'`，按定义把 `max_tokens` 吃掉；而"被 max_tokens
    // 截断且只吐出半个 tool_calls"正是最常见的截断形态（与主循环 E1 同族：主循环已在
    // `ReActToolLoop.reason()` 修好，此处是该缺陷在传输层的残留）。
    if (rawStopReason === 'max_tokens' || rawStopReason === 'length') {
      return 'length';
    }
    if (hasToolCalls) return 'tool_calls';
    switch (rawStopReason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}

/** @deprecated 使用 MessagesApiTransport */
export { MessagesApiTransport as AnthropicMessagesTransport };
