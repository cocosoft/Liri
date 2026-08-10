import { EventEmitter } from 'events';
import type {
  SensitiveDataService,
  SensitiveDataConfig,
} from '@modules/security';
import { SensitiveErrorType, SensitiveError } from '@modules/security';
import { SecurityError } from '@modules/error/types';

import { getLogger } from '@modules/monitoring';
const logger = getLogger('chat\services\SecurityService');

export const SecurityErrorType = SensitiveErrorType;
export type SecurityErrorAlias = SecurityError;
export type SecurityConfig = SensitiveDataConfig;

// 惰性获取核心服务实例：规避 ESM 循环依赖导致模块加载时 sensitiveDataService 未就绪。
// 此前在构造函数中立即绑定，若 security 模块尚未求值则单例永久持有 undefined，
// 后续所有方法（validateInput 等）抛 TypeError，任何对话在安全校验层直接失败。
// 项目惯例参考：LlamaCppServerManager / OllamaTransport 均用 require 按需加载防 barrel 循环。
let coreServiceRef: SensitiveDataService | null = null;
let coreBound = false;

function getCoreService(): SensitiveDataService {
  if (!coreBound) {
    try {
      const mod =
        require('@modules/security') as typeof import('@modules/security');
      if (mod?.sensitiveDataService) {
        coreServiceRef = mod.sensitiveDataService;
        coreServiceRef.on('securityError', (error: unknown) => {
          SecurityService.getInstance().emit('securityError', error);
        });
        coreBound = true;
      }
    } catch (err) {
      logger.warn('SecurityService: 获取核心服务失败，将在下次调用时重试', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (!coreServiceRef) {
    throw new SecurityError(
      'SensitiveDataService 未初始化（security 模块加载时序异常）'
    );
  }
  return coreServiceRef;
}

export class SecurityService extends EventEmitter {
  private static instance: SecurityService;

  private constructor() {
    super();
  }

  static getInstance(): SecurityService {
    if (!SecurityService.instance) {
      SecurityService.instance = new SecurityService();
    }
    return SecurityService.instance;
  }

  updateConfig(config: Partial<SecurityConfig>): void {
    getCoreService().updateConfig(config);
  }

  getConfig(): SecurityConfig {
    return getCoreService().getConfig();
  }

  detectSensitiveData(text: string): boolean {
    return getCoreService().detectSensitiveData(text);
  }

  sanitize(text: string): string {
    return getCoreService().sanitize(text);
  }

  validateInput(input: string): { valid: boolean; error?: string } {
    return getCoreService().validateInput(input);
  }

  validateFileExtension(filename: string): { valid: boolean; error?: string } {
    return getCoreService().validateFileExtension(filename);
  }

  logSecurityError(error: Omit<SensitiveError, 'timestamp'>): void {
    getCoreService().logSecurityError(error);
  }

  getErrorHistory(): SensitiveError[] {
    return getCoreService().getErrorHistory();
  }

  clearErrorHistory(): void {
    getCoreService().clearErrorHistory();
  }
}

/** 单例导出（ChatOrchestrator / ChatManager 等消费方依赖此导出） */
export const securityService = SecurityService.getInstance();
