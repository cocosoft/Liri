// @ts-nocheck
/**
 * 插件错误处理模块
 * 定义插件相关的错误类型和处理方法
 */

/**
 * 插件错误类型
 */
export enum PluginErrorType {
  // 加载错误
  LOAD_FAILED = 'LOAD_FAILED',
  MANIFEST_NOT_FOUND = 'MANIFEST_NOT_FOUND',
  MANIFEST_INVALID = 'MANIFEST_INVALID',
  
  // 依赖错误
  DEPENDENCY_NOT_FOUND = 'DEPENDENCY_NOT_FOUND',
  DEPENDENCY_VERSION_CONFLICT = 'DEPENDENCY_VERSION_CONFLICT',
  CIRCULAR_DEPENDENCY = 'CIRCULAR_DEPENDENCY',
  
  // 缓存错误
  CACHE_ERROR = 'CACHE_ERROR',
  ZIP_COMPRESSION_FAILED = 'ZIP_COMPRESSION_FAILED',
  ZIP_EXTRACTION_FAILED = 'ZIP_EXTRACTION_FAILED',
  
  // 安装错误
  INSTALL_FAILED = 'INSTALL_FAILED',
  GIT_CLONE_FAILED = 'GIT_CLONE_FAILED',
  NPM_INSTALL_FAILED = 'NPM_INSTALL_FAILED',
  
  // 组件错误
  COMPONENT_LOAD_FAILED = 'COMPONENT_LOAD_FAILED',
  COMPONENT_NOT_FOUND = 'COMPONENT_NOT_FOUND',
  
  // 验证错误
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  MISSING_REQUIRED_FIELD = 'MISSING_REQUIRED_FIELD',
  
  // 其他错误
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * 插件错误类
 */
export class PluginError extends Error {
  readonly type: PluginErrorType;
  readonly details?: any;
  readonly pluginName?: string;
  readonly source?: string;

  /**
   * 创建插件错误
   * @param message 错误消息
   * @param type 错误类型
   * @param options 错误选项
   */
  constructor(
    message: string,
    type: PluginErrorType = PluginErrorType.UNKNOWN_ERROR,
    options?: {
      details?: any;
      pluginName?: string;
      source?: string;
      cause?: Error;
    }
  ) {
    super(message);
    this.name = 'PluginError';
    this.type = type;
    this.details = options?.details;
    this.pluginName = options?.pluginName;
    this.source = options?.source;
    
    if (options?.cause) {
      this.cause = options.cause;
    }
  }

  /**
   * 获取错误的详细信息
   */
  getDetailedMessage(): string {
    let message = `${this.type}: ${this.message}`;
    
    if (this.pluginName) {
      message += ` (Plugin: ${this.pluginName})`;
    }
    
    if (this.source) {
      message += ` (Source: ${this.source})`;
    }
    
    if (this.details) {
      message += `\nDetails: ${JSON.stringify(this.details, null, 2)}`;
    }
    
    if (this.cause) {
      message += `\nCause: ${this.cause.message}`;
    }
    
    return message;
  }

  /**
   * 转换为对象
   */
  toObject() {
    return {
      name: this.name,
      type: this.type,
      message: this.message,
      pluginName: this.pluginName,
      source: this.source,
      details: this.details,
      cause: this.cause ? {
        message: this.cause.message,
        stack: this.cause.stack
      } : undefined,
      stack: this.stack
    };
  }
}

/**
 * 插件错误工厂
 */
export class PluginErrorFactory {
  /**
   * 创建加载失败错误
   */
  static createLoadError(message: string, options?: {
    pluginName?: string;
    source?: string;
    cause?: Error;
  }): PluginError {
    return new PluginError(
      message,
      PluginErrorType.LOAD_FAILED,
      options
    );
  }

  /**
   * 创建Manifest未找到错误
   */
  static createManifestNotFoundError(path: string, options?: {
    pluginName?: string;
    source?: string;
  }): PluginError {
    return new PluginError(
      `Plugin manifest not found at ${path}`,
      PluginErrorType.MANIFEST_NOT_FOUND,
      options
    );
  }

  /**
   * 创建Manifest无效错误
   */
  static createManifestInvalidError(message: string, options?: {
    pluginName?: string;
    source?: string;
    details?: any;
  }): PluginError {
    return new PluginError(
      message,
      PluginErrorType.MANIFEST_INVALID,
      options
    );
  }

  /**
   * 创建依赖未找到错误
   */
  static createDependencyNotFoundError(dependencyName: string, options?: {
    pluginName?: string;
    version?: string;
    cause?: Error;
  }): PluginError {
    return new PluginError(
      `Dependency ${dependencyName} not found`,
      PluginErrorType.DEPENDENCY_NOT_FOUND,
      {
        ...options,
        details: {
          dependencyName,
          version: options?.version
        }
      }
    );
  }

  /**
   * 创建依赖版本冲突错误
   */
  static createDependencyVersionConflictError(
    dependencyName: string,
    existingVersion: string,
    requestedVersion: string,
    options?: {
      pluginName?: string;
    }
  ): PluginError {
    return new PluginError(
      `Version conflict for ${dependencyName}: existing ${existingVersion}, requested ${existingVersion}`,
      PluginErrorType.DEPENDENCY_VERSION_CONFLICT,
      {
        ...options,
        details: {
          dependencyName,
          existingVersion,
          requestedVersion
        }
      }
    );
  }

