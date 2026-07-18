import * as fs from 'fs';
import * as path from 'path';
import { CommandTrace, TraceExportFormat, TraceSession } from './types.js';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'core:trajectory:CommandExport', level: LogLevel.INFO });

export interface ExportOptions {
  format: TraceExportFormat;
  outputDir?: string;
  filename?: string;
  includeMetadata?: boolean;
  prettyPrint?: boolean;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  format: TraceExportFormat;
  stepCount: number;
  error?: string;
}

export class CommandExport {
  exportTrace(trace: CommandTrace, options: ExportOptions): ExportResult {
    try {
      let content: string;

      switch (options.format) {
        case 'json':
          content = this.toJson(trace, options.prettyPrint);
          break;
        case 'csv':
          content = this.toCsv(trace);
          break;
        case 'markdown':
          content = this.toMarkdown(trace);
          break;
        case 'html':
          content = this.toHtml(trace);
          break;
        default:
          return {
            success: false,
            format: options.format,
            stepCount: 0,
            error: `不支持的格式: ${options.format}`,
          };
      }

      if (options.outputDir) {
        const filename =
          options.filename || `trace-${trace.session.id}.${options.format}`;

        fs.mkdirSync(options.outputDir, { recursive: true });

        const filePath = path.join(options.outputDir, filename);

        fs.writeFileSync(filePath, content, 'utf-8');

        return {
          success: true,
          filePath,
          format: options.format,
          stepCount: trace.steps.length,
        };
      }

      return {
        success: true,
        format: options.format,
        stepCount: trace.steps.length,
      };
    } catch (error) {
      return {
        success: false,
        format: options.format,
        stepCount: trace.steps.length,
        error: error instanceof Error ? error.message : '导出失败',
      };
    }
  }

  exportSessions(
    sessions: TraceSession[],
    options: ExportOptions
  ): ExportResult {
    try {
      let content: string;

      const data = { sessions, exportedAt: new Date().toISOString() };

      switch (options.format) {
        case 'json':
          content = JSON.stringify(
            data,
            null,
            options.prettyPrint ? 2 : undefined
          );
          break;
        case 'csv':
          content = this.sessionsToCsv(sessions);
          break;
        case 'markdown':
          content = this.sessionsToMarkdown(sessions);
          break;
        default:
          return {
            success: false,
            format: options.format,
            stepCount: 0,
            error: `不支持的格式: ${options.format}`,
          };
      }

      if (options.outputDir) {
        const filename =
          options.filename || `sessions-export.${options.format}`;

        fs.mkdirSync(options.outputDir, { recursive: true });

        const filePath = path.join(options.outputDir, filename);

        fs.writeFileSync(filePath, content, 'utf-8');

        return {
          success: true,
          filePath,
          format: options.format,
          stepCount: sessions.length,
        };
      }

      return {
        success: true,
        format: options.format,
        stepCount: sessions.length,
      };
    } catch (error) {
      return {
        success: false,
        format: options.format,
        stepCount: sessions.length,
        error: error instanceof Error ? error.message : '导出失败',
      };
    }
  }

  private toJson(trace: CommandTrace, pretty?: boolean): string {
    return JSON.stringify(trace, null, pretty ? 2 : undefined);
  }

