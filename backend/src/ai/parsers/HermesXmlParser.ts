/**
 * Hermes XML 格式工具调用解析器
 * 对标 Hermes hermes_parser.py（HermesToolCallParser）
 *
 * 格式: <tool_call>{"name": "func", "arguments": {...}}</tool_call>
 * 适用于: Hermes、Qwen 2.5、以及所有使用此标签格式的模型
 */
import { randomUUID } from 'node:crypto';
import { BaseParser } from './BaseParser';
import type { ParsedResult, ParsedToolCall } from './types';
import { emptyParsedResult, toolCallResult } from './types';

export class HermesXmlParser extends BaseParser {
  readonly name = 'hermes';

  readonly modelPatterns = ['hermes', 'qwen', 'qwen2.5', 'qwen-2.5'];

  private static readonly TOOL_CALL_PATTERN =
    /<tool_call>\s*(.*?)\s*<\/tool_call>|<tool_call>\s*(.*)/gs;

  override mayContainToolCalls(text: string): boolean {
    return text.includes('<tool_call>');
  }

  parse(text: string): ParsedResult {
    if (!this.mayContainToolCalls(text)) {
      return emptyParsedResult(text);
    }

    const toolCalls: ParsedToolCall[] = [];
    const matches = text.matchAll(HermesXmlParser.TOOL_CALL_PATTERN);

    for (const match of matches) {
      const rawJson = (match[1] || match[2] || '').trim();
      if (!rawJson) continue;

      try {
        const tcData = JSON.parse(rawJson);
        if (!tcData.name) continue;

        toolCalls.push({
          id: `call_${randomUUID().slice(0, 8)}`,
          name: tcData.name,
          arguments:
            typeof tcData.arguments === 'string'
              ? tcData.arguments
              : JSON.stringify(tcData.arguments ?? {}, null, 0),
        });
      } catch {
        continue;
      }
    }

    if (toolCalls.length === 0) {
      return emptyParsedResult(text);
    }

    const firstTagIndex = text.indexOf('<tool_call>');
    const content = text.slice(0, firstTagIndex).trim() || null;

    return toolCallResult(content, toolCalls);
  }
}
