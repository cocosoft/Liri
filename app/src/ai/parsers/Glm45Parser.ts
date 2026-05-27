/**
 * GLM 4.5 工具调用解析器
 * 对标 Hermes glm45_parser.py（Glm45ToolCallParser）
 *
 * 格式: 使用 arg_key/arg_value 标签而非标准 JSON
 *   <tool_call>function_name
 *   <arg_key>param1</arg_key><arg_value>value1</arg_value>
 *   <arg_key>param2</arg_key><arg_value>value2</arg_value>
 *   </tool_call>
 */
import { randomUUID } from 'node:crypto';
import { BaseParser } from './BaseParser';
import type { ParsedResult, ParsedToolCall } from './types';
import { emptyParsedResult, toolCallResult } from './types';

export class Glm45Parser extends BaseParser {
  readonly name = 'glm45';

  readonly modelPatterns = ['glm-4', 'glm4', 'chatglm', 'glm-4.5'];

  private static readonly FUNC_CALL_REGEX = /<tool_call>.*?<\/tool_call>/gs;

  private static readonly FUNC_DETAIL_REGEX =
    /<tool_call>([^\n]*)\n(.*)<\/tool_call>/s;

  private static readonly FUNC_ARG_REGEX =
    /<arg_key>(.*?)<\/arg_key>\s*<arg_value>(.*?)<\/arg_value>/gs;

  private static readonly START_TOKEN = '<tool_call>';

  override mayContainToolCalls(text: string): boolean {
    return text.includes(Glm45Parser.START_TOKEN);
  }

  parse(text: string): ParsedResult {
    if (!this.mayContainToolCalls(text)) {
      return emptyParsedResult(text);
    }

    const matchedCalls = text.match(Glm45Parser.FUNC_CALL_REGEX);
    if (!matchedCalls || matchedCalls.length === 0) {
      return emptyParsedResult(text);
    }

    const toolCalls: ParsedToolCall[] = [];

    for (const match of matchedCalls) {
      const detail = Glm45Parser.FUNC_DETAIL_REGEX.exec(match);
      if (!detail) continue;

      const funcName = (detail[1] || '').trim();
      const argsBlock = detail[2] || '';

      if (!funcName) continue;

      const args: Record<string, unknown> = {};
      const argMatches = argsBlock.matchAll(Glm45Parser.FUNC_ARG_REGEX);

      for (const argMatch of argMatches) {
        const key = (argMatch[1] || '').trim();
        const rawValue = (argMatch[2] || '').trim();

        if (!key) continue;

        args[key] = this.deserializeValue(rawValue);
      }

      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: funcName,
        arguments: JSON.stringify(args),
      });

      Glm45Parser.FUNC_DETAIL_REGEX.lastIndex = 0;
    }

    if (toolCalls.length === 0) {
      return emptyParsedResult(text);
    }

    const firstTagIndex = text.indexOf(Glm45Parser.START_TOKEN);
    const content = text.slice(0, firstTagIndex).trim() || null;

    return toolCallResult(content, toolCalls);
  }

  /**
   * 反序列化参数值：尝试 JSON.parse → 数字/布尔 → 原始字符串
   * 对标 Hermes _deserialize_value
   */
  private deserializeValue(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;

    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;

    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}
