/**
 * 错误提示优化模块
 * 提供更清晰的错误提示和错误解决方案建议
 */

import { logger } from './log.js';

export interface ErrorSolution {
  title: string;
  description: string;
  command?: string;
  docsUrl?: string;
  priority: number;
}

export interface ErrorContext {
  error: Error;
  component?: string;
  operation?: string;
  metadata?: Record<string, unknown>;
}

interface ErrorPattern {
  pattern: RegExp;
  errorType: string;
  title: string;
  description: string;
  solutions: ErrorSolution[];
  relatedErrors?: string[];
}

export class ErrorHintManager {
  private patterns: ErrorPattern[] = [];
  private customPatterns: ErrorPattern[] = [];

  constructor() {
    this.registerDefaultPatterns();
  }

  /**
   * 注册默认错误模式
   */
  private registerDefaultPatterns(): void {
    this.patterns = [
      {
        pattern: /ECONNREFUSED/i,
        errorType: 'ConnectionError',
        title: '连接被拒绝',
        description:
          '无法连接到服务器。这通常是因为服务器未启动或网络连接问题。',
        solutions: [
          {
            title: '检查服务器状态',
            description: '确认目标服务器正在运行且可访问',
            priority: 1,
          },
          {
            title: '检查网络连接',
            description: '确认您的网络连接正常，可以访问目标服务器',
            command: 'ping <host>',
            priority: 2,
          },
          {
            title: '检查端口配置',
            description: '确认端口号配置正确且服务器正在监听该端口',
            priority: 3,
          },
        ],
        relatedErrors: ['ENOTFOUND', 'ETIMEDOUT', 'ENETUNREACH'],
      },
      {
        pattern: /ENOTFOUND/i,
        errorType: 'DNSError',
        title: 'DNS解析失败',
        description: '无法解析主机名。这通常是因为域名拼写错误或DNS配置问题。',
        solutions: [
          {
            title: '检查域名拼写',
            description: '确认域名拼写正确，没有多余的空格或特殊字符',
            priority: 1,
          },
          {
            title: '检查网络连接',
            description: '确认您的网络连接正常',
            command: 'nslookup <hostname>',
            priority: 2,
          },
          {
            title: '尝试使用IP地址',
            description: '如果域名无法解析，尝试使用服务器的IP地址',
            priority: 3,
          },
        ],
      },
      {
        pattern: /ETIMEDOUT/i,
        errorType: 'TimeoutError',
        title: '连接超时',
        description: '连接尝试超时。这通常是因为网络延迟或服务器响应过慢。',
        solutions: [
          {
            title: '检查网络延迟',
            description: '使用ping命令检查网络延迟是否过高',
            command: 'ping <host>',
            priority: 1,
          },
          {
            title: '增加超时时间',
            description: '如果是程序配置问题，尝试增加超时时间设置',
            priority: 2,
          },
          {
            title: '检查防火墙设置',
            description: '确认防火墙没有阻止连接',
            priority: 3,
          },
        ],
      },
      {
        pattern: /EACCES|PERMISSION_DENIED/i,
        errorType: 'PermissionError',
        title: '权限被拒绝',
        description: '您没有执行此操作的权限。',
        solutions: [
          {
            title: '检查文件权限',
            description: '确认您对相关文件有读写权限',
            command: 'ls -la <path>',
            priority: 1,
          },
          {
            title: '使用管理员权限',
            description: '如果需要管理员权限，使用sudo或以管理员身份运行',
            command: 'sudo <command>',
            priority: 2,
          },
          {
            title: '检查所有者',
            description: '确认文件的所有者是正确的用户',
            command: 'chown <user>:<group> <path>',
            priority: 3,
          },
        ],
      },
      {
        pattern: /ENOENT|NOT_FOUND/i,
        errorType: 'FileNotFoundError',
        title: '文件或目录不存在',
        description: '找不到指定的文件或目录。',
        solutions: [
          {
            title: '检查路径拼写',
            description: '确认文件路径拼写正确',
            priority: 1,
          },
          {
            title: '检查文件是否存在',
            description: '确认文件或目录确实存在',
            command: 'ls -la <path>',
            priority: 2,
          },
          {
            title: '检查当前目录',
            description: '确认您在正确的工作目录中',
            command: 'pwd',
            priority: 3,
          },
        ],
      },
      {
        pattern: /EEXIST|ALREADY_EXISTS/i,
        errorType: 'FileExistsError',
        title: '文件或目录已存在',
        description: '尝试创建的文件或目录已经存在。',
        solutions: [
          {
            title: '使用不同名称',
            description: '尝试使用不同的文件名或目录名',
            priority: 1,
          },
          {
            title: '删除现有文件',
            description: '如果不需要保留现有文件，先删除它',
            command: 'rm <path>',
            priority: 2,
          },
          {
            title: '使用覆盖选项',
            description: '如果工具有覆盖选项，使用它来覆盖现有文件',
            priority: 3,
          },
        ],
      },
      {
        pattern: /ENOSPC|DISK_FULL/i,
        errorType: 'DiskFullError',
        title: '磁盘空间不足',
        description: '磁盘空间不足，无法写入数据。',
        solutions: [
          {
            title: '检查磁盘空间',
            description: '查看磁盘使用情况',
            command: 'df -h',
            priority: 1,
          },
          {
            title: '清理不需要的文件',
            description: '删除临时文件、缓存文件等不需要的文件',
            command: 'rm -rf /tmp/*',
            priority: 2,
          },
          {
            title: '扩展磁盘空间',
            description: '如果使用的是云存储，考虑扩展磁盘容量',
            priority: 3,
          },
        ],
      },
      {
        pattern: /EBUSY|RESOURCE_BUSY/i,
        errorType: 'ResourceBusyError',
        title: '资源忙',
        description: '文件或资源正被其他程序使用，无法访问。',
        solutions: [
          {
            title: '关闭其他程序',
            description: '关闭可能正在使用该资源的其他程序',
            priority: 1,
          },
          {
            title: '等待资源释放',
            description: '如果是临时问题，等待其他程序完成操作',
            priority: 2,
          },
          {
            title: '强制释放',
            description: '如果是进程挂起，尝试终止相关进程',
            command: 'kill -9 <pid>',
            priority: 3,
          },
        ],
      },
      {
        pattern: /VALIDATION_ERROR|INVALID_INPUT/i,
        errorType: 'ValidationError',
        title: '输入验证失败',
        description: '提供的输入参数不符合要求。',
        solutions: [
          {
            title: '检查输入格式',
            description: '确认输入格式正确，符合API或工具的要求',
            priority: 1,
          },
          {
            title: '查看文档',
            description: '查阅相关文档了解正确的输入格式',
            priority: 2,
          },
          {
            title: '使用示例',
            description: '参考已有的正确示例来修正输入',
            priority: 3,
          },
        ],
      },
      {
        pattern: /TIMEOUT|REQUEST_TIMEOUT/i,
        errorType: 'RequestTimeoutError',
        title: '请求超时',
        description: '请求在规定时间内没有完成。',
        solutions: [
          {
            title: '增加超时时间',
            description: '如果适用，增加请求的超时时间限制',
            priority: 1,
          },
          {
            title: '简化请求',
            description: '如果是大型查询，尝试简化请求内容',
            priority: 2,
          },
          {
            title: '检查服务端状态',
            description: '确认服务端正常运行，没有性能问题',
            priority: 3,
          },
        ],
      },
      {
        pattern: /UNAUTHORIZED| AUTHENTICATION/i,
        errorType: 'AuthenticationError',
        title: '认证失败',
        description: '提供的凭证无效或已过期。',
        solutions: [
          {
            title: '检查凭证',
            description: '确认使用的API密钥或密码是正确的',
            priority: 1,
          },
          {
            title: '重新获取凭证',
            description: '如果凭证过期，从服务提供商重新获取',
            priority: 2,
          },
          {
            title: '检查权限范围',
            description: '确认凭证具有所需操作的权限',
            priority: 3,
          },
        ],
      },
      {
        pattern: /RATE_LIMIT|TOO_MANY_REQUESTS/i,
        errorType: 'RateLimitError',
        title: '请求频率超限',
        description: '请求频率超过了服务限制。',
        solutions: [
          {
            title: '降低请求频率',
            description: '在请求之间添加延迟，避免过快发送请求',
            priority: 1,
          },
          {
            title: '使用批量请求',
            description: '如果支持批量操作，使用批量请求代替多个单独请求',
            priority: 2,
          },
          {
            title: '等待冷却期',
            description: '如果是严格限制，等待一段时间后再试',
            priority: 3,
          },
        ],
      },
    ];
  }

