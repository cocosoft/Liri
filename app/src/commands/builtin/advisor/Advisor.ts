/**
 * Advisor命令
 * 提供代码建议和优化建议
 */
import type { CommandContext } from '@modules/commands';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'commands:builtin:advisor:Advisor',
  level: LogLevel.INFO,
});

interface AnalysisResult {
  type: 'text';
  value: string;
}

/**
 * Advisor命令实现
 */
const advisorCommand = {
  /**
   * 执行命令
   * @param args - 命令参数
   * @param context - 命令上下文
   */
  async call(args: string, context: CommandContext): Promise<AnalysisResult> {
    const params = args.trim().split(' ');
    const command = params[0];
    const target = params.slice(1).join(' ');

    switch (command) {
      case 'code':
        return this.analyzeCode(target);
      case 'performance':
        return this.analyzePerformance(target);
      case 'security':
        return this.analyzeSecurity(target);
      default:
        return this.showHelp();
    }
  },

  /**
   * 显示帮助信息
   */
  showHelp(): AnalysisResult {
    return {
      type: 'text',
      value:
        '用法: /advisor <命令> [目标]\n\n命令列表:\n  code - 分析代码质量\n  performance - 分析性能\n  security - 分析安全性\n\n示例: /advisor code ./src/index.ts',
    };
  },

  /**
   * 分析代码质量
   * @param target - 目标文件路径
   */
  async analyzeCode(target: string): Promise<AnalysisResult> {
    if (!target) {
      return {
        type: 'text',
        value: '用法: /advisor code <文件路径>\n分析指定文件的代码质量',
      };
    }

    try {
      const fs = await import('fs');
      const path = await import('path');

      const fullPath = path.resolve(target);

      if (!fs.existsSync(fullPath)) {
        return {
          type: 'text',
          value: `错误: 文件 ${fullPath} 不存在`,
        };
      }

      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        return this.analyzeDirectoryCode(fullPath, fs, path);
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      return this.analyzeFileCode(fullPath, content);
    } catch (error) {
      return {
        type: 'text',
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 分析目录中的代码
   */
  analyzeDirectoryCode(
    dirPath: string,
    fs: typeof import('fs'),
    path: typeof import('path')
  ): AnalysisResult {
    const files: string[] = [];
    const fileExtensions = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs'];

    const traverse = (currentPath: string) => {
      const items = fs.readdirSync(currentPath);
      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          if (!item.startsWith('.') && !item.includes('node_modules')) {
            traverse(fullPath);
          }
        } else if (fileExtensions.some((ext) => item.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };

    traverse(dirPath);

    let totalLines = 0;
    let totalFunctions = 0;
    let totalClasses = 0;

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      totalLines += content.split('\n').length;
      totalFunctions += (
        content.match(/function\s+\w+|const\s+\w+\s*=\s*\(/) || []
      ).length;
      totalClasses += (content.match(/class\s+\w+/) || []).length;
    }

    return {
      type: 'text',
      value: `代码分析结果:\n\n目录: ${dirPath}\n文件数: ${files.length}\n总行数: ${totalLines}\n函数数: ${totalFunctions}\n类数: ${totalClasses}\n\n建议:\n- 考虑添加更多注释\n- 检查是否有未使用的变量\n- 优化代码结构，提高可读性\n- 考虑使用代码格式化工具`,
    };
  },

  /**
   * 分析单个文件的代码
   */
  analyzeFileCode(filePath: string, content: string): AnalysisResult {
    const lines = content.split('\n');
    const lineCount = lines.length;
    const functionCount = (
      content.match(/function\s+\w+|const\s+\w+\s*=\s*\(/) || []
    ).length;
    const classCount = (content.match(/class\s+\w+/) || []).length;
    const commentCount = (content.match(/\/\/.*$|\/\*[\s\S]*?\*\//gm) || [])
      .length;
    const commentRatio =
      lineCount > 0 ? ((commentCount / lineCount) * 100).toFixed(1) : '0';

    // 检测潜在问题
    const issues: string[] = [];

    if (content.includes('eval(')) {
      issues.push('- 发现 eval() 使用，可能存在安全风险');
    }
    if (content.includes('var ')) {
      issues.push('- 发现 var 声明，建议使用 let/const');
    }
    if (content.includes('console.log(')) {
      issues.push('- 发现 console.log，建议移除或使用日志框架');
    }

    const issuesText =
      issues.length > 0 ? `\n发现的问题:\n${issues.join('\n')}` : '';

    return {
      type: 'text',
      value: `代码分析结果:\n\n文件: ${filePath}\n行数: ${lineCount}\n函数数: ${functionCount}\n类数: ${classCount}\n注释数: ${commentCount} (${commentRatio}%)${issuesText}\n\n建议:\n- 考虑添加更多注释\n- 检查是否有未使用的变量\n- 优化代码结构，提高可读性`,
    };
  },

  /**
   * 分析性能
   * @param target - 目标文件路径
   */
  async analyzePerformance(target: string): Promise<AnalysisResult> {
    if (!target) {
      return {
        type: 'text',
        value: '用法: /advisor performance <文件路径>\n分析指定文件的性能',
      };
    }

    try {
      const fs = await import('fs');
      const path = await import('path');

      const fullPath = path.resolve(target);

      if (!fs.existsSync(fullPath)) {
        return {
          type: 'text',
          value: `错误: 文件或目录 ${fullPath} 不存在`,
        };
      }

      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        return this.analyzeDirectoryPerformance(fullPath, fs, path);
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      return this.analyzeFilePerformance(fullPath, content);
    } catch (error) {
      return {
        type: 'text',
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 分析目录性能
   */
  analyzeDirectoryPerformance(
    dirPath: string,
    fs: typeof import('fs'),
    path: typeof import('path')
  ): AnalysisResult {
    const files: string[] = [];
    const fileExtensions = ['.ts', '.tsx', '.js', '.jsx'];

    const traverse = (currentPath: string) => {
      const items = fs.readdirSync(currentPath);
      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          if (!item.startsWith('.') && !item.includes('node_modules')) {
            traverse(fullPath);
          }
        } else if (fileExtensions.some((ext) => item.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };

    traverse(dirPath);

    let totalLines = 0;
    let bigFiles = 0;

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').length;
      totalLines += lines;
      if (lines > 500) {
        bigFiles++;
      }
    }

    return {
      type: 'text',
      value: `性能分析结果:\n\n目录: ${dirPath}\n文件数: ${files.length}\n总行数: ${totalLines}\n大型文件(>500行): ${bigFiles}\n\n性能建议:\n- 避免频繁的DOM操作\n- 使用适当的缓存策略\n- 优化循环和递归\n- 考虑使用Web Workers处理 heavy tasks\n- 将大型文件拆分为更小的模块\n- 使用懒加载和代码分割`,
    };
  },

  /**
   * 分析单个文件性能
   */
  analyzeFilePerformance(filePath: string, content: string): AnalysisResult {
    const lines = content.split('\n');
    const lineCount = lines.length;

    // 检测潜在性能问题
    const issues: string[] = [];
    const suggestions: string[] = [];

    // 检测嵌套循环
    let maxNesting = 0;
    let currentNesting = 0;
    for (const line of lines) {
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      currentNesting += openBraces - closeBraces;
      maxNesting = Math.max(maxNesting, currentNesting);
    }
    if (maxNesting > 3) {
      issues.push(`- 发现深度嵌套(${maxNesting}层)，可能影响性能`);
      suggestions.push('- 考虑使用函数分解减少嵌套深度');
    }

    // 检测重复代码模式
    if ((content.match(/for\s*\(/g) || []).length > 5) {
      suggestions.push('- 考虑使用数组方法(map/filter/reduce)替代循环');
    }

    // 检测潜在的内存泄漏
    if (content.includes('setInterval(')) {
      issues.push('- 发现 setInterval，确保有对应的 clearInterval');
    }

    // 检测同步操作
    if (
      content.includes('fs.readFileSync') ||
      content.includes('fs.writeFileSync')
    ) {
      issues.push('- 发现同步文件操作，考虑使用异步版本');
    }

    const issuesText =
      issues.length > 0 ? `\n发现的潜在问题:\n${issues.join('\n')}` : '';
    const suggestionsText =
      suggestions.length > 0 ? `\n优化建议:\n${suggestions.join('\n')}` : '';

    return {
      type: 'text',
      value: `性能分析结果:\n\n文件: ${filePath}\n行数: ${lineCount}\n最大嵌套深度: ${maxNesting}层${issuesText}${suggestionsText}\n\n通用建议:\n- 避免频繁的DOM操作\n- 使用适当的缓存策略\n- 优化循环和递归\n- 考虑使用Web Workers处理 heavy tasks`,
    };
  },

  /**
   * 分析安全性
   * @param target - 目标文件路径
   */
  async analyzeSecurity(target: string): Promise<AnalysisResult> {
    if (!target) {
      return {
        type: 'text',
        value: '用法: /advisor security <文件路径>\n分析指定文件的安全性',
      };
    }

    try {
      const fs = await import('fs');
      const path = await import('path');

      const fullPath = path.resolve(target);

      if (!fs.existsSync(fullPath)) {
        return {
          type: 'text',
          value: `错误: 文件或目录 ${fullPath} 不存在`,
        };
      }

      const stats = fs.statSync(fullPath);

      if (stats.isDirectory()) {
        return this.analyzeDirectorySecurity(fullPath, fs, path);
      }

      const content = fs.readFileSync(fullPath, 'utf8');
      return this.analyzeFileSecurity(fullPath, content);
    } catch (error) {
      return {
        type: 'text',
        value: `错误: ${error instanceof Error ? error.message : '未知错误'}`,
      };
    }
  },

  /**
   * 分析目录安全性
   */
  analyzeDirectorySecurity(
    dirPath: string,
    fs: typeof import('fs'),
    path: typeof import('path')
  ): AnalysisResult {
    const files: string[] = [];
    const fileExtensions = ['.ts', '.tsx', '.js', '.jsx', '.env', '.json'];

    const traverse = (currentPath: string) => {
      const items = fs.readdirSync(currentPath);
      for (const item of items) {
        const fullPath = path.join(currentPath, item);
        const stats = fs.statSync(fullPath);

        if (stats.isDirectory()) {
          if (!item.startsWith('.') && !item.includes('node_modules')) {
            traverse(fullPath);
          }
        } else if (fileExtensions.some((ext) => item.endsWith(ext))) {
          files.push(fullPath);
        }
      }
    };

    traverse(dirPath);

    let securityIssues = 0;
    const findings: string[] = [];

    for (const filePath of files) {
      const content = fs.readFileSync(filePath, 'utf8');

      // 检测敏感信息
      if (filePath.endsWith('.env')) {
        securityIssues++;
        findings.push(`- ${filePath}: 环境变量文件，确保不提交到版本控制`);
      }

      if (
        content.includes('password') ||
        content.includes('secret') ||
        content.includes('apiKey')
      ) {
        securityIssues++;
        findings.push(`- ${filePath}: 可能包含敏感信息`);
      }
    }

    const findingsText =
      findings.length > 0 ? `\n安全发现:\n${findings.join('\n')}` : '';

    return {
      type: 'text',
      value: `安全性分析结果:\n\n目录: ${dirPath}\n文件数: ${files.length}\n发现问题数: ${securityIssues}${findingsText}\n\n安全建议:\n- 避免使用eval()\n- 验证所有用户输入\n- 使用HTTPS\n- 避免硬编码敏感信息\n- 实施适当的权限控制\n- 使用环境变量存储敏感配置`,
    };
  },

  /**
   * 分析单个文件安全性
   */
  analyzeFileSecurity(filePath: string, content: string): AnalysisResult {
    // 检测安全问题
    const issues: string[] = [];
    const warnings: string[] = [];

    // 检测 eval
    if (content.includes('eval(')) {
      issues.push('- 使用 eval() 存在代码注入风险');
    }

    // 检测硬编码的敏感信息
    const sensitivePatterns = [
      /password\s*[=:]\s*['"][^'"]+['"]/gi,
      /secret\s*[=:]\s*['"][^'"]+['"]/gi,
      /api[_-]?key\s*[=:]\s*['"][^'"]+['"]/gi,
      /token\s*[=:]\s*['"][^'"]+['"]/gi,
    ];

    for (const pattern of sensitivePatterns) {
      if (pattern.test(content)) {
        issues.push('- 发现潜在的硬编码敏感信息');
        break;
      }
    }

    // 检测 SQL 注入风险
    if (content.includes('SELECT') && content.includes('+')) {
      warnings.push('- 可能存在 SQL 字符串拼接，建议使用参数化查询');
    }

    // 检测 XSS 风险
    if (content.includes('innerHTML') || content.includes('document.write')) {
      warnings.push('- 发现 innerHTML/document.write，可能存在 XSS 风险');
    }

    // 检测未验证的用户输入
    if (content.includes('req.body') || content.includes('params.')) {
      warnings.push('- 建议验证和清理用户输入');
    }

    const issuesText =
      issues.length > 0 ? `\n严重问题:\n${issues.join('\n')}` : '';
    const warningsText =
      warnings.length > 0 ? `\n警告:\n${warnings.join('\n')}` : '';

    return {
      type: 'text',
      value: `安全性分析结果:\n\n文件: ${filePath}${issuesText}${warningsText}\n\n安全建议:\n- 避免使用eval()\n- 验证所有用户输入\n- 使用HTTPS\n- 避免硬编码敏感信息\n- 实施适当的权限控制\n- 使用参数化查询防止SQL注入`,
    };
  },
};

export default advisorCommand;
