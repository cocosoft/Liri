/**
 * LSP 诊断 Agent 上下文适配器
 * 将 LSP 诊断结果写入 Agent 上下文，提升代码修复建议质量
 */
import type { Diagnostic as LSPDiagnostic } from './types';
import { DiagnosticSeverity } from './types';

/**
 * 诊断严重级别映射
 */
export type AgentDiagnosticLevel = 'error' | 'warning' | 'info' | 'hint';

/**
 * Agent 上下文中的诊断条目
 */
export interface AgentDiagnosticEntry {
  file: string;
  line: number;
  column: number;
  level: AgentDiagnosticLevel;
  message: string;
  source: string;
  code?: string;
  fixSuggestion?: string;
}

/**
 * 上下文适配器配置
 */
export interface DiagnosticsAdapterConfig {
  enabled: boolean;
  maxDiagnostics: number;
  includeFixSuggestions: boolean;
  groupByFile: boolean;
  filterLevels: AgentDiagnosticLevel[];
}

/**
 * 默认配置
 */
const DEFAULT_CONFIG: DiagnosticsAdapterConfig = {
  enabled: true,
  maxDiagnostics: 50,
  includeFixSuggestions: true,
  groupByFile: true,
  filterLevels: ['error', 'warning'],
};

/**
 * LSP 诊断 Agent 上下文适配器
 */
export class DiagnosticsContextAdapter {
  private config: DiagnosticsAdapterConfig;
  private diagnostics: Map<string, AgentDiagnosticEntry[]> = new Map();