  /**
   * 注册自定义错误模式
   */
  registerPattern(pattern: ErrorPattern): void {
    this.customPatterns.push(pattern);
  }

  /**
   * 获取错误提示
   */
  getErrorHint(
    error: Error | string,
    context?: ErrorContext
  ): {
    errorType: string;
    title: string;
    description: string;
    solutions: ErrorSolution[];
    relatedErrors?: string[];
  } | null {
    const errorString = typeof error === 'string' ? error : error.message;
    const errorStack = typeof error === 'string' ? '' : error.stack || '';

    // 优先匹配自定义模式
    for (const pattern of this.customPatterns) {
      if (
        pattern.pattern.test(errorString) ||
        pattern.pattern.test(errorStack)
      ) {
        return {
          errorType: pattern.errorType,
          title: pattern.title,
          description: pattern.description,
          solutions: pattern.solutions.sort((a, b) => a.priority - b.priority),
          relatedErrors: pattern.relatedErrors,
        };
      }
    }

    // 匹配默认模式
    for (const pattern of this.patterns) {
      if (
        pattern.pattern.test(errorString) ||
        pattern.pattern.test(errorStack)
      ) {
        return {
          errorType: pattern.errorType,
          title: pattern.title,
          description: pattern.description,
          solutions: pattern.solutions.sort((a, b) => a.priority - b.priority),
          relatedErrors: pattern.relatedErrors,
        };
      }
    }

    // 未匹配到已知错误模式
    return null;
  }

