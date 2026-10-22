/**
 * Google Gemini API 传输实现
 * 将 Gemini 的 native content/parts 格式归一化为 NormalizedResponse
 */
import { BaseTransport } from './BaseTransport';
import { randomIdSuffix } from '../../utils/common';
import type {
  NormalizedResponse,
  NormalizedToolCall,
  TransportRequestParams,
} from './types';

export class GeminiTransport extends BaseTransport {
  readonly provider = 'gemini';

  readonly supportedModels = ['*'];

  convertMessages(
    messages: Array<{ role: string; content: string | null }>
  ): Array<{ role: string; parts: Array<{ text: string }> }> {
    return messages
      .filter((m) => m.content !== null)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content! }],
      }));
  }

  convertTools(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>
  ): Array<{
    functionDeclarations: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>;
  }> {
    return [
      {
        functionDeclarations: tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      },
    ];
  }

  buildRequest(params: TransportRequestParams): Record<string, unknown> {
    const contents = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const request: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: params.maxTokens ?? 4096,
        temperature: params.temperature ?? 1.0,
        // 2026-10-23（`/effort` 第二步）：思考预算 → thinkingConfig.thinkingBudget。
        // 非 `enabled` ⇒ 不下发（走端点默认，行为零变更）。
        ...(params.thinking?.type === 'enabled'
          ? {
              thinkingConfig: {
                thinkingBudget: params.thinking.budgetTokens,
              },
            }
          : {}),
      },
    };

    if (params.systemPrompt) {
      request.systemInstruction = {
        parts: [{ text: params.systemPrompt }],
      };
    }

    if (tools && tools.length > 0) {
      request.tools = tools;
    }

    return request;
  }

  normalizeResponse(raw: unknown): NormalizedResponse {
    const r = raw as Record<string, unknown>;
    const candidate = (r.candidates as Array<Record<string, unknown>>)?.[0];
    const content = candidate?.content as Record<string, unknown> | undefined;
    const parts = (content?.parts ?? []) as Array<Record<string, unknown>>;

    let textContent: string | null = null;
    const toolCalls: NormalizedToolCall[] = [];
    let reasoning: string | null = null;

    for (const part of parts) {
      if (part.text) {
        textContent = (textContent || '') + part.text;
      } else if (part.functionCall) {
        const fc = part.functionCall as Record<string, unknown>;
        toolCalls.push({
          // G13（2026-10-11）：原为序号 `call_${toolCalls.length}` —— **同一执行**跨轮复用时
          // 会与上一轮 `call_0` 碰撞 ⇒ 结算可能错行。改用 crypto 强随机后缀（40 bit），
          // 与 `AnthropicMessagesTransport`/各 parser 的 id 熵口径一致。
          id: `call_${randomIdSuffix(10)}`,
          name: fc.name as string,
          arguments: JSON.stringify(fc.args ?? {}),
        });
      } else if (part.thought) {
        reasoning = (reasoning || '') + part.thought;
      }
    }

    const usageMetadata = (r.usageMetadata ?? {}) as Record<string, number>;

    return {
      content: textContent,
      toolCalls,
      usage: {
        inputTokens: usageMetadata.promptTokenCount ?? 0,
        outputTokens: usageMetadata.candidatesTokenCount ?? 0,
        cacheReadTokens: usageMetadata.cachedContentTokenCount ?? 0,
        cacheCreationTokens: 0,
        totalTokens: usageMetadata.totalTokenCount ?? 0,
      },
      reasoning,
      finishReason:
        ((candidate as Record<string, unknown>)?.finishReason as string) ??
        'STOP',
      model: (r.modelVersion as string) ?? '',
      id: (r.responseId as string) ?? '',
    };
  }

  override mapFinishReason(rawReason: string): string {
    const reasonMap: Record<string, string> = {
      STOP: 'stop',
      MAX_TOKENS: 'length',
      SAFETY: 'content_filter',
      RECITATION: 'content_filter',
    };
    return reasonMap[rawReason] || 'stop';
  }
}
