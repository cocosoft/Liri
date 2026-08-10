/**
 * 插件安全扫描器
 * 检测插件中的危险模式和潜在安全风险
 * 参考CC源码 cc_code/backend/utils/plugins/validatePlugin.ts 实现
 */

import { readFile, readdir } from 'fs/promises';
import { join, relative } from 'path';
import { getLogger } from '@modules/monitoring';
const logger = getLogger('plugins:utils:pluginSecurityScanner');

/**
 * 危险模式类型
 */
export type DangerPattern =
  | 'eval'
  | 'child_process_require'
  | 'child_process_exec'
  | 'fs_path_traversal'
  | 'network_request'
  | 'secret_access'
  | 'shell_injection'
  | 'dynamic_import';

/**
 * 风险级别
 */
export type RiskLevel = 'high' | 'medium' | 'low' | 'info';

/**
 * 安全问题
 */
export interface SecurityIssue {
  type: DangerPattern;
  riskLevel: RiskLevel;
  file: string;
  line?: number;
  code?: string;
  description: string;
  suggestion?: string;
}

/**
 * 安全扫描结果
 */
export interface SecurityScanResult {
  safe: boolean;
  issues: SecurityIssue[];
  summary: {
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  scannedFiles: number;
  scanDuration: number;
}

/**
 * 危险模式定义
 */
const DANGER_PATTERNS: Array<{
  pattern: RegExp;
  type: DangerPattern;
  riskLevel: RiskLevel;
  description: string;
  suggestion: string;
}> = [
  {
    pattern: /\beval\s*\(/,
    type: 'eval',
    riskLevel: 'high',
    description: '使用eval()执行动态代码，可能导致代码注入攻击',
    suggestion: '避免使用eval()，考虑使用Function构造函数或JSON.parse()替代',
  },
  {
    pattern: /require\s*\(\s*['"]child_process['"]\s*\)/,
    type: 'child_process_require',
    riskLevel: 'high',
    description: '导入child_process模块，可能执行系统命令',
    suggestion: '如果需要执行命令，确保输入经过严格验证',
  },
  {
    pattern: /(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
    type: 'child_process_exec',
    riskLevel: 'high',
    description: '执行系统命令，可能导致命令注入',
    suggestion: '使用参数数组而非字符串，并验证所有输入',
  },
  {
    pattern: /\.\.\/|\.\.\\\/|path\.join\([^)]+\.\.\/|resolve\([^)]+\.\.\//,
    type: 'fs_path_traversal',
    riskLevel: 'medium',
    description: '检测到路径遍历模式，可能访问插件目录外的文件',
    suggestion: '确保路径在插件目录内，使用路径验证函数',
  },
  {
    pattern: /(fetch|axios|request|http\.request|https\.request)\s*\(/,
    type: 'network_request',
    riskLevel: 'medium',
    description: '发起网络请求，可能泄露数据或下载恶意内容',
    suggestion: '确保请求目标是可信的，验证所有响应数据',
  },
  {
    pattern: /(process\.env|process\.cwd)\s*\(/,
    type: 'secret_access',
    riskLevel: 'low',
    description: '访问进程环境变量，可能包含敏感信息',
    suggestion: '注意不要将敏感信息记录到日志',
  },
  {
    pattern: /\$[a-zA-Z_][a-zA-Z0-9_]*|`|\$\{.*\}/,
    type: 'shell_injection',
    riskLevel: 'high',
    description: '检测到shell变量或命令替换，可能导致shell注入',
    suggestion: '避免将用户输入拼接到shell命令中',
  },
  {
    pattern: /import\s*\(\s*['"`]/,
    type: 'dynamic_import',
    riskLevel: 'medium',
    description: '动态导入模块，路径可能在运行时确定',
    suggestion: '确保导入路径是固定的或经过验证的',
  },
];

/**
 * 需要扫描的文件扩展名
 */
const CODE_EXTENSIONS = ['.ts', '.js', '.tsx', '.jsx', '.mjs', '.cjs'];

/**
 * 可跳过的目录
 */
const SKIP_DIRS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.cache',
];

/**
 * 插件安全扫描器
 */
export class PluginSecurityScanner {
  private issues: SecurityIssue[] = [];
  private scannedFiles: Set<string> = new Set();

  /**
   * 扫描插件目录
   */
  async scanPluginDir(pluginDir: string): Promise<SecurityScanResult> {
    const startTime = Date.now();
    this.issues = [];
    this.scannedFiles = new Set();

    try {
      await this.scanDirectory(pluginDir);
    } catch (error) {
      logger.error('Security scan error:', error);
    }

    return this.createResult(startTime);
  }

  /**
   * 扫描单个文件
   */
  async scanFile(filePath: string): Promise<SecurityIssue[]> {
    const issues: SecurityIssue[] = [];

    try {
      const content = await readFile(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        for (const dangerPattern of DANGER_PATTERNS) {
          const match = line.match(dangerPattern.pattern);
          if (match) {
            issues.push({
              type: dangerPattern.type,
              riskLevel: dangerPattern.riskLevel,
              file: filePath,
              line: i + 1,
              code: line.trim().substring(0, 100),
              description: dangerPattern.description,
              suggestion: dangerPattern.suggestion,
            });
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to scan file ${filePath}:`, error);
    }

    return issues;
  }

  /**
   * 递归扫描目录
   */
  private async scanDirectory(dir: string, baseDir?: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    const relativeToBase = baseDir ? relative(baseDir, dir) : '';

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.includes(entry.name) && !entry.name.startsWith('.')) {
          await this.scanDirectory(fullPath, baseDir || dir);
        }
        continue;
      }

      const ext = entry.name.substring(entry.name.lastIndexOf('.'));
      if (CODE_EXTENSIONS.includes(ext)) {
        if (!this.scannedFiles.has(fullPath)) {
          this.scannedFiles.add(fullPath);
          const fileIssues = await this.scanFile(fullPath);
          this.issues.push(...fileIssues);
        }
      }
    }
  }

  /**
   * 创建扫描结果
   */
  private createResult(startTime: number): SecurityScanResult {
    const summary = {
      high: 0,
      medium: 0,
      low: 0,
      info: 0,
    };

    for (const issue of this.issues) {
      summary[issue.riskLevel]++;
    }

    return {
      safe: summary.high === 0 && summary.medium === 0,
      issues: this.issues,
      summary,
      scannedFiles: this.scannedFiles.size,
      scanDuration: Date.now() - startTime,
    };
  }

  /**
   * 生成安全报告
   */
  generateReport(result: SecurityScanResult): string {
    const lines: string[] = [];

    lines.push('# 插件安全扫描报告\n');
    lines.push(`扫描时间: ${new Date().toISOString()}`);
    lines.push(`扫描文件数: ${result.scannedFiles}`);
    lines.push(`扫描耗时: ${result.scanDuration}ms\n`);

    lines.push('## 风险摘要\n');
    lines.push(`- 高风险: ${result.summary.high}`);
    lines.push(`- 中风险: ${result.summary.medium}`);
    lines.push(`- 低风险: ${result.summary.low}`);
    lines.push(`- 信息: ${result.summary.info}\n`);

    if (result.safe) {
      lines.push('✅ 未检测到高风险安全问题\n');
    } else {
      lines.push('⚠️ 检测到安全问题，请查看详情\n');
    }

    if (result.issues.length > 0) {
      lines.push('## 详细问题\n');
      for (const issue of result.issues) {
        lines.push(`### ${issue.type} (${issue.riskLevel})`);
        lines.push(
          `- 文件: ${issue.file}${issue.line ? `:${issue.line}` : ''}`
        );
        if (issue.code) {
          lines.push(`- 代码: \`${issue.code}\``);
        }
        lines.push(`- 描述: ${issue.description}`);
        if (issue.suggestion) {
          lines.push(`- 建议: ${issue.suggestion}`);
        }
        lines.push('');
      }
    }

    return lines.join('\n');
  }
}

/**
 * 导出单例
 */
export const pluginSecurityScanner = new PluginSecurityScanner();
