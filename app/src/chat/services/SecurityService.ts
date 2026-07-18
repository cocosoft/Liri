import { EventEmitter } from 'events';
import {
  SensitiveDataService,
  sensitiveDataService as coreService,
  SensitiveErrorType,
  SensitiveError,
} from '@modules/security';
import type { SensitiveDataConfig } from '@modules/security';
import { SecurityError } from '@modules/error/types';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({ module: 'chat\services\SecurityService', level: LogLevel.INFO });

export const SecurityErrorType = SensitiveErrorType;
export type SecurityErrorAlias = SecurityError;
export type SecurityConfig = SensitiveDataConfig;

export class SecurityService extends EventEmitter {
  private static instance: SecurityService;
  private coreService: SensitiveDataService;

  private constructor() {
    super();
    this.coreService = coreService;
    this.coreService.on('securityError', (error: unknown) => {
      this.emit('securityError', error);
    });
  }

  static getInstance(): SecurityService {
    if (!SecurityService.instance) {
      SecurityService.instance = new SecurityService();
    }
    return SecurityService.instance;
  }

  updateConfig(config: Partial<SecurityConfig>): void {
    this.coreService.updateConfig(config);
  }

  getConfig(): SecurityConfig {
    return this.coreService.getConfig();
  }

  detectSensitiveData(text: string): boolean {
    return this.coreService.detectSensitiveData(text);
  }

  sanitize(text: string): string {
    return this.coreService.sanitize(text);
  }

  validateInput(input: string): { valid: boolean; error?: string } {
    return this.coreService.validateInput(input);
  }

  validateFileExtension(filename: string): { valid: boolean; error?: string } {
    return this.coreService.validateFileExtension(filename);
  }

  logSecurityError(error: Omit<SensitiveError, 'timestamp'>): void {
    this.coreService.logSecurityError(error);
  }

  getErrorHistory(): SensitiveError[] {
    return this.coreService.getErrorHistory();
  }

  clearErrorHistory(): void {
    this.coreService.clearErrorHistory();
  }

  getLastSecurityError(): SensitiveError | null {
    return this.coreService.getLastSecurityError();
  }

  getErrorStats(): Record<string, number> {
    return this.coreService.getErrorStats();
  }

  createFriendlyErrorMessage(error: SensitiveError): string {
    return this.coreService.createFriendlyErrorMessage(error);
  }

  handleError(error: unknown): {
    message: string;
    details?: Record<string, unknown>;
  } {
    return this.coreService.handleError(error);
  }

  checkDataIntegrity(data: unknown): { valid: boolean; error?: string } {
    return this.coreService.checkDataIntegrity(data);
  }

  safeSerialize(data: unknown): string {
    return this.coreService.safeSerialize(data);
  }

  safeDeserialize<T>(text: string): T | null {
    return this.coreService.safeDeserialize<T>(text);
  }

  reset(): void {
    this.coreService.reset();
    this.removeAllListeners();
  }
}

export const securityService = SecurityService.getInstance();
