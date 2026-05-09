/**
 * 错误消息管理
 *
 * 提供详细的错误消息和处理建议
 */

import { ErrorCategory, ErrorSeverity, AppError } from './types';

/**
 * 错误消息接口
 */
export interface ErrorMessage {
  code: string;
  message: string;
  description: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  suggestedActions: string[];
  documentationUrl?: string;
}

/**
 * 错误消息映射
 */
const errorMessages: Record<string, ErrorMessage> = {
  // 网络错误
  NETWORK_TIMEOUT: {
    code: 'NETWORK_TIMEOUT',
    message: '网络请求超时',
    description: '与服务器的连接超时，可能是网络不稳定或服务器响应缓慢',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查网络连接是否稳定',
      '稍后重试请求',
      '如果问题持续，请联系网络管理员',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/network-timeout',
  },
  NETWORK_CONNECTION: {
    code: 'NETWORK_CONNECTION',
    message: '网络连接失败',
    description: '无法建立网络连接，可能是网络中断或服务器不可用',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.HIGH,
    suggestedActions: [
      '检查网络连接是否正常',
      '确认服务器是否可以访问',
      '如果使用代理，请检查代理设置',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/network-connection',
  },
  NETWORK_AUTH: {
    code: 'NETWORK_AUTH',
    message: '网络认证失败',
    description: '服务器认证失败，可能是API密钥无效或权限不足',
    category: ErrorCategory.NETWORK,
    severity: ErrorSeverity.HIGH,
    suggestedActions: [
      '检查API密钥是否正确',
      '确认您有足够的权限执行此操作',
      '联系服务提供商获取帮助',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/network-auth',
  },

  // 文件系统错误
  FILE_NOT_FOUND: {
    code: 'FILE_NOT_FOUND',
    message: '文件未找到',
    description: '指定的文件不存在',
    category: ErrorCategory.FILESYSTEM,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查文件路径是否正确',
      '确认文件是否存在',
      '如果文件应该存在，请检查权限设置',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/file-not-found',
  },
  FILE_PERMISSION: {
    code: 'FILE_PERMISSION',
    message: '文件权限错误',
    description: '没有权限访问或修改指定的文件',
    category: ErrorCategory.FILESYSTEM,
    severity: ErrorSeverity.HIGH,
    suggestedActions: [
      '检查文件权限设置',
      '以管理员身份运行应用',
      '修改文件权限以允许访问',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/file-permission',
  },
  FILE_WRITE: {
    code: 'FILE_WRITE',
    message: '文件写入失败',
    description: '无法写入文件，可能是磁盘空间不足或权限问题',
    category: ErrorCategory.FILESYSTEM,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查磁盘空间是否足够',
      '确认文件权限是否正确',
      '尝试使用不同的文件路径',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/file-write',
  },

  // 权限错误
  PERMISSION_DENIED: {
    code: 'PERMISSION_DENIED',
    message: '权限被拒绝',
    description: '没有足够的权限执行此操作',
    category: ErrorCategory.PERMISSION,
    severity: ErrorSeverity.HIGH,
    suggestedActions: [
      '检查您的权限设置',
      '以管理员身份运行应用',
      '联系系统管理员获取帮助',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/permission-denied',
  },
  PERMISSION_INVALID: {
    code: 'PERMISSION_INVALID',
    message: '无效的权限',
    description: '指定的权限无效或已过期',
    category: ErrorCategory.PERMISSION,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查权限设置是否正确',
      '重新获取有效的权限',
      '联系系统管理员获取帮助',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/permission-invalid',
  },

  // 验证错误
  VALIDATION_FAILED: {
    code: 'VALIDATION_FAILED',
    message: '验证失败',
    description: '输入数据验证失败',
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.LOW,
    suggestedActions: [
      '检查输入数据是否符合要求',
      '确保所有必填字段都已填写',
      '按照错误提示修正输入',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/validation-failed',
  },
  CONFIG_INVALID: {
    code: 'CONFIG_INVALID',
    message: '配置无效',
    description: '配置文件无效或格式错误',
    category: ErrorCategory.VALIDATION,
    severity: ErrorSeverity.HIGH,
    suggestedActions: [
      '检查配置文件格式是否正确',
      '确保所有必需的配置项都已设置',
      '使用默认配置重置',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/config-invalid',
  },

  // 执行错误
  EXECUTION_FAILED: {
    code: 'EXECUTION_FAILED',
    message: '执行失败',
    description: '命令或操作执行失败',
    category: ErrorCategory.EXECUTION,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查命令语法是否正确',
      '确保所有依赖项都已安装',
      '查看详细错误信息以了解具体原因',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/execution-failed',
  },
  TIMEOUT: {
    code: 'TIMEOUT',
    message: '操作超时',
    description: '操作执行超时',
    category: ErrorCategory.EXECUTION,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查操作是否过于复杂',
      '增加超时时间设置',
      '尝试分批执行操作',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/timeout',
  },

  // 插件错误
  PLUGIN_LOAD_FAILED: {
    code: 'PLUGIN_LOAD_FAILED',
    message: '插件加载失败',
    description: '无法加载指定的插件',
    category: ErrorCategory.EXECUTION,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查插件是否存在',
      '确保插件版本与应用兼容',
      '查看插件日志以了解具体错误',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/plugin-load-failed',
  },
  PLUGIN_EXECUTION_FAILED: {
    code: 'PLUGIN_EXECUTION_FAILED',
    message: '插件执行失败',
    description: '插件执行过程中发生错误',
    category: ErrorCategory.EXECUTION,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查插件配置是否正确',
      '确保插件依赖项都已安装',
      '联系插件开发者获取帮助',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/plugin-execution-failed',
  },

  // 工具错误
  TOOL_NOT_FOUND: {
    code: 'TOOL_NOT_FOUND',
    message: '工具未找到',
    description: '指定的工具不存在',
    category: ErrorCategory.EXECUTION,
    severity: ErrorSeverity.LOW,
    suggestedActions: [
      '检查工具名称是否正确',
      '确保工具已安装',
      '使用 /tools 命令查看可用工具',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/tool-not-found',
  },
  TOOL_EXECUTION_FAILED: {
    code: 'TOOL_EXECUTION_FAILED',
    message: '工具执行失败',
    description: '工具执行过程中发生错误',
    category: ErrorCategory.EXECUTION,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查工具参数是否正确',
      '确保工具依赖项都已安装',
      '查看工具文档以了解正确用法',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/tool-execution-failed',
  },

  // 缓存错误
  CACHE_ERROR: {
    code: 'CACHE_ERROR',
    message: '缓存错误',
    description: '缓存操作失败',
    category: ErrorCategory.EXECUTION,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '检查缓存目录权限',
      '清除缓存并重新尝试',
      '检查磁盘空间是否足够',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/cache-error',
  },

  // 安全错误
  SECURITY_VIOLATION: {
    code: 'SECURITY_VIOLATION',
    message: '安全违规',
    description: '操作违反了安全策略',
    category: ErrorCategory.PERMISSION,
    severity: ErrorSeverity.HIGH,
    suggestedActions: [
      '检查操作是否符合安全策略',
      '联系安全管理员获取帮助',
      '确保您有权限执行此操作',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/security-violation',
  },

  // 未知错误
  UNKNOWN_ERROR: {
    code: 'UNKNOWN_ERROR',
    message: '未知错误',
    description: '发生了未知错误',
    category: ErrorCategory.UNKNOWN,
    severity: ErrorSeverity.MEDIUM,
    suggestedActions: [
      '稍后重试操作',
      '检查应用日志以了解详细信息',
      '如果问题持续，请联系支持团队',
    ],
    documentationUrl: 'https://docs.pyapp.com/errors/unknown-error',
  },
};

/**
 * 错误消息管理类
 */
export class ErrorMessageManager {
  private static instance: ErrorMessageManager | null = null;

  private constructor() {
    // 初始化
  }

  static getInstance(): ErrorMessageManager {
    if (!ErrorMessageManager.instance) {
      ErrorMessageManager.instance = new ErrorMessageManager();
    }
    return ErrorMessageManager.instance;
  }

  /**
   * 获取错误消息
   * @param code 错误代码
   * @returns 错误消息
   */
  getErrorMessage(code: string): ErrorMessage {
    return errorMessages[code] || errorMessages['UNKNOWN_ERROR'];
  }

  /**
   * 根据错误代码创建错误对象
   * @param code 错误代码
   * @param context 错误上下文
   * @returns 错误对象
   */
  createError(code: string, context?: Record<string, any>): AppError {
    const errorMessage = this.getErrorMessage(code);
    return new AppError(
      errorMessage.message,
      errorMessage.category,
      errorMessage.severity,
      errorMessage.code,
      context
    );
  }

  /**
   * 格式化错误消息
   * @param error 错误对象
   * @returns 格式化的错误消息
   */
  formatError(error: AppError): string {
    const errorMessage = this.getErrorMessage(error.code || 'UNKNOWN_ERROR');

    let formattedMessage = `[${errorMessage.code}] ${errorMessage.message}\n`;
    formattedMessage += `描述: ${errorMessage.description}\n`;

    if (errorMessage.suggestedActions.length > 0) {
      formattedMessage += '建议操作:\n';
      errorMessage.suggestedActions.forEach((action, index) => {
        formattedMessage += `  ${index + 1}. ${action}\n`;
      });
    }

    if (errorMessage.documentationUrl) {
      formattedMessage += `\n更多信息: ${errorMessage.documentationUrl}`;
    }

    return formattedMessage;
  }

  /**
   * 获取错误的建议操作
   * @param code 错误代码
   * @returns 建议操作列表
   */
  getSuggestedActions(code: string): string[] {
    return this.getErrorMessage(code).suggestedActions;
  }

  /**
   * 获取错误的文档URL
   * @param code 错误代码
   * @returns 文档URL
   */
  getDocumentationUrl(code: string): string | undefined {
    return this.getErrorMessage(code).documentationUrl;
  }

  /**
   * 注册自定义错误消息
   * @param errorMessage 错误消息
   */
  registerErrorMessage(errorMessage: ErrorMessage): void {
    errorMessages[errorMessage.code] = errorMessage;
  }

  /**
   * 获取所有错误消息
   * @returns 错误消息映射
   */
  getAllErrorMessages(): Record<string, ErrorMessage> {
    return { ...errorMessages };
  }
}

export const errorMessageManager = ErrorMessageManager.getInstance();

export function getErrorMessageManager(): ErrorMessageManager {
  return errorMessageManager;
}

export default errorMessageManager;