  /**
   * 格式化错误提示
   */
  formatErrorHint(error: Error | string, context?: ErrorContext): string {
    const hint = this.getErrorHint(error, context);

    if (!hint) {
      const errorMessage = typeof error === 'string' ? error : error.message;
      return `发生未知错误: ${errorMessage}`;
    }

    const lines: string[] = [];
    lines.push('━'.repeat(60));
    lines.push(`❌ ${hint.title}`);
    lines.push('━'.repeat(60));
    lines.push('');
    lines.push(`错误类型: ${hint.errorType}`);
    lines.push('');
    lines.push('📝 描述:');
    lines.push(`   ${hint.description}`);
    lines.push('');

    if (hint.solutions.length > 0) {
      lines.push('🔧 解决方案:');
      hint.solutions.forEach((solution, index) => {
        lines.push(`   ${index + 1}. ${solution.title}`);
        lines.push(`      ${solution.description}`);
        if (solution.command) {
          lines.push(`      命令: ${solution.command}`);
        }
        if (solution.docsUrl) {
          lines.push(`      文档: ${solution.docsUrl}`);
        }
        lines.push('');
      });
    }

    if (hint.relatedErrors && hint.relatedErrors.length > 0) {
      lines.push('🔗 相关错误:');
      lines.push(`   ${hint.relatedErrors.join(', ')}`);
      lines.push('');
    }

    lines.push('━'.repeat(60));

    return lines.join('\n');
  }

  /**
   * 获取所有已注册的错误模式
   */
  getRegisteredPatterns(): { errorType: string; title: string }[] {
    return [
      ...this.patterns.map((p) => ({ errorType: p.errorType, title: p.title })),
      ...this.customPatterns.map((p) => ({
        errorType: p.errorType,
        title: p.title,
      })),
    ];
  }

  /**
   * 记录错误并输出提示
   */
  logErrorWithHint(error: Error | string, context?: ErrorContext): void {
    const hintMessage = this.formatErrorHint(error, context);
    const errorMessage = typeof error === 'string' ? error : error.message;

    logger.error(`Error occurred: ${errorMessage}`);
    console.log('\n' + hintMessage);
  }
}

/**
 * 全局错误提示管理器实例
 */
export const errorHintManager = new ErrorHintManager();

/**
 * 格式化错误并输出提示的辅助函数
 */
export function formatError(
  error: Error | string,
  context?: ErrorContext
): string {
  return errorHintManager.formatErrorHint(error, context);
}

/**
 * 记录错误并输出提示的辅助函数
 */
export function logErrorWithHint(
  error: Error | string,
  context?: ErrorContext
): void {
  errorHintManager.logErrorWithHint(error, context);
}
