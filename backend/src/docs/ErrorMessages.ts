/**
 * 错误消息管理器
 * 管理错误代码、消息和解决建议
 */

import { ErrorMessageEntry } from './types.js';

/**
 * 默认错误消息
 */
const DEFAULT_ERROR_MESSAGES: ErrorMessageEntry[] = [
  {
    code: 'CONFIG_NOT_FOUND',
    message: '配置文件未找到',
    description: '系统无法找到所需的配置文件',
    suggestions: [
      '检查配置文件路径是否正确',
      '使用默认配置初始化系统',
      '重新创建配置文件',
    ],
    references: ['docs/config.md'],
    severity: 'medium',
  },
  {
    code: 'CONFIG_PARSE_ERROR',
    message: '配置文件解析错误',
    description: '配置文件格式不正确，无法解析',
    suggestions: [
      '检查配置文件的 JSON 格式',
      '使用 JSON 验证工具检查语法',
      '恢复配置文件到默认状态',
    ],
    references: ['docs/config.md'],
    severity: 'high',
  },
  {
    code: 'NETWORK_ERROR',
    message: '网络连接错误',
    description: '无法连接到网络或网络请求失败',
    suggestions: [
      '检查网络连接是否正常',
      '检查防火墙设置',
      '稍后重试',
    ],
    references: ['docs/network.md'],
    severity: 'medium',
  },
  {
    code: 'PERMISSION_DENIED',
    message: '权限不足',
    description: '当前用户没有执行此操作的权限',
    suggestions: [
      '检查文件或目录的权限设置',
      '使用管理员权限运行',
      '联系系统管理员',
    ],
    references: ['docs/permissions.md'],
    severity: 'high',
  },
  {
    code: 'FILE_NOT_FOUND',
    message: '文件未找到',
    description: '系统无法找到指定的文件',
    suggestions: [
      '检查文件路径是否正确',
      '确认文件是否存在',
      '检查文件权限',
    ],
    references: ['docs/files.md'],
    severity: 'medium',
  },
  {
    code: 'VALIDATION_ERROR',
    message: '数据验证错误',
    description: '输入的数据不符合要求',
    suggestions: [
      '检查输入数据的格式',
      '查看字段的验证规则',
      '确保所有必填字段都已填写',
    ],
    references: ['docs/validation.md'],
    severity: 'low',
  },
  {
    code: 'TIMEOUT_ERROR',
    message: '操作超时',
    description: '操作在指定时间内未完成',
    suggestions: [
      '检查网络连接',
      '增加超时时间',
      '稍后重试',
    ],
    references: ['docs/performance.md'],
    severity: 'medium',
  },
  {
    code: 'UNKNOWN_ERROR',
    message: '未知错误',
    description: '发生了未知的错误',
    suggestions: [
      '查看错误日志获取详细信息',
      '重启应用程序',
      '联系技术支持',
    ],
    references: ['docs/troubleshooting.md'],
    severity: 'critical',
  },
];

/**
 * 错误消息管理器类
 */
export class ErrorMessages {
  private errors: Map<string, ErrorMessageEntry> = new Map();

  /**
   * 构造函数
   */
  constructor() {
    // 加载默认错误消息
    for (const error of DEFAULT_ERROR_MESSAGES) {
      this.errors.set(error.code, error);
    }
  }

  /**
   * 注册错误消息
   * @param error 错误消息条目
   */
  registerError(error: ErrorMessageEntry): void {
    this.errors.set(error.code, error);
  }

  /**
   * 获取错误消息
   * @param code 错误代码
   * @returns 错误消息条目或undefined
   */
  getError(code: string): ErrorMessageEntry | undefined {
    return this.errors.get(code);
  }

  /**
   * 获取错误消息文本
   * @param code 错误代码
   * @returns 错误消息文本
   */
  getErrorMessage(code: string): string {
    const error = this.errors.get(code);
    return error?.message || `未知错误: ${code}`;
  }

  /**
   * 获取错误描述
   * @param code 错误代码
   * @returns 错误描述
   */
  getErrorDescription(code: string): string {
    const error = this.errors.get(code);
    return error?.description || '未提供错误描述';
  }

  /**
   * 获取解决建议
   * @param code 错误代码
   * @returns 解决建议数组
   */
  getSuggestions(code: string): string[] {
    const error = this.errors.get(code);
    return error?.suggestions || ['请联系技术支持'];
  }

  /**
   * 获取参考链接
   * @param code 错误代码
   * @returns 参考链接数组
   */
  getReferences(code: string): string[] {
    const error = this.errors.get(code);
    return error?.references || [];
  }

  /**
   * 获取所有错误消息
   * @returns 错误消息数组
   */
  getAllErrors(): ErrorMessageEntry[] {
    return Array.from(this.errors.values());
  }

  /**
   * 按严重程度获取错误消息
   * @param severity 严重程度
   * @returns 错误消息数组
   */
  getErrorsBySeverity(
    severity: 'low' | 'medium' | 'high' | 'critical'
  ): ErrorMessageEntry[] {
    return this.getAllErrors().filter((error) => error.severity === severity);
  }

  /**
   * 搜索错误消息
   * @param query 搜索关键词
   * @returns 匹配的错误消息数组
   */
  searchErrors(query: string): ErrorMessageEntry[] {
    const lowerQuery = query.toLowerCase();
    return this.getAllErrors().filter(
      (error) =>
        error.code.toLowerCase().includes(lowerQuery) ||
        error.message.toLowerCase().includes(lowerQuery) ||
        error.description.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * 格式化错误消息
   * @param code 错误代码
   * @param details 额外详情
   * @returns 格式化错误消息
   */
  formatError(code: string, details?: string): string {
    const error = this.errors.get(code);
    if (!error) {
      return `错误: ${code}${details ? `\n详情: ${details}` : ''}`;
    }

    const lines = [
      `错误 [${error.code}]: ${error.message}`,
      `描述: ${error.description}`,
      `严重程度: ${this.getSeverityLabel(error.severity)}`,
    ];

    if (details) {
      lines.push(`详情: ${details}`);
    }

    if (error.suggestions.length > 0) {
      lines.push('', '解决建议:');
      error.suggestions.forEach((suggestion, index) => {
        lines.push(`  ${index + 1}. ${suggestion}`);
      });
    }

    if (error.references.length > 0) {
      lines.push('', '参考文档:');
      error.references.forEach((ref) => {
        lines.push(`  - ${ref}`);
      });
    }

    return lines.join('\n');
  }

  /**
   * 获取严重程度标签
   * @param severity 严重程度
   * @returns 严重程度标签
   */
  private getSeverityLabel(severity: string): string {
    const labels: Record<string, string> = {
      low: '低',
      medium: '中',
      high: '高',
      critical: '严重',
    };
    return labels[severity] || severity;
  }

  /**
   * 删除错误消息
   * @param code 错误代码
   */
  removeError(code: string): void {
    this.errors.delete(code);
  }

  /**
   * 清除所有错误消息
   */
  clearErrors(): void {
    this.errors.clear();
  }

  /**
   * 获取错误消息数量
   * @returns 错误消息数量
   */
  getErrorCount(): number {
    return this.errors.size;
  }

  /**
   * 检查错误代码是否存在
   * @param code 错误代码
   * @returns 是否存在
   */
  hasError(code: string): boolean {
    return this.errors.has(code);
  }
}

// 导出单例实例
export const errorMessages = new ErrorMessages();
