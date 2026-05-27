/**
 * 安全配置管理器
 * 管理所有安全相关的配置选项
 */

/**
 * 安全配置接口
 */
export interface SecurityConfig {
  /** 是否启用安全审计 */
  securityAuditEnabled: boolean;
  /** 安全审计日志文件路径 */
  securityAuditLogFile: string;
  /** 审计日志保留天数 */
  securityAuditRetentionDays: number;
  /** 审计日志最大大小（MB） */
  securityAuditMaxLogSize: number;
  /** 是否启用详细审计日志 */
  securityAuditVerbose: boolean;
  /** 是否启用输入验证 */
  securityInputValidationEnabled: boolean;
  /** 是否启用输出编码 */
  securityOutputEncodingEnabled: boolean;
  /** 是否启用危险命令检查 */
  securityDangerousCommandCheck: boolean;
  /** 是否启用路径遍历检查 */
  securityPathTraversalCheck: boolean;
  /** 是否启用XSS防护 */
  securityXssProtectionEnabled: boolean;
  /** 是否启用Unicode清理 */
  securityUnicodeSanitizationEnabled: boolean;
  /** 是否启用权限强制执行 */
  securityPermissionEnforcement: boolean;
  /** 最大输入长度 */
  securityMaxInputLength: number;
  /** 最大文件路径长度 */
  securityMaxFilePathLength: number;
  /** 允许的协议列表 */
  securityAllowedProtocols: string[];
  /** 安全日志级别 */
  securityLogLevel: 'debug' | 'info' | 'warn' | 'error';
  /** 是否启用HTTPS重定向 */
  securityHttpsRedirect: boolean;
  /** 是否启用CSP头 */
  securityCspEnabled: boolean;
  /** 是否启用HSTS */
  securityHstsEnabled: boolean;
  /** 是否启用X-Frame-Options */
  securityXFrameOptionsEnabled: boolean;
  /** 是否启用X-Content-Type-Options */
  securityXContentTypeOptionsEnabled: boolean;
  /** 是否启用Referrer-Policy */
  securityReferrerPolicyEnabled: boolean;
}

/**
 * 默认安全配置
 */
export const defaultSecurityConfig: SecurityConfig = {
  securityAuditEnabled: true,
  securityAuditLogFile: 'app/data/logs/security_audit.log',
  securityAuditRetentionDays: 30,
  securityAuditMaxLogSize: 100,
  securityAuditVerbose: false,
  securityInputValidationEnabled: true,
  securityOutputEncodingEnabled: true,
  securityDangerousCommandCheck: true,
  securityPathTraversalCheck: true,
  securityXssProtectionEnabled: true,
  securityUnicodeSanitizationEnabled: true,
  securityPermissionEnforcement: true,
  securityMaxInputLength: 4096,
  securityMaxFilePathLength: 1024,
  securityAllowedProtocols: ['http', 'https', 'ftp'],
  securityLogLevel: 'info',
  securityHttpsRedirect: false,
  securityCspEnabled: true,
  securityHstsEnabled: true,
  securityXFrameOptionsEnabled: true,
  securityXContentTypeOptionsEnabled: true,
  securityReferrerPolicyEnabled: true,
};

/**
 * 安全配置管理器类
 */
export class SecurityConfigManager {
  private config: SecurityConfig;

  /**
   * 构造函数
   */
  constructor(config?: Partial<SecurityConfig>) {
    this.config = { ...defaultSecurityConfig, ...config };
    this.loadFromEnvironment();
  }

