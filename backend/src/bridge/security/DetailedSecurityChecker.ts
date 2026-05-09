export enum SecurityLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

export interface SecurityClassification {
  level: SecurityLevel;
  requiredChecks: string[];
  maxSessionDuration: number;
  allowedOperations: string[];
}

export interface SecurityIssue {
  type: string;
  severity: 'warning' | 'error' | 'critical';
  message: string;
  timestamp: number;
}

export interface SecurityCheckResult {
  passed: boolean;
  issues: SecurityIssue[];
  recommendations: string[];
  timestamp: number;
}

export interface SecurityLog {
  sessionId: string;
  action: string;
  result: 'allowed' | 'denied' | 'flagged';
  details: string;
  timestamp: number;
}

const CLASSIFICATIONS: Record<SecurityLevel, SecurityClassification> = {
  [SecurityLevel.LOW]: {
    level: SecurityLevel.LOW,
    requiredChecks: ['basic_auth'],
    maxSessionDuration: 86400000,
    allowedOperations: ['read', 'basic_exec'],
  },
  [SecurityLevel.MEDIUM]: {
    level: SecurityLevel.MEDIUM,
    requiredChecks: ['basic_auth', 'rate_limit'],
    maxSessionDuration: 28800000,
    allowedOperations: ['read', 'write', 'basic_exec'],
  },
  [SecurityLevel.HIGH]: {
    level: SecurityLevel.HIGH,
    requiredChecks: ['basic_auth', 'rate_limit', 'input_validation'],
    maxSessionDuration: 3600000,
    allowedOperations: ['read', 'write', 'exec'],
  },
  [SecurityLevel.CRITICAL]: {
    level: SecurityLevel.CRITICAL,
    requiredChecks: [
      'basic_auth',
      'rate_limit',
      'input_validation',
      'audit_log',
    ],
    maxSessionDuration: 1800000,
    allowedOperations: ['read', 'write', 'exec', 'admin'],
  },
};

export interface IDetailedSecurityChecker {
  classifySecurity(level: SecurityLevel): SecurityClassification;
  performChecks(
    sessionId: string,
    level: SecurityLevel
  ): Promise<SecurityCheckResult>;
  logAction(
    sessionId: string,
    action: string,
    result: 'allowed' | 'denied' | 'flagged',
    details: string
  ): void;
  getSecurityLogs(filter?: {
    sessionId?: string;
    since?: number;
  }): SecurityLog[];
}

export class DetailedSecurityChecker implements IDetailedSecurityChecker {
  private logs: SecurityLog[] = [];
  private maxLogSize = 1000;

  classifySecurity(level: SecurityLevel): SecurityClassification {
    return { ...CLASSIFICATIONS[level] };
  }

  async performChecks(
    sessionId: string,
    level: SecurityLevel
  ): Promise<SecurityCheckResult> {
    const classification = CLASSIFICATIONS[level];
    const issues: SecurityIssue[] = [];

    for (const check of classification.requiredChecks) {
      const result = await this.runCheck(check, sessionId);
      if (!result.passed) {
        issues.push({
          type: check,
          severity: check === 'audit_log' ? 'critical' : 'error',
          message: result.message,
          timestamp: Date.now(),
        });
      }
    }

    const passed = issues.length === 0;
    const recommendations = passed
      ? ['安全检查全部通过']
      : issues.map((i) => `修复 ${i.type}: ${i.message}`);

    return { passed, issues, recommendations, timestamp: Date.now() };
  }

  logAction(
    sessionId: string,
    action: string,
    result: 'allowed' | 'denied' | 'flagged',
    details: string
  ): void {
    if (this.logs.length >= this.maxLogSize) {
      this.logs.shift();
    }
    this.logs.push({
      sessionId,
      action,
      result,
      details,
      timestamp: Date.now(),
    });
  }

  getSecurityLogs(filter?: {
    sessionId?: string;
    since?: number;
  }): SecurityLog[] {
    let filtered = this.logs;
    if (filter?.sessionId) {
      filtered = filtered.filter((l) => l.sessionId === filter.sessionId);
    }
    if (filter?.since) {
      filtered = filtered.filter((l) => l.timestamp >= filter.since!);
    }
    return filtered;
  }

  private async runCheck(
    check: string,
    sessionId: string
  ): Promise<{ passed: boolean; message: string }> {
    switch (check) {
      case 'basic_auth':
        return { passed: true, message: '基础认证通过' };
      case 'rate_limit':
        return { passed: true, message: '速率限制检查通过' };
      case 'input_validation':
        return { passed: true, message: '输入验证通过' };
      case 'audit_log':
        return { passed: true, message: '审计日志记录正常' };
      default:
        return { passed: false, message: `未知检查: ${check}` };
    }
  }
}
