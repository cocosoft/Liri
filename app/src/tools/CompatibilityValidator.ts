/**
 * 兼容性验证工具
 * 验证模块管理系统与现有代码的兼容性
 */

import * as fs from 'fs';
import * as path from 'path';
import { Logger, LogLevel } from '@modules/monitoring/logs/Logger';
import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error/types';

const logger = new Logger({ level: LogLevel.INFO });

/**
 * 兼容性验证结果
 */
interface CompatibilityResult {
  overallCompatibility: 'excellent' | 'good' | 'fair' | 'poor';
  issues: CompatibilityIssue[];
  statistics: {
    totalFiles: number;
    analyzedFiles: number;
    compatibleFiles: number;
    issuesCount: number;
    importPaths: {
      total: number;
      relative: number;
      absolute: number;
      alias: number;
    };
  };
  recommendations: string[];
}

/**
 * 兼容性问题
 */
interface CompatibilityIssue {
  filePath: string;
  lineNumber: number;
  issueType:
    | 'import_path'
    | 'module_not_found'
    | 'dependency_issue'
    | 'syntax_error';
  severity: 'high' | 'medium' | 'low';
  description: string;
  suggestion: string;
  codeSnippet: string;
}

/**
 * 兼容性验证器类
 */
export class CompatibilityValidator {
  private projectRoot: string;

  constructor(projectRoot: string = process.cwd()) {
    this.projectRoot = projectRoot;
  }

  /**
   * 验证项目兼容性
   */
  async validateCompatibility(): Promise<CompatibilityResult> {
    logger.info('开始验证模块管理系统兼容性...');

    const result: CompatibilityResult = {
      overallCompatibility: 'excellent',
      issues: [],
      statistics: {
        totalFiles: 0,
        analyzedFiles: 0,
        compatibleFiles: 0,
        issuesCount: 0,
        importPaths: {
          total: 0,
          relative: 0,
          absolute: 0,
          alias: 0,
        },
      },
      recommendations: [],
    };

    try {
      // 分析源码目录
      await this.analyzeSourceCode(result);

      // 计算总体兼容性
      this.calculateOverallCompatibility(result);

      // 生成建议
      this.generateRecommendations(result);

      logger.info('兼容性验证完成');
    } catch (error) {
      logger.error('兼容性验证失败:', { error });
      result.issues.push({
        filePath: 'compatibility-validator',
        lineNumber: 0,
        issueType: 'syntax_error',
        severity: 'high',
        description: `兼容性验证工具执行失败: ${error}`,
        suggestion: '检查验证工具代码和项目结构',
        codeSnippet: '',
      });
    }

    return result;
  }

  /**
   * 分析源码目录
   */
  private async analyzeSourceCode(result: CompatibilityResult): Promise<void> {
    const srcDir = path.join(this.projectRoot, 'src');

    if (!fs.existsSync(srcDir)) {
      throw new AppError(
        `源码目录不存在: ${srcDir}`,
        ErrorCategory.EXECUTION,
        ErrorSeverity.HIGH,
        '1000'
      );
    }

    // 获取所有TypeScript文件
    const files = this.getAllTypeScriptFiles(srcDir);
    result.statistics.totalFiles = files.length;

    logger.info(`发现 ${files.length} 个TypeScript文件`);

    // 分析每个文件
    for (const filePath of files) {
      await this.analyzeFile(filePath, result);
    }

    result.statistics.analyzedFiles = files.length;
  }

  /**
   * 获取所有TypeScript文件
   */
  private getAllTypeScriptFiles(dir: string): string[] {
    const files: string[] = [];

    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isDirectory()) {
        // 跳过node_modules和测试目录
        if (item.name !== 'node_modules' && !item.name.includes('test')) {
          files.push(...this.getAllTypeScriptFiles(fullPath));
        }
      } else if (
        item.isFile() &&
        (item.name.endsWith('.ts') || item.name.endsWith('.tsx'))
      ) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * 分析单个文件
   */
  private async analyzeFile(
    filePath: string,
    result: CompatibilityResult
  ): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      let fileHasIssues = false;

