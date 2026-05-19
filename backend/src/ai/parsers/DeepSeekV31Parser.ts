/**
 * DeepSeek V3.1 工具调用解析器
 * 对标 Hermes deepseek_v3_1_parser.py（DeepSeekV31ToolCallParser）
 *
 * 格式: 使用 ǒ … ǒ 标记（JSON 包裹在特殊 Unicode 字符中）
 */
import { randomUUID } from 'node:crypto';
import { BaseParser } from './BaseParser';
import type { ParsedResult, ParsedToolCall } from './types';
import { emptyParsedResult, toolCallResult } from './types';

export class DeepSeekV31Parser extends BaseParser {
  readonly name = 'deepseek_v3_1';

  readonly modelPatterns = [
    'deepseek-reasoner',
    'deepseek-v3.1',
    'deepseek_r1',
  ];

  private static readonly START_TOKEN = 'ǒ';

  private static readonly TOOL_CALL_PATTERN = /ǒ(.*?)ǒ/gs;

  override mayContainToolCalls(text: string): boolean {
    return text.includes(DeepSeekV31Parser.START_TOKEN);
  }

  parse(text: string): ParsedResult {
    if (!this.mayContainToolCalls(text)) {
      return emptyParsedResult(text);
    }

    const toolCalls: ParsedToolCall[] = [];
    const matches = text.matchAll(DeepSeekV31Parser.TOOL_CALL_PATTERN);

    for (const match of matches) {
      const rawJson = (match[1] || '').trim();
      if (!rawJson) continue;

      try {
        const tcData: unknown = JSON.parse(rawJson);

        if (Array.isArray(tcData)) {
          for (const item of tcData) {
            if (item && typeof item === 'object' && 'name' in item) {
              const tc = item as { name: string; arguments?: unknown };
              toolCalls.push({
                id: `call_${randomUUID().slice(0, 8)}`,
                name: tc.name,
                arguments:
                  typeof tc.arguments === 'string'
                    ? tc.arguments
                    : JSON.stringify(tc.arguments ?? {}),
              });
            }
          }
        } else if (tcData && typeof tcData === 'object' && 'name' in tcData) {
          const tc = tcData as { name: string; arguments?: unknown };
          toolCalls.push({
            id: `call_${randomUUID().slice(0, 8)}`,
            name: tc.name,
            arguments:
              typeof tc.arguments === 'string'
                ? tc.arguments
                : JSON.stringify(tc.arguments ?? {}),
          });
        }
      } catch {
        continue;
      }
    }

    if (toolCalls.length === 0) {
      return emptyParsedResult(text);
    }

    const firstTagIndex = text.indexOf(DeepSeekV31Parser.START_TOKEN);
    const content = text.slice(0, firstTagIndex).trim() || null;

    return toolCallResult(content, toolCalls);
  }
}
