/**
 * DeepSeek V3 工具调用解析器
 * 对标 Hermes deepseek_v3_parser.py（DeepSeekV3ToolCallParser）
 *
 * 格式: 使用特殊 Unicode 标记
 *   <｜tool▁calls▁begin｜>
 *   <｜tool▁call▁begin｜>type<｜tool▁sep｜>function_name
 *     ```json
 *     {"arg": "value"}
 *     ```
 *   <｜tool▁call▁end｜>
 *   <｜tool▁calls▁end｜>
 */
import { randomUUID } from 'node:crypto';
import { BaseParser } from './BaseParser';
import type { ParsedResult, ParsedToolCall } from './types';
import { emptyParsedResult, toolCallResult } from './types';
import { repairModelJson } from '@modules/utils/json';

export class DeepSeekV3Parser extends BaseParser {
  readonly name = 'deepseek_v3';

  readonly modelPatterns = ['deepseek-', 'deepseek_v3'];

  private static readonly START_TOKEN = '<｜tool▁calls▁begin｜>';

  private static readonly TOOL_CALL_PATTERN =
    /<｜tool▁call▁begin｜>(?<type>.*?)<｜tool▁sep｜>(?<functionName>.*?)\s*```json\s*(?<functionArguments>.*?)\s*```\s*<｜tool▁call▁end｜>/gs;

  override mayContainToolCalls(text: string): boolean {
    return text.includes(DeepSeekV3Parser.START_TOKEN);
  }

  parse(text: string): ParsedResult {
    if (!this.mayContainToolCalls(text)) {
      return emptyParsedResult(text);
    }

    const toolCalls: ParsedToolCall[] = [];
    const matches = text.matchAll(DeepSeekV3Parser.TOOL_CALL_PATTERN);

    for (const match of matches) {
      const functionName = (match.groups?.functionName || '').trim();
      const functionArguments = (match.groups?.functionArguments || '').trim();

      if (!functionName) continue;

      let args: string;
      try {
        // 修复可能的 Windows 路径反斜杠问题后解析
        const repaired = repairModelJson(functionArguments);
        const parsed = JSON.parse(repaired);
        args = JSON.stringify(parsed, null, 0);
      } catch {
        args = functionArguments;
      }

      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: functionName,
        arguments: args,
      });
    }

    if (toolCalls.length === 0) {
      return emptyParsedResult(text);
    }

    const firstTagIndex = text.indexOf(DeepSeekV3Parser.START_TOKEN);
    const content = text.slice(0, firstTagIndex).trim() || null;

    return toolCallResult(content, toolCalls);
  }
}
