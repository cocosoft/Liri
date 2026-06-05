/**
 * AWS Bedrock Converse API 传输实现
 * 对标 Hermes agent/transports/bedrock.py
 *
 * 格式: AWS Bedrock Converse API
 */
import { BaseTransport } from './BaseTransport';
import type {
  NormalizedResponse,
  NormalizedToolCall,
  TransportRequestParams,
} from './types';

export class BedrockTransport extends BaseTransport {
  readonly provider = 'bedrock';

  readonly supportedModels = [
    'anthropic.claude-',
    'amazon.nova-',
  ];

  convertMessages(
    messages: Array<{ role: string; content: string | null }>
  ): Array<{ role: string; content: Array<{ text: string }> }> {
    return messages
      .filter((m) => m.role !== 'system' && m.content !== null)
      .map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: [{ text: m.content! }],
      }));
  }

  convertTools(
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    }>
  ): Array<{
    toolSpec: {
      name: string;
      description: string;
      inputSchema: { json: Record<string, unknown> };
    };
  }> {
    return tools.map((t) => ({
      toolSpec: {
        name: t.name,
        description: t.description,
        inputSchema: { json: t.parameters },
      },
    }));
  }

  buildRequest(params: TransportRequestParams): Record<string, unknown> {
    const messages = this.convertMessages(params.messages);
    const tools = params.tools ? this.convertTools(params.tools) : undefined;

    const request: Record<string, unknown> = {
      messages,
      inferenceConfig: {
        maxTokens: params.maxTokens ?? 4096,
        temperature: params.temperature ?? 1.0,
      },
    };

    if (params.systemPrompt) {
      request.system = [{ text: params.systemPrompt }];
    }

    if (tools && tools.length > 0) {
      request.toolConfig = {
        tools,
      };
    }

    if (params.stream) {
      request.inferenceConfig = {
        ...(request.inferenceConfig as Record<string, unknown>),
        stream: true,
      };
    }

    return request;
  }

  normalizeResponse(raw: any): NormalizedResponse {
    const output = raw.output ?? {};
    const message = output.message ?? {};
    const contentBlocks = message.content ?? [];
    const usage = raw.usage ?? {};

    let textContent: string | null = null;
    const toolCalls: NormalizedToolCall[] = [];

    for (const block of contentBlocks) {
      if (block.text) {
        textContent = (textContent || '') + block.text;
      } else if (block.toolUse) {
        toolCalls.push({
          id: block.toolUse.toolUseId ?? '',
          name: block.toolUse.name ?? '',
          arguments:
            typeof block.toolUse.input === 'object'
              ? JSON.stringify(block.toolUse.input)
              : String(block.toolUse.input ?? '{}'),
        });
      }
    }

    return {
      content: textContent,
      toolCalls,
      usage: {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        totalTokens: (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      },
      reasoning: null,
      finishReason: raw.stopReason ?? 'end_turn',
      model: raw.model ?? '',
      id: raw.messageId ?? raw.ResponseMetadata?.RequestId ?? '',
    };
  }

  override mapFinishReason(rawReason: string): string {
    const reasonMap: Record<string, string> = {
      end_turn: 'stop',
      max_tokens: 'length',
      tool_use: 'tool_calls',
      content_filtered: 'content_filter',
      stop_sequence: 'stop',
    };
    return reasonMap[rawReason] || rawReason;
  }
}