  /**
   * 从环境变量加载配置
   */
  private loadFromEnvironment(): void {
    // 安全审计配置
    if (process.env.SECURITY_AUDIT_ENABLED) {
      this.config.securityAuditEnabled =
        process.env.SECURITY_AUDIT_ENABLED === 'true';
    }
    if (process.env.SECURITY_AUDIT_LOG_FILE) {
      this.config.securityAuditLogFile = process.env.SECURITY_AUDIT_LOG_FILE;
    }
    if (process.env.SECURITY_AUDIT_RETENTION_DAYS) {
      this.config.securityAuditRetentionDays = parseInt(
        process.env.SECURITY_AUDIT_RETENTION_DAYS
      );
    }
    if (process.env.SECURITY_AUDIT_MAX_LOG_SIZE) {
      this.config.securityAuditMaxLogSize = parseInt(
        process.env.SECURITY_AUDIT_MAX_LOG_SIZE
      );
    }
    if (process.env.SECURITY_AUDIT_VERBOSE) {
      this.config.securityAuditVerbose =
        process.env.SECURITY_AUDIT_VERBOSE === 'true';
    }

    // 安全功能配置
    if (process.env.SECURITY_INPUT_VALIDATION_ENABLED) {
      this.config.securityInputValidationEnabled =
        process.env.SECURITY_INPUT_VALIDATION_ENABLED === 'true';
    }
    if (process.env.SECURITY_OUTPUT_ENCODING_ENABLED) {
      this.config.securityOutputEncodingEnabled =
        process.env.SECURITY_OUTPUT_ENCODING_ENABLED === 'true';
    }
    if (process.env.SECURITY_DANGEROUS_COMMAND_CHECK) {
      this.config.securityDangerousCommandCheck =
        process.env.SECURITY_DANGEROUS_COMMAND_CHECK === 'true';
    }
    if (process.env.SECURITY_PATH_TRAVERSAL_CHECK) {
      this.config.securityPathTraversalCheck =
        process.env.SECURITY_PATH_TRAVERSAL_CHECK === 'true';
    }
    if (process.env.SECURITY_XSS_PROTECTION_ENABLED) {
      this.config.securityXssProtectionEnabled =
        process.env.SECURITY_XSS_PROTECTION_ENABLED === 'true';
    }
    if (process.env.SECURITY_UNICODE_SANITIZATION_ENABLED) {
      this.config.securityUnicodeSanitizationEnabled =
        process.env.SECURITY_UNICODE_SANITIZATION_ENABLED === 'true';
    }
    if (process.env.SECURITY_PERMISSION_ENFORCEMENT) {
      this.config.securityPermissionEnforcement =
        process.env.SECURITY_PERMISSION_ENFORCEMENT === 'true';
    }

    // 安全限制配置
    if (process.env.SECURITY_MAX_INPUT_LENGTH) {
      this.config.securityMaxInputLength = parseInt(
        process.env.SECURITY_MAX_INPUT_LENGTH
      );
    }
    if (process.env.SECURITY_MAX_FILE_PATH_LENGTH) {
      this.config.securityMaxFilePathLength = parseInt(
        process.env.SECURITY_MAX_FILE_PATH_LENGTH
      );
    }
    if (process.env.SECURITY_ALLOWED_PROTOCOLS) {
      this.config.securityAllowedProtocols =
        process.env.SECURITY_ALLOWED_PROTOCOLS.split(',');
    }

    // 日志配置
    if (process.env.SECURITY_LOG_LEVEL) {
      const level = process.env.SECURITY_LOG_LEVEL.toLowerCase();
      if (['debug', 'info', 'warn', 'error'].includes(level)) {
        this.config.securityLogLevel = level as
          | 'debug'
          | 'info'
          | 'warn'
          | 'error';
      }
    }
  }

  /**
   * 获取配置值
   */
  getConfig(): SecurityConfig {
    return { ...this.config };
  }