  private toCsv(trace: CommandTrace): string {
    const header =
      'stepId,sessionId,command,status,startedAt,completedAt,durationMs,error';

    const rows = trace.steps.map((step) => {
      return [
        step.id,
        step.sessionId,
        `"${step.command.replace(/"/g, '""')}"`,
        step.status,
        step.startedAt,
        step.completedAt || '',
        step.durationMs || '',
        step.error ? `"${step.error.replace(/"/g, '""')}"` : '',
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }

  private toMarkdown(trace: CommandTrace): string {
    const lines: string[] = [];

    lines.push(`# 执行轨迹: ${trace.session.name}`);
    lines.push('');
    lines.push(`- **会话ID**: ${trace.session.id}`);
    lines.push(
      `- **开始时间**: ${new Date(trace.session.startedAt).toISOString()}`
    );
    lines.push(`- **状态**: ${trace.session.status}`);
    lines.push(`- **步骤数**: ${trace.steps.length}`);

    if (trace.session.description) {
      lines.push(`- **描述**: ${trace.session.description}`);
    }

    if (trace.session.tags && trace.session.tags.length > 0) {
      lines.push(`- **标签**: ${trace.session.tags.join(', ')}`);
    }

    lines.push('');
    lines.push('## 执行步骤');
    lines.push('');
    lines.push('| # | 命令 | 状态 | 耗时(ms) | 错误 |');
    lines.push('|---|------|------|----------|------|');
    trace.steps.forEach((step, index) => {
      const errorStr = step.error ? `[ERR] ${step.error.slice(0, 50)}` : '';
      lines.push(
        `| ${index + 1} | \`${step.command}\` | ${this.statusIcon(step.status)} | ${step.durationMs || '-'} | ${errorStr} |`
      );
    });

    return lines.join('\n');
  }

  private toHtml(trace: CommandTrace): string {
    const stepRows = trace.steps
      .map((step, index) => {
        return `<tr>
        <td>${index + 1}</td>
        <td><code>${this.escapeHtml(step.command)}</code></td>
        <td>${this.statusIcon(step.status)}</td>
        <td>${step.durationMs || '-'}</td>
        <td>${step.error ? `<span class="error">${this.escapeHtml(step.error)}</span>` : ''}</td>
      </tr>`;
      })
      .join('\n      ');

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>执行轨迹: ${this.escapeHtml(trace.session.name)}</title>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 960px; margin: 0 auto; padding: 20px; }
    h1 { color: #333; }
    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #ddd; }
    th { background: #f5f5f5; }
    .error { color: #d32f2f; }
    .meta { background: #f9f9f9; padding: 12px; border-radius: 6px; margin-bottom: 20px; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; }
  </style>
</head>
<body>
  <h1>执行轨迹: ${this.escapeHtml(trace.session.name)}</h1>
  <div class="meta">
    <p><strong>会话ID:</strong> ${trace.session.id}</p>
    <p><strong>开始时间:</strong> ${new Date(trace.session.startedAt).toISOString()}</p>
    <p><strong>状态:</strong> ${trace.session.status}</p>
    <p><strong>步骤数:</strong> ${trace.steps.length}</p>
  </div>
  <table>
    <thead>
      <tr><th>#</th><th>命令</th><th>状态</th><th>耗时(ms)</th><th>错误</th></tr>
    </thead>
    <tbody>
      ${stepRows}
    </tbody>
  </table>
</body>
</html>`;
  }

  private sessionsToCsv(sessions: TraceSession[]): string {
    const header = 'id,name,status,startedAt,completedAt,stepCount,tags';

    const rows = sessions.map((s) => {
      return [
        s.id,
        `"${s.name.replace(/"/g, '""')}"`,
        s.status,
        s.startedAt,
        s.completedAt || '',
        s.stepCount,
        s.tags ? `"${s.tags.join(';')}"` : '',
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }

  private sessionsToMarkdown(sessions: TraceSession[]): string {
    const lines: string[] = [];

    lines.push('# 会话导出');
    lines.push('');
    lines.push(`导出时间: ${new Date().toISOString()}`);
    lines.push('');
    lines.push('| ID | 名称 | 状态 | 步骤数 | 开始时间 |');
    lines.push('|----|------|------|--------|----------|');

    sessions.forEach((s) => {
      lines.push(
        `| ${s.id} | ${s.name} | ${this.statusIcon(s.status)} | ${s.stepCount} | ${new Date(s.startedAt).toISOString()} |`
      );
    });

    return lines.join('\n');
  }

  private statusIcon(status: string): string {
    const icons: Record<string, string> = {
      success: '[OK]',
      failure: '[FAIL]',
      running: '[RUN]',
      cancelled: '[STOP]',
    };

    return icons[status] || status;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}

export const commandExport = new CommandExport();
