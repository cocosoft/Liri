/**
 * 安全模块类型定义
 */

export type RiskLevel = 'low' | 'medium' | 'high';

export type SecurityBehavior = 'allow' | 'deny' | 'ask';

export interface SecurityAnalysisResult {
  safe: boolean;
  behavior: SecurityBehavior;
  riskLevel: RiskLevel;
  message?: string;
  matchedPatterns: string[];
}

export interface SecurityPattern {
  name: string;
  pattern: RegExp;
  message: string;
  riskLevel: RiskLevel;
  behavior: SecurityBehavior;
}

export interface SecurityCheckContext {
  command: string;
  baseCommand: string;
  shellType: 'bash' | 'zsh' | 'powershell' | 'unknown';
}

export interface SecurityDecision {
  allowed: boolean;
  reason?: string;
  securityAnalysis?: SecurityAnalysisResult;
  sandboxRequired: boolean;
  permissionBehavior: 'allow' | 'deny' | 'ask';
}
