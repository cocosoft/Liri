/**
 * Invoke XML 格式工具调用解析器
 *
 * 部分模型使用 <invoke> 标签输出工具调用:
 *   <invoke name="function_name">
 *     <parameter name="param1">value1</parameter>
 *     <parameter name="param2">value2</parameter>
 *   </invoke>
 *
 * 适用于: 使用 invoke 格式的任何模型
 */
import { randomUUID } from 'crypto';
import { BaseParser } from './BaseParser';
import type { ParsedResult, ParsedToolCall } from './types';
import { emptyParsedResult, toolCallResult } from './types';

export class InvokeXmlParser extends BaseParser {
  readonly name = 'invoke_xml';

  readonly modelPatterns = ['*']; // 兜底: 匹配任意模型

  /** 匹配完整 <invoke>...</invoke> 块 */
  private static readonly INVOKE_PATTERN =
    /<invoke\s+name\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/invoke\s*>/gi;

  /** 匹配嵌套 <parameter> 标签 */
  private static readonly PARAM_PATTERN =
    /<parameter\s+name\s*=\s*["']([^"']+)["'](?:[^>]*)>([\s\S]*?)<\/parameter\s*>/gi;

  override mayContainToolCalls(text: string): boolean {
    return text.includes('<invoke');
  }

  parse(text: string): ParsedResult {
    if (!this.mayContainToolCalls(text)) {
      return emptyParsedResult(text);
    }

    const toolCalls: ParsedToolCall[] = [];
    let firstMatchIndex = -1;

    // 重置正则 lastIndex
    InvokeXmlParser.INVOKE_PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null;
    while ((match = InvokeXmlParser.INVOKE_PATTERN.exec(text)) !== null) {
      const funcName = match[1]?.trim();
      const innerContent = match[2] || '';

      if (!funcName) continue;

      const args: Record<string, unknown> = {};

      // 解析参数
      InvokeXmlParser.PARAM_PATTERN.lastIndex = 0;
      let paramMatch: RegExpExecArray | null;
      while (
        (paramMatch = InvokeXmlParser.PARAM_PATTERN.exec(innerContent)) !== null
      ) {
        const key = paramMatch[1]?.trim();
        const rawValue = (paramMatch[2] || '').trim();

        if (!key) continue;

        // 尝试反序列化值（bool / number / string）
        args[key] = this.deserializeValue(rawValue);
      }

      toolCalls.push({
        id: `call_${randomUUID().slice(0, 8)}`,
        name: funcName,
        arguments: JSON.stringify(args),
      });

      if (firstMatchIndex === -1) {
        firstMatchIndex = match.index;
      }
    }

    if (toolCalls.length === 0) {
      return emptyParsedResult(text);
    }

    // 提取标签之前的文本作为内容，之后的丢弃（工具调用后面不应有文本）
    const content = text.slice(0, firstMatchIndex).trim() || null;
    return toolCallResult(content, toolCalls);
  }

  private deserializeValue(value: string): unknown {
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;

    const num = Number(value);
    if (!isNaN(num) && value.trim() !== '') return num;

    return value;
  }
}