  /**
   * 更新配置
   */
  updateConfig(updates: Partial<SecurityConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * 验证配置的有效性
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // 验证数值范围
    if (this.config.securityMaxInputLength <= 0) {
      errors.push('SECURITY_MAX_INPUT_LENGTH must be positive');
    }
    if (this.config.securityMaxFilePathLength <= 0) {
      errors.push('SECURITY_MAX_FILE_PATH_LENGTH must be positive');
    }
    if (this.config.securityAuditRetentionDays <= 0) {
      errors.push('SECURITY_AUDIT_RETENTION_DAYS must be positive');
    }
    if (this.config.securityAuditMaxLogSize <= 0) {
      errors.push('SECURITY_AUDIT_MAX_LOG_SIZE must be positive');
    }

    // 验证协议列表
    if (this.config.securityAllowedProtocols.length === 0) {
      errors.push(
        'SECURITY_ALLOWED_PROTOCOLS must contain at least one protocol'
      );
    }

    // 验证日志文件路径
    if (this.config.securityAuditLogFile.trim() === '') {
      errors.push('SECURITY_AUDIT_LOG_FILE cannot be empty');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * 导出为环境变量格式
   */
  exportToEnvFormat(): string {
    const envVars: string[] = [];

    envVars.push(`SECURITY_AUDIT_ENABLED=${this.config.securityAuditEnabled}`);
    envVars.push(`SECURITY_AUDIT_LOG_FILE=${this.config.securityAuditLogFile}`);
    envVars.push(
      `SECURITY_AUDIT_RETENTION_DAYS=${this.config.securityAuditRetentionDays}`
    );
    envVars.push(
      `SECURITY_AUDIT_MAX_LOG_SIZE=${this.config.securityAuditMaxLogSize}`
    );
    envVars.push(`SECURITY_AUDIT_VERBOSE=${this.config.securityAuditVerbose}`);

    envVars.push(
      `SECURITY_INPUT_VALIDATION_ENABLED=${this.config.securityInputValidationEnabled}`
    );
    envVars.push(
      `SECURITY_OUTPUT_ENCODING_ENABLED=${this.config.securityOutputEncodingEnabled}`
    );
    envVars.push(
      `SECURITY_DANGEROUS_COMMAND_CHECK=${this.config.securityDangerousCommandCheck}`
    );
    envVars.push(
      `SECURITY_PATH_TRAVERSAL_CHECK=${this.config.securityPathTraversalCheck}`
    );
    envVars.push(
      `SECURITY_XSS_PROTECTION_ENABLED=${this.config.securityXssProtectionEnabled}`
    );
    envVars.push(
      `SECURITY_UNICODE_SANITIZATION_ENABLED=${this.config.securityUnicodeSanitizationEnabled}`
    );
    envVars.push(
      `SECURITY_PERMISSION_ENFORCEMENT=${this.config.securityPermissionEnforcement}`
    );

    envVars.push(
      `SECURITY_MAX_INPUT_LENGTH=${this.config.securityMaxInputLength}`
    );
    envVars.push(
      `SECURITY_MAX_FILE_PATH_LENGTH=${this.config.securityMaxFilePathLength}`
    );
    envVars.push(
      `SECURITY_ALLOWED_PROTOCOLS=${this.config.securityAllowedProtocols.join(',')}`
    );

    envVars.push(`SECURITY_LOG_LEVEL=${this.config.securityLogLevel}`);

    return envVars.join('\n');
  }

  /**
   * 生成安全配置报告
   */
  generateSecurityReport(): {
    summary: {
      totalChecks: number;
      enabledChecks: number;
      disabledChecks: number;
    };
    details: Array<{
      feature: string;
      enabled: boolean;
      description: string;
    }>;
  } {
    const securityFeatures = [
      {
        feature: '安全审计',
        enabled: this.config.securityAuditEnabled,
        description: '记录安全事件和操作',
      },
      {
        feature: '输入验证',
        enabled: this.config.securityInputValidationEnabled,
        description: '验证用户输入的合法性',
      },
      {
        feature: '输出编码',
        enabled: this.config.securityOutputEncodingEnabled,
        description: '防止XSS攻击',
      },
      {
        feature: '危险命令检查',
        enabled: this.config.securityDangerousCommandCheck,
        description: '检测和阻止危险命令',
      },
      {
        feature: '路径遍历检查',
        enabled: this.config.securityPathTraversalCheck,
        description: '防止路径遍历攻击',
      },
      {
        feature: 'XSS防护',
        enabled: this.config.securityXssProtectionEnabled,
        description: '防止跨站脚本攻击',
      },
      {
        feature: 'Unicode清理',
        enabled: this.config.securityUnicodeSanitizationEnabled,
        description: '清理隐藏字符攻击',
      },
      {
        feature: '权限强制执行',
        enabled: this.config.securityPermissionEnforcement,
        description: '强制执行权限控制',
      },
      {
        feature: 'HTTPS重定向',
        enabled: this.config.securityHttpsRedirect,
        description: '强制使用HTTPS',
      },
      {
        feature: 'CSP头',
        enabled: this.config.securityCspEnabled,
        description: '内容安全策略',
      },
      {
        feature: 'HSTS',
        enabled: this.config.securityHstsEnabled,
        description: 'HTTP严格传输安全',
      },
      {
        feature: 'X-Frame-Options',
        enabled: this.config.securityXFrameOptionsEnabled,
        description: '防止点击劫持',
      },
      {
        feature: 'X-Content-Type-Options',
        enabled: this.config.securityXContentTypeOptionsEnabled,
        description: '防止MIME类型嗅探',
      },
      {
        feature: 'Referrer-Policy',
        enabled: this.config.securityReferrerPolicyEnabled,
        description: '控制Referrer信息泄露',
      },
    ];

    const enabledChecks = securityFeatures.filter((f) => f.enabled).length;
    const totalChecks = securityFeatures.length;

    return {
      summary: {
        totalChecks,
        enabledChecks,
        disabledChecks: totalChecks - enabledChecks,
      },
      details: securityFeatures,
    };
  }
}

/**
 * 全局安全配置管理器实例
 */
export const securityConfigManager = new SecurityConfigManager();

/**
 * 获取安全配置
 */
export function getSecurityConfig(): SecurityConfig {
  return securityConfigManager.getConfig();
}

/**
 * 更新安全配置
 */
export function updateSecurityConfig(updates: Partial<SecurityConfig>): void {
  securityConfigManager.updateConfig(updates);
}

/**
 * 验证安全配置
 */
export function validateSecurityConfig(): { valid: boolean; errors: string[] } {
  return securityConfigManager.validateConfig();
}