  /**
   * 创建循环依赖错误
   */
  static createCircularDependencyError(dependencyPath: string[], options?: {
    pluginName?: string;
  }): PluginError {
    return new PluginError(
      `Circular dependency detected: ${dependencyPath.join(' -> ')}`,
      PluginErrorType.CIRCULAR_DEPENDENCY,
      {
        ...options,
        details: {
          dependencyPath
        }
      }
    );
  }

  /**
   * 创建缓存错误
   */
  static createCacheError(message: string, options?: {
    pluginName?: string;
    source?: string;
    cause?: Error;
  }): PluginError {
    return new PluginError(
      message,
      PluginErrorType.CACHE_ERROR,
      options
    );
  }

  /**
   * 创建ZIP压缩失败错误
   */
  static createZipCompressionError(message: string, options?: {
    pluginName?: string;
    source?: string;
    cause?: Error;
  }): PluginError {
    return new PluginError(
      message,
      PluginErrorType.ZIP_COMPRESSION_FAILED,
      options
    );
  }

  /**
   * 创建ZIP解压失败错误
   */
  static createZipExtractionError(message: string, options?: {
    pluginName?: string;
    source?: string;
    cause?: Error;
  }): PluginError {
    return new PluginError(
      message,
      PluginErrorType.ZIP_EXTRACTION_FAILED,
      options
    );
  }

  /**
   * 创建安装失败错误
   */
  static createInstallError(message: string, options?: {
    pluginName?: string;
    source?: string;
    cause?: Error;
  }): PluginError {
    return new PluginError(
      message,
      PluginErrorType.INSTALL_FAILED,
      options
    );
  }

  /**
   * 创建Git克隆失败错误
   */
  static createGitCloneError(url: string, options?: {
    pluginName?: string;
    cause?: Error;
  }): PluginError {
    return new PluginError(
      `Failed to clone git repository: ${url}`,
      PluginErrorType.GIT_CLONE_FAILED,
      options
    );
  }

  /**
   * 创建NPM安装失败错误
   */
  static createNpmInstallError(packageName: string, options?: {
    pluginName?: string;
    cause?: Error;
  }): PluginError {
    return new PluginError(
      `Failed to install npm package: ${packageName}`,
      PluginErrorType.NPM_INSTALL_FAILED,
      options
    );
  }

  /**
   * 创建组件加载失败错误
   */
  static createComponentLoadError(componentName: string, componentType: string, options?: {
    pluginName?: string;
    cause?: Error;
  }): PluginError {
    return new PluginError(
      `Failed to load ${componentType} component: ${componentName}`,
      PluginErrorType.COMPONENT_LOAD_FAILED,
      options
    );
  }

  /**
   * 创建组件未找到错误
   */
  static createComponentNotFoundError(componentName: string, componentType: string, options?: {
    pluginName?: string;
  }): PluginError {
    return new PluginError(
      `Component ${componentName} of type ${componentType} not found`,
      PluginErrorType.COMPONENT_NOT_FOUND,
      options
    );
  }

  /**
   * 创建验证失败错误
   */
  static createValidationError(message: string, options?: {
    pluginName?: string;
    details?: any;
  }): PluginError {
    return new PluginError(
      message,
      PluginErrorType.VALIDATION_FAILED,
      options
    );
  }

  /**
   * 创建缺少必填字段错误
   */
  static createMissingRequiredFieldError(field: string, options?: {
    pluginName?: string;
  }): PluginError {
    return new PluginError(
      `Missing required field: ${field}`,
      PluginErrorType.MISSING_REQUIRED_FIELD,
      options
    );
  }
}

/**
 * 错误处理工具
 */
export class PluginErrorHandler {
  /**
   * 处理插件错误
   * @param error 错误对象
   * @returns 标准化的错误信息
   */
  static handleError(error: any): PluginError {
    if (error instanceof PluginError) {
      return error;
    }

    // 转换其他错误为PluginError
    return new PluginError(
      error.message || 'Unknown plugin error',
      PluginErrorType.UNKNOWN_ERROR,
      {
        cause: error
      }
    );
  }

  /**
   * 格式化错误信息
   * @param error 错误对象
   * @returns 格式化的错误信息
   */
  static formatError(error: any): string {
    const pluginError = this.handleError(error);
    return pluginError.getDetailedMessage();
  }

  /**
   * 记录错误
   * @param error 错误对象
   * @param logger 日志对象
   */
  static logError(error: any, logger: any): void {
    const pluginError = this.handleError(error);
    const message = pluginError.getDetailedMessage();
    
    switch (pluginError.type) {
      case PluginErrorType.DEPENDENCY_VERSION_CONFLICT:
      case PluginErrorType.CIRCULAR_DEPENDENCY:
        logger.warn(message);
        break;
      default:
        logger.error(message);
    }
  }
}

// 导出错误处理相关的工具