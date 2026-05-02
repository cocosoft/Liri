/**
 * 路径验证类型定义
 */

export type FileOperationType = 'read' | 'write' | 'execute' | 'delete';

export interface PathValidationRule {
  pattern: string | RegExp;
  allowRead: boolean;
  allowWrite: boolean;
  allowExecute: boolean;
  allowDelete: boolean;
}

export interface ValidationResult {
  allowed: boolean;
  reason?: string;
  rule?: PathValidationRule;
}

export interface PathValidationConfig {
  allowedPaths: string[];
  deniedPaths: string[];
  allowReadOutsideAllowed?: boolean;
  allowWriteOutsideAllowed?: boolean;
}