      // 分析导入语句
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        if (this.isImportStatement(line)) {
          const importAnalysis = this.analyzeImportStatement(
            line,
            i + 1,
            filePath
          );

          // 更新统计信息
          result.statistics.importPaths.total++;

          if (importAnalysis.importType === 'relative') {
            result.statistics.importPaths.relative++;
          } else if (importAnalysis.importType === 'absolute') {
            result.statistics.importPaths.absolute++;
          } else if (importAnalysis.importType === 'alias') {
            result.statistics.importPaths.alias++;
          }

          // 检查问题
          if (importAnalysis.issues.length > 0) {
            fileHasIssues = true;
            result.issues.push(...importAnalysis.issues);
          }
        }
      }

      // 检查模块使用
      const moduleUsageIssues = this.analyzeModuleUsage(content, filePath);
      if (moduleUsageIssues.length > 0) {
        fileHasIssues = true;
        result.issues.push(...moduleUsageIssues);
      }

      if (!fileHasIssues) {
        result.statistics.compatibleFiles++;
      }
    } catch (error) {
      logger.error(`分析文件失败: ${filePath}`, { error });
      result.issues.push({
        filePath,
        lineNumber: 0,
        issueType: 'syntax_error',
        severity: 'medium',
        description: `文件分析失败: ${error}`,
        suggestion: '检查文件语法和编码',
        codeSnippet: '',
      });
    }
  }

  /**
   * 判断是否为导入语句
   */
  private isImportStatement(line: string): boolean {
    return (
      line.startsWith('import ') ||
      (line.startsWith('export ') && line.includes('from'))
    );
  }

  /**
   * 分析导入语句
   */
  private analyzeImportStatement(
    line: string,
    lineNumber: number,
    filePath: string
  ): any {
    const analysis = {
      importType: 'unknown' as 'relative' | 'absolute' | 'alias' | 'unknown',
      issues: [] as CompatibilityIssue[],
      path: '',
    };

    try {
      // 提取导入路径
      const importMatch = line.match(/from\s+['"]([^'"]+)['"]/);
      if (!importMatch) return analysis;

      const importPath = importMatch[1];
      analysis.path = importPath;

      // 判断导入类型
      if (importPath.startsWith('@modules/')) {
        analysis.importType = 'alias';
      } else if (importPath.startsWith('./') || importPath.startsWith('../')) {
        analysis.importType = 'relative';

        // 检查相对路径问题
        if (importPath.split('../').length > 3) {
          analysis.issues.push({
            filePath,
            lineNumber,
            issueType: 'import_path',
            severity: 'medium',
            description: `深度相对路径: ${importPath}`,
            suggestion: '考虑使用别名路径 @modules/xxx',
            codeSnippet: line,
          });
        }
      } else if (importPath.startsWith('/') || importPath.startsWith('src/')) {
        analysis.importType = 'absolute';

        analysis.issues.push({
          filePath,
          lineNumber,
          issueType: 'import_path',
          severity: 'high',
          description: `绝对路径: ${importPath}`,
          suggestion: '使用别名路径 @modules/xxx',
          codeSnippet: line,
        });
      } else if (importPath.startsWith('.')) {
        analysis.importType = 'relative';
      }

      // 检查模块是否存在
      if (!this.checkModuleExists(importPath, filePath)) {
        analysis.issues.push({
          filePath,
          lineNumber,
          issueType: 'module_not_found',
          severity: 'high',
          description: `模块可能不存在: ${importPath}`,
          suggestion: '检查模块路径或创建对应的模块定义',
          codeSnippet: line,
        });
      }
    } catch (error) {
      analysis.issues.push({
        filePath,
        lineNumber,
        issueType: 'syntax_error',
        severity: 'medium',
        description: `导入语句分析失败: ${error}`,
        suggestion: '检查导入语句语法',
        codeSnippet: line,
      });
    }

    return analysis;
  }

  /**
   * 检查模块是否存在
   */
  private checkModuleExists(importPath: string, filePath: string): boolean {
    try {
      if (importPath.startsWith('@modules/')) {
        // 检查别名路径对应的模块
        const moduleName = importPath.replace('@modules/', '');

        // 这里可以添加更复杂的模块存在性检查
        // 目前简单返回true，实际项目中需要实现具体逻辑
        return true;
      }

      // 检查相对路径文件是否存在
      if (importPath.startsWith('./') || importPath.startsWith('../')) {
        const dir = path.dirname(filePath);
        const fullPath = path.join(dir, importPath);

        // 检查文件是否存在
        if (
          fs.existsSync(fullPath) ||
          fs.existsSync(fullPath + '.ts') ||
          fs.existsSync(fullPath + '.tsx')
        ) {
          return true;
        }

        // 检查index.ts文件
        const indexPath = path.join(fullPath, 'index.ts');
        if (fs.existsSync(indexPath)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * 分析模块使用情况
   */
  private analyzeModuleUsage(
    content: string,
    filePath: string
  ): CompatibilityIssue[] {
    const issues: CompatibilityIssue[] = [];

    // 检查是否使用了旧的模块导入方式
    const oldPatterns = [
      /require\(['"][^'"]+['"]\)/g, // require语句
      /import\s+\*\s+as/g, // 命名空间导入
      /module\.exports/g, // CommonJS导出
    ];

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of oldPatterns) {
        if (pattern.test(line)) {
          issues.push({
            filePath,
            lineNumber: i + 1,
            issueType: 'syntax_error',
            severity: 'low',
            description: '使用了旧的模块语法',
            suggestion: '使用ES6模块语法和别名路径',
            codeSnippet: line.trim(),
          });
        }
      }
    }

    return issues;
  }

  /**
   * 计算总体兼容性
   */
  private calculateOverallCompatibility(result: CompatibilityResult): void {
    const totalIssues = result.issues.length;
    const totalFiles = result.statistics.totalFiles;

    if (totalFiles === 0) {
      result.overallCompatibility = 'excellent';
      return;
    }

    const issueRate = totalIssues / totalFiles;

    if (issueRate < 0.1) {
      result.overallCompatibility = 'excellent';
    } else if (issueRate < 0.3) {
      result.overallCompatibility = 'good';
    } else if (issueRate < 0.6) {
      result.overallCompatibility = 'fair';
    } else {
      result.overallCompatibility = 'poor';
    }

    result.statistics.issuesCount = totalIssues;
  }

  /**
   * 生成建议
   */
  private generateRecommendations(result: CompatibilityResult): void {
    const { importPaths, totalFiles, compatibleFiles } = result.statistics;

    // 导入路径建议
    if (importPaths.relative > importPaths.alias * 2) {
      result.recommendations.push(
        '建议将更多相对路径转换为别名路径 @modules/xxx'
      );
    }

    if (importPaths.absolute > 0) {
      result.recommendations.push('发现绝对路径导入，建议统一使用别名路径');
    }

    // 兼容性建议
    const compatibilityRate = compatibleFiles / totalFiles;

    if (compatibilityRate < 0.8) {
      result.recommendations.push('项目兼容性较低，建议分批次迁移模块');
    }

    if (result.issues.some((issue) => issue.severity === 'high')) {
      result.recommendations.push('存在高优先级问题，建议优先解决');
    }

    // 通用建议
    result.recommendations.push(
      '使用模块迁移工具进行自动化迁移: bun run modules:migrate'
    );
    result.recommendations.push('参考模块开发规范进行代码重构');
  }

  /**
   * 生成兼容性报告
   */
  generateCompatibilityReport(result: CompatibilityResult): string {
    let report = '# 模块管理系统兼容性报告\n\n';

    report += `## 总体评估\n`;
    report += `- **兼容性等级**: ${this.getCompatibilityEmoji(result.overallCompatibility)} ${result.overallCompatibility}\n`;
    report += `- **分析文件数**: ${result.statistics.analyzedFiles}\n`;
    report += `- **兼容文件数**: ${result.statistics.compatibleFiles}\n`;
    report += `- **发现问题数**: ${result.statistics.issuesCount}\n\n`;

    // 导入路径统计
    report += `## 导入路径分析\n`;
    report += `- **总导入数**: ${result.statistics.importPaths.total}\n`;
    report += `- **相对路径**: ${result.statistics.importPaths.relative} (${this.getPercentage(result.statistics.importPaths.relative, result.statistics.importPaths.total)}%)\n`;
    report += `- **绝对路径**: ${result.statistics.importPaths.absolute} (${this.getPercentage(result.statistics.importPaths.absolute, result.statistics.importPaths.total)}%)\n`;
    report += `- **别名路径**: ${result.statistics.importPaths.alias} (${this.getPercentage(result.statistics.importPaths.alias, result.statistics.importPaths.total)}%)\n\n`;

    // 问题详情
    if (result.issues.length > 0) {
      report += `## 问题详情\n`;

      const issuesByType = this.groupIssuesByType(result.issues);

      for (const [type, issues] of Object.entries(issuesByType)) {
        report += `### ${type}问题 (${issues.length}个)\n`;

        for (const issue of issues.slice(0, 10)) {
          // 只显示前10个
          report += `- **${issue.severity.toUpperCase()}** ${issue.filePath}:${issue.lineNumber} - ${issue.description}\n`;
          report += `  建议: ${issue.suggestion}\n`;
        }

        if (issues.length > 10) {
          report += `- ... 还有 ${issues.length - 10} 个类似问题\n`;
        }

        report += `\n`;
      }
    }

    // 建议
    if (result.recommendations.length > 0) {
      report += `## 改进建议\n`;
      result.recommendations.forEach((rec) => {
        report += `- ${rec}\n`;
      });
      report += `\n`;
    }

    // 行动计划
    report += `## 行动计划\n`;
    report += `1. 运行模块迁移工具: \`bun run modules:migrate\`\n`;
    report += `2. 按照问题优先级进行修复\n`;
    report += `3. 验证修复结果: \`bun run modules:check\`\n`;
    report += `4. 更新相关文档和测试\n`;

    return report;
  }

  /**
   * 按类型分组问题
   */
  private groupIssuesByType(
    issues: CompatibilityIssue[]
  ): Record<string, CompatibilityIssue[]> {
    const groups: Record<string, CompatibilityIssue[]> = {};

    for (const issue of issues) {
      if (!groups[issue.issueType]) {
        groups[issue.issueType] = [];
      }
      groups[issue.issueType].push(issue);
    }

    return groups;
  }

  /**
   * 获取兼容性表情
   */
  private getCompatibilityEmoji(level: string): string {
    switch (level) {
      case 'excellent':
        return '✅';
      case 'good':
        return '⚠️';
      case 'fair':
        return '🔶';
      case 'poor':
        return '❌';
      default:
        return '❓';
    }
  }

  /**
   * 计算百分比
   */
  private getPercentage(part: number, total: number): string {
    if (total === 0) return '0';
    return ((part / total) * 100).toFixed(1);
  }
}

/**
 * 便捷验证函数
 */
export async function validateCompatibility(): Promise<CompatibilityResult> {
  const validator = new CompatibilityValidator();
  return await validator.validateCompatibility();
}

/**
 * 生成兼容性报告
 */
export async function generateCompatibilityReport(): Promise<string> {
  const validator = new CompatibilityValidator();
  const result = await validator.validateCompatibility();
  return validator.generateCompatibilityReport(result);
}

/**
 * 运行兼容性验证
 */
async function runCompatibilityValidation(): Promise<void> {
  logger.info('开始运行兼容性验证...');

  try {
    const validator = new CompatibilityValidator();
    const result = await validator.validateCompatibility();

    logger.info('兼容性验证完成:');
    logger.info(`- 总体兼容性: ${result.overallCompatibility}`);
    logger.info(`- 分析文件数: ${result.statistics.analyzedFiles}`);
    logger.info(`- 兼容文件数: ${result.statistics.compatibleFiles}`);
    logger.info(`- 发现问题数: ${result.statistics.issuesCount}`);

    const report = validator.generateCompatibilityReport(result);

    const fs = require('fs');
    const path = require('path');
    const reportDir = path.join(process.cwd(), 'reports', 'compatibility');
    if (!fs.existsSync(reportDir)) {
      fs.mkdirSync(reportDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const reportPath = path.join(
      reportDir,
      `compatibility-report-${timestamp}.md`
    );
    fs.writeFileSync(reportPath, report);

    logger.info(`\n兼容性报告已保存到: ${reportPath}`);
  } catch (error) {
    logger.error('兼容性验证失败:', { error });
    throw error;
  }
}

export { runCompatibilityValidation };

if (require.main === module) {
  runCompatibilityValidation().catch((e) =>
    logger.error('兼容性验证失败:', { error: e })
  );
}
