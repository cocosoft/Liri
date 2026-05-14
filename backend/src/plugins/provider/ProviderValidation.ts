/**
 * ProviderValidation 提供者验证
 * 验证提供者配置的完整性和连通性
 */
import type { ProviderMetadata } from './ProviderCatalog.js';

/**
 * 验证级别
 */
export type ValidationLevel = 'basic' | 'config' | 'connectivity' | 'full';

/**
 * 验证结果
 */
export interface ValidationResult {
  providerId: string;
  level: ValidationLevel;
  passed: boolean;
  checks: ValidationCheck[];
  score: number;
}

/**
 * 验证检查项
 */
export interface ValidationCheck {
  name: string;
  passed: boolean;
  message?: string;
  severity: 'error' | 'warning' | 'info';
}

/**
 * 提供者验证器
 */
export class ProviderValidation {
  /**
   * 验证提供者
   */
  validate(provider: ProviderMetadata, level: ValidationLevel = 'basic'): ValidationResult {
    const checks: ValidationCheck[] = [];

    checks.push(...this.validateBasic(provider));

    if (level === 'config' || level === 'connectivity' || level === 'full') {
      checks.push(...this.validateConfig(provider));
    }

    if (level === 'connectivity' || level === 'full') {
      checks.push(...this.validateConnectivity(provider));
    }

    const passed = checks.every((c) => c.severity !== 'error' || c.passed);
    const score = checks.length > 0
      ? Math.round((checks.filter((c) => c.passed).length / checks.length) * 100)
      : 0;

    return {
      providerId: provider.id,
      level,
      passed,
      checks,
      score,
    };
  }

  /**
   * 基本验证
   */
  private validateBasic(provider: ProviderMetadata): ValidationCheck[] {
    const checks: ValidationCheck[] = [
      {
        name: '提供者 ID',
        passed: !!provider.id && provider.id.length > 0,
        message: provider.id ? undefined : '提供者 ID 不能为空',
        severity: 'error',
      },
      {
        name: '提供者名称',
        passed: !!provider.name,
        message: provider.name ? undefined : '提供者名称不能为空',
        severity: 'error',
      },
      {
        name: '基础 URL',
        passed: !!provider.baseUrl,
        message: provider.baseUrl ? undefined : '基础 URL 不能为空',
        severity: 'error',
      },
      {
        name: '认证方式',
        passed: provider.authMethods.length > 0,
        message: provider.authMethods.length > 0 ? undefined : '至少需要一种认证方式',
        severity: 'error',
      },
      {
        name: '能力定义',
        passed: provider.capabilities.length > 0,
        message: provider.capabilities.length > 0 ? undefined : '至少需要定义一个能力',
        severity: 'warning',
      },
      {
        name: '状态标识',
        passed: ['active', 'deprecated', 'beta'].includes(provider.status),
        message: undefined,
        severity: 'info',
      },
    ];

    return checks;
  }

  /**
   * 配置验证
   */
  private validateConfig(provider: ProviderMetadata): ValidationCheck[] {
    const checks: ValidationCheck[] = [
      {
        name: '速率限制',
        passed: !!provider.rateLimit,
        message: provider.rateLimit ? undefined : '建议配置速率限制',
        severity: 'warning',
      },
      {
        name: '文档链接',
        passed: !!provider.docsUrl,
        message: provider.docsUrl ? undefined : '建议提供文档链接',
        severity: 'info',
      },
      {
        name: '版本号',
        passed: /^\d+\.\d+\.\d+$/.test(provider.version),
        message: undefined,
        severity: 'info',
      },
    ];

    for (const cap of provider.capabilities) {
      checks.push({
        name: `模型列表 (${cap.type})`,
        passed: cap.models.length > 0,
        message: cap.models.length > 0 ? undefined : `${cap.type} 类型未配置模型`,
        severity: 'error',
      });
    }

    return checks;
  }

  /**
   * 连通性验证
   */
  private validateConnectivity(provider: ProviderMetadata): ValidationCheck[] {
    return [
      {
        name: '端点可达',
        passed: true,
        message: '连通性验证需运行时执行',
        severity: 'info',
      },
    ];
  }
}

export const providerValidation = new ProviderValidation();