  constructor(config?: Partial<DiagnosticsAdapterConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * 写入诊断结果
   * @param filePath 文件路径
   * @param diagnostics LSP 诊断列表
   */
  writeDiagnostics(filePath: string, diagnostics: LSPDiagnostic[]): void {
    if (!this.config.enabled) return;

    const entries: AgentDiagnosticEntry[] = diagnostics
      .filter((d) => {
        const level = this.mapLevel(d.severity);
        return this.config.filterLevels.includes(level);
      })
      .slice(0, this.config.maxDiagnostics)
      .map((d) => ({
        file: filePath,
        line: d.range?.start?.line ?? 0,
        column: d.range?.start?.character ?? 0,
        level: this.mapLevel(d.severity),
        message: d.message,
        source: d.source || 'lsp',
        code: d.code !== undefined ? String(d.code) : undefined,
        fixSuggestion: this.config.includeFixSuggestions
          ? this.generateFixSuggestion(d)
          : undefined,
      }));

    if (entries.length > 0) {
      this.diagnostics.set(filePath, entries);
    }
  }

  /**
   * 生成 Agent 上下文字符串
   * @returns 格式化的诊断上下文字符串
   */
  buildContextString(): string {
    if (!this.config.enabled || this.diagnostics.size === 0) {
      return '';
    }

    const lines: string[] = [];
    const totalErrors = this.getTotalErrors();
    const totalWarnings = this.getTotalWarnings();

    lines.push(
      `[LSP 诊断摘要: ${totalErrors} 个错误, ${totalWarnings} 个警告]`
    );
    lines.push('');

    if (this.config.groupByFile) {
      for (const [file, entries] of this.diagnostics) {
        lines.push(`### ${file}`);
        for (const entry of entries) {
          const levelIcon = {
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️',
            hint: '💡',
          }[entry.level];

          lines.push(
            `${levelIcon} L${entry.line + 1}:C${entry.column + 1} [${entry.source}] ${entry.message}`
          );

          if (entry.fixSuggestion) {
            lines.push(`   💡 建议: ${entry.fixSuggestion}`);
          }
        }
        lines.push('');
      }
    } else {
      const allEntries = Array.from(this.diagnostics.values()).flat();
      for (const entry of allEntries) {
        lines.push(
          `${entry.file}:${entry.line + 1}:${entry.column + 1} [${entry.level}] ${entry.message}`
        );

        if (entry.fixSuggestion) {
          lines.push(`  → ${entry.fixSuggestion}`);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * 获取需要修复的诊断列表
   * @returns 诊断条目
   */
  getFixableDiagnostics(): AgentDiagnosticEntry[] {
    return Array.from(this.diagnostics.values())
      .flat()
      .filter(
        (d) => d.fixSuggestion && (d.level === 'error' || d.level === 'warning')
      );
  }

  /**
   * 获取错误总数
   */
  getTotalErrors(): number {
    return Array.from(this.diagnostics.values())
      .flat()
      .filter((d) => d.level === 'error').length;
  }

  /**
   * 获取警告总数
   */
  getTotalWarnings(): number {
    return Array.from(this.diagnostics.values())
      .flat()
      .filter((d) => d.level === 'warning').length;
  }

  /**
   * 获取按文件统计
   */
  getFileStats(): Array<{ file: string; errors: number; warnings: number }> {
    return Array.from(this.diagnostics.entries()).map(([file, entries]) => ({
      file,
      errors: entries.filter((d) => d.level === 'error').length,
      warnings: entries.filter((d) => d.level === 'warning').length,
    }));
  }

  /**
   * 生成修复建议文本（用于注入 Agent 上下文）
   * @returns 修复建议文本
   */
  generateAgentPrompt(): string {
    const fixable = this.getFixableDiagnostics();

    if (fixable.length === 0) return '';

    const lines: string[] = [];
    lines.push('当前代码中存在以下问题需要修复：');

    for (const entry of fixable.slice(0, 10)) {
      lines.push(`- ${entry.file}:${entry.line + 1} - ${entry.message}`);
      if (entry.fixSuggestion) {
        lines.push(`  修复方案: ${entry.fixSuggestion}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * 清除诊断数据
   */
  clear(): void {
    this.diagnostics.clear();
  }

  /**
   * 清除指定文件的诊断
   * @param filePath 文件路径
   */
  clearFile(filePath: string): void {
    this.diagnostics.delete(filePath);
  }

  /**
   * 映射 LSP 严重级别到 Agent 级别
   */
  private mapLevel(severity?: DiagnosticSeverity): AgentDiagnosticLevel {
    switch (severity) {
      case DiagnosticSeverity.Error:
        return 'error';
      case DiagnosticSeverity.Warning:
        return 'warning';
      case DiagnosticSeverity.Information:
        return 'info';
      case DiagnosticSeverity.Hint:
        return 'hint';
      default:
        return 'info';
    }
  }

  /**
   * 生成修复建议
   */
  private generateFixSuggestion(diagnostic: LSPDiagnostic): string | undefined {
    const msg = diagnostic.message.toLowerCase();

    if (msg.includes('unused') || msg.includes('not used')) {
      return '移除未使用的代码';
    }

    if (msg.includes('cannot find') || msg.includes('not found')) {
      return '检查导入路径或依赖是否存在';
    }

    if (
      msg.includes('type') &&
      (msg.includes('assign') || msg.includes('compatible'))
    ) {
      return '检查类型声明，可能需要类型转换或修改类型定义';
    }

    if (msg.includes('undefined') || msg.includes('is null')) {
      return '添加空值检查或初始化默认值';
    }

    if (msg.includes('deprecated')) {
      return '替换为推荐的 API 或方法';
    }

    if (msg.includes('missing return') || msg.includes('not all paths')) {
      return '确保所有代码路径都有返回值';
    }

    if (diagnostic.code !== undefined && diagnostic.code !== null) {
      return `参考 LSP 规则 ${diagnostic.code} 进行修复`;
    }

    return undefined;
  }
}

/**
 * 全局 LSP 诊断适配器
 */
let globalAdapter: DiagnosticsContextAdapter | null = null;

/**
 * 获取全局 LSP 诊断上下文适配器
 */
export function getDiagnosticsContextAdapter(): DiagnosticsContextAdapter {
  if (!globalAdapter) {
    globalAdapter = new DiagnosticsContextAdapter();
  }

  return globalAdapter;
}
