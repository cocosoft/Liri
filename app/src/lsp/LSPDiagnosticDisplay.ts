/**
 * LSP 诊断信息展示工具
 * 提供格式化、分组和严重级别着色等诊断展示功能
 */

import type { Diagnostic, DiagnosticFile } from './types.js';
import { DiagnosticSeverity } from './types.js';

const SEVERITY_LABELS: Record<number, string> = {
  [DiagnosticSeverity.Error]: 'ERROR',
  [DiagnosticSeverity.Warning]: 'WARN',
  [DiagnosticSeverity.Information]: 'INFO',
  [DiagnosticSeverity.Hint]: 'HINT',
};

const SEVERITY_ORDER: Record<number, number> = {
  [DiagnosticSeverity.Error]: 0,
  [DiagnosticSeverity.Warning]: 1,
  [DiagnosticSeverity.Information]: 2,
  [DiagnosticSeverity.Hint]: 3,
};

export interface DisplayDiagnostic {
  file: string;
  line: number;
  column: number;
  severity: string;
  message: string;
  code?: string;
  source?: string;
}

export interface DiagnosticSummary {
  total: number;
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
  files: number;
}

export interface GroupedDiagnostics {
  byFile: Map<string, DisplayDiagnostic[]>;
  bySeverity: Map<string, DisplayDiagnostic[]>;
}

export type DiagnosticFormat = 'text' | 'compact' | 'json';

export class LSPDiagnosticDisplay {
  private maxDiagnosticsPerFile: number;
  private maxTotalDiagnostics: number;

  constructor(options?: { maxPerFile?: number; maxTotal?: number }) {
    this.maxDiagnosticsPerFile = options?.maxPerFile ?? 20;
    this.maxTotalDiagnostics = options?.maxTotal ?? 100;
  }

  private severityLabel(severity: number | undefined): string {
    return severity !== undefined
      ? SEVERITY_LABELS[severity] || 'UNKNOWN'
      : 'UNKNOWN';
  }

  private toDisplayDiagnostic(
    file: DiagnosticFile,
    diag: Diagnostic
  ): DisplayDiagnostic {
    return {
      file: file.uri,
      line: diag.range.start.line + 1,
      column: diag.range.start.character + 1,
      severity: this.severityLabel(diag.severity),
      message: diag.message,
      code: diag.code !== undefined ? String(diag.code) : undefined,
      source: diag.source,
    };
  }

  format(
    diagnostics: DiagnosticFile[],
    format: DiagnosticFormat = 'text'
  ): string {
    if (format === 'json') {
      return this.formatJson(diagnostics);
    }
    if (format === 'compact') {
      return this.formatCompact(diagnostics);
    }
    return this.formatText(diagnostics);
  }

  private formatText(diagnostics: DiagnosticFile[]): string {
    const sorted = this.sortBySeverity(diagnostics);
    const lines: string[] = [];
    let count = 0;

    for (const file of sorted) {
      const fileName = this.shortName(file.uri);
      lines.push(`\n${fileName}:`);

      for (const diag of file.diagnostics) {
        if (count >= this.maxTotalDiagnostics) {
          lines.push(
            `  ... 以及更多诊断信息（达到上限 ${this.maxTotalDiagnostics} 条）`
          );
          return lines.join('\n');
        }
        count++;

        const display = this.toDisplayDiagnostic(file, diag);
        const loc = `${display.line}:${display.column}`;
        const code = display.code ? ` (${display.code})` : '';
        const source = display.source ? ` [${display.source}]` : '';
        lines.push(
          `  ${loc}  ${display.severity}  ${display.message}${code}${source}`
        );
      }
    }

    if (lines.length === 0) {
      lines.push('未发现诊断信息');
    }

    return lines.join('\n');
  }

  private formatCompact(diagnostics: DiagnosticFile[]): string {
    const parts: string[] = [];

    for (const file of this.sortBySeverity(diagnostics)) {
      for (const diag of file.diagnostics) {
        const display = this.toDisplayDiagnostic(file, diag);
        parts.push(
          `${display.file}:${display.line}:${display.column}: ${display.severity}: ${display.message}`
        );
      }
    }

    return parts.join('\n');
  }

  private formatJson(diagnostics: DiagnosticFile[]): string {
    const items: DisplayDiagnostic[] = [];

    for (const file of diagnostics) {
      for (const diag of file.diagnostics) {
        items.push(this.toDisplayDiagnostic(file, diag));
      }
    }

    return JSON.stringify(items, null, 2);
  }

  summary(diagnostics: DiagnosticFile[]): DiagnosticSummary {
    let errors = 0;
    let warnings = 0;
    let infos = 0;
    let hints = 0;
    const files = new Set<string>();

    for (const file of diagnostics) {
      files.add(file.uri);
      for (const diag of file.diagnostics) {
        switch (diag.severity) {
          case DiagnosticSeverity.Error:
            errors++;
            break;
          case DiagnosticSeverity.Warning:
            warnings++;
            break;
          case DiagnosticSeverity.Information:
            infos++;
            break;
          case DiagnosticSeverity.Hint:
            hints++;
            break;
        }
      }
    }

    const total = errors + warnings + infos + hints;

    return { total, errors, warnings, infos, hints, files: files.size };
  }

  summaryText(diagnostics: DiagnosticFile[]): string {
    const s = this.summary(diagnostics);
    const parts: string[] = [];

    if (s.total === 0) return '诊断结果：无问题';

    parts.push(`诊断结果：共 ${s.total} 个问题`);
    if (s.errors > 0) parts.push(`错误 ${s.errors} 个`);
    if (s.warnings > 0) parts.push(`警告 ${s.warnings} 个`);
    if (s.infos > 0) parts.push(`信息 ${s.infos} 条`);
    if (s.hints > 0) parts.push(`提示 ${s.hints} 条`);
    parts.push(`涉及 ${s.files} 个文件`);

    return parts.join('，');
  }

  group(diagnostics: DiagnosticFile[]): GroupedDiagnostics {
    const byFile = new Map<string, DisplayDiagnostic[]>();
    const bySeverity = new Map<string, DisplayDiagnostic[]>();

    bySeverity.set('ERROR', []);
    bySeverity.set('WARN', []);
    bySeverity.set('INFO', []);
    bySeverity.set('HINT', []);
    bySeverity.set('UNKNOWN', []);

    for (const file of diagnostics) {
      for (const diag of file.diagnostics) {
        const display = this.toDisplayDiagnostic(file, diag);

        if (!byFile.has(display.file)) {
          byFile.set(display.file, []);
        }
        byFile.get(display.file)!.push(display);

        const sevGroup =
          bySeverity.get(display.severity) || bySeverity.get('UNKNOWN')!;
        sevGroup.push(display);
      }
    }

    return { byFile, bySeverity };
  }

  private sortBySeverity(diagnostics: DiagnosticFile[]): DiagnosticFile[] {
    return diagnostics
      .map((file) => ({
        ...file,
        diagnostics: [...file.diagnostics].sort(
          (a, b) =>
            (SEVERITY_ORDER[a.severity ?? 99] ?? 99) -
            (SEVERITY_ORDER[b.severity ?? 99] ?? 99)
        ),
      }))
      .slice(0, this.maxDiagnosticsPerFile);
  }

  private shortName(uri: string): string {
    const decoded = decodeURI(uri);
    const parts = decoded.split(/[/\\]/);
    return parts.length > 2
      ? `.../${parts[parts.length - 2]}/${parts[parts.length - 1]}`
      : decoded;
  }
}

let defaultDisplay: LSPDiagnosticDisplay | undefined;

export function getDefaultDiagnosticDisplay(): LSPDiagnosticDisplay {
  if (!defaultDisplay) {
    defaultDisplay = new LSPDiagnosticDisplay();
  }
  return defaultDisplay;
}

export function createDiagnosticDisplay(options?: {
  maxPerFile?: number;
  maxTotal?: number;
}): LSPDiagnosticDisplay {
  return new LSPDiagnosticDisplay(options);
}
