/**
 * 导出服务
 *
 * 支持三种格式：
 * - Markdown：按轮次组织的可读对话导出
 * - JSON：清理后的原始数据
 * - HTML：自包含查看器
 *
 * 参考：claude-tap 的 export.py (Python 实现)
 */

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';
import type { TraceRecord, ExportFormat } from '../types';
import { ViewerService } from '../viewer/ViewerService';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'trace-recording\export\ExportService', level: LogLevel.INFO });

/**
 * 导出服务
 */
export class ExportService {
  private viewerService = new ViewerService();

  /**
   * 导出记录
   * @param records 录制记录列表
   * @param format 导出格式
   * @returns 导出内容字符串
   */
  export(records: TraceRecord[], format: ExportFormat): string {
    switch (format) {
      case 'markdown':
        return this.exportMarkdown(records);
      case 'json':
        return this.exportJson(records);
      case 'html':
        return this.viewerService.renderHtml(records);
      default:
        throw new AppError(
          `Unsupported export format: ${format}`,
          ErrorCategory.VALIDATION,
          ErrorSeverity.HIGH,
          'INVALID_INPUT',
          { format }
        );
    }
  }

  /**
   * 导出为 Markdown
   * 按轮次组织，保留 system/assistant/tool 消息
   */
  private exportMarkdown(records: TraceRecord[]): string {
    const sorted = [...records].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp)
    );

    const lines: string[] = [];
    lines.push('# AI Trace Export');
    lines.push('');
    lines.push(`> Generated: ${new Date().toISOString()}`);
    lines.push(`> Total records: ${records.length}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    for (const record of sorted) {
      const model = this.extractModel(record);
      const inputTokens = this.extractInputTokens(record);
      const outputTokens = this.extractOutputTokens(record);

      lines.push(`## Turn #${record.turn} - ${model}`);
      lines.push('');
      lines.push(`- **ID**: \`${record.id}\``);
      lines.push(`- **Time**: ${record.timestamp}`);
      lines.push(`- **Duration**: ${record.durationMs}ms`);
      lines.push(`- **Status**: ${record.response.status}`);
      lines.push(`- **Tokens**: ${inputTokens} in / ${outputTokens} out`);
      if (record.error) {
        lines.push(`- **Error**: ${record.error}`);
      }
      lines.push('');

      // 请求消息
      const messages = this.extractMessages(record);
      for (const msg of messages) {
        const role = typeof msg.role === 'string' ? msg.role : 'unknown';
        const content = typeof msg.content === 'string' ? msg.content : '';
        const toolCalls = msg.tool_calls;

        if (role === 'system') {
          lines.push('### System');
          lines.push('');
          lines.push('```');
          lines.push(content);
          lines.push('```');
          lines.push('');
        } else if (role === 'user') {
          lines.push('### User');
          lines.push('');
          lines.push(content);
          lines.push('');
        } else if (role === 'assistant') {
          lines.push('### Assistant');
          lines.push('');
          if (content) {
            lines.push(content);
            lines.push('');
          }
          if (Array.isArray(toolCalls) && toolCalls.length > 0) {
            lines.push('**Tool Calls:**');
            lines.push('');
            for (const tc of toolCalls) {
              const fn = tc.function as Record<string, unknown> | undefined;
              lines.push(`- \`${(fn?.name as string) || 'unknown'}\``);
              if (fn?.arguments) {
                lines.push('  ```json');
                lines.push(`  ${String(fn.arguments)}`);
                lines.push('  ```');
              }
            }
            lines.push('');
          }
        } else if (role === 'tool') {
          lines.push('### Tool Result');
          lines.push('');
          lines.push('```json');
          lines.push(
            typeof content === 'string'
              ? content
              : JSON.stringify(content, null, 2)
          );
          lines.push('```');
          lines.push('');
        }
      }

      // 响应预览
      const respBody = record.response.body;
      if (respBody) {
        lines.push('### Response Preview');
        lines.push('');
        lines.push('```json');
        lines.push(String(JSON.stringify(respBody, null, 2)).slice(0, 2000));
        lines.push('```');
        lines.push('');
      }

      lines.push('---');
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * 导出为 JSON
   * 清理后的记录（移除敏感头）
   */
  private exportJson(records: TraceRecord[]): string {
    const cleaned = records.map((r) => ({
      id: r.id,
      timestamp: r.timestamp,
      turn: r.turn,
      durationMs: r.durationMs,
      model: this.extractModel(r),
      request: {
        url: r.request.path,
        body: r.request.body,
      },
      response: {
        status: r.response.status,
        body: r.response.body,
        sse_events_count: r.response.sseEvents?.length || 0,
      },
      tokens: {
        input: this.extractInputTokens(r),
        output: this.extractOutputTokens(r),
      },
      error: r.error || undefined,
    }));

    return JSON.stringify(cleaned, null, 2);
  }

  /**
   * 从记录中提取模型名
   */
  private extractModel(record: TraceRecord): string {
    const body = record.request.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const m = (body as Record<string, unknown>).model;
      if (typeof m === 'string') {
        return m;
      }
    }
    return 'unknown';
  }

  /**
   * 提取输入 token
   */
  private extractInputTokens(record: TraceRecord): number {
    const body = record.response.body;
    if (body && typeof body === 'object') {
      const usage = (body as Record<string, unknown>).usage as
        | Record<string, unknown>
        | undefined;
      if (usage) {
        return (
          (usage.input_tokens as number) || (usage.prompt_tokens as number) || 0
        );
      }
    }
    return 0;
  }

  /**
   * 提取输出 token
   */
  private extractOutputTokens(record: TraceRecord): number {
    const body = record.response.body;
    if (body && typeof body === 'object') {
      const usage = (body as Record<string, unknown>).usage as
        | Record<string, unknown>
        | undefined;
      if (usage) {
        return (
          (usage.output_tokens as number) ||
          (usage.completion_tokens as number) ||
          0
        );
      }
    }
    return 0;
  }

  /**
   * 从请求体中提取消息列表
   */
  private extractMessages(record: TraceRecord): Array<Record<string, unknown>> {
    const body = record.request.body;
    if (body && typeof body === 'object' && !Array.isArray(body)) {
      const b = body as Record<string, unknown>;

      // Anthropic 格式
      const rawMessages = b.messages;
      if (Array.isArray(rawMessages)) {
        const result: Array<Record<string, unknown>> = [];

        // 添加 system prompt 作为首条消息
        const sysVal = b.system;
        if (typeof sysVal === 'string') {
          result.push({ role: 'system', content: sysVal });
        } else if (sysVal && typeof sysVal === 'object') {
          const sysObj = sysVal as Record<string, unknown>;
          if (typeof sysObj.text === 'string') {
            result.push({ role: 'system', content: sysObj.text });
          }
        }

        for (const msg of rawMessages) {
          if (msg && typeof msg === 'object') {
            result.push(msg as Record<string, unknown>);
          }
        }
        return result;
      }

      // OpenAI 格式
      const msgs = b.messages;
      if (Array.isArray(msgs)) {
        return msgs as Array<Record<string, unknown>>;
      }
    }
    return [];
  }
}
