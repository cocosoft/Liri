/**
 * Sed Validation
 * 对标CC源码 utils/bash/sedValidation.ts
 * 提供sed命令安全验证
 */

import {
  parseSedCommand,
  parseSedExpression,
  isSedCommand,
  containsDangerousSedPattern,
  extractSedFileTargets,
  SedScript,
} from './sedEditParser';
import type {
  SecurityAnalysisResult,
  SecurityBehavior,
  RiskLevel,
} from '../types';

export interface SedValidationOptions {
  allowInPlace: boolean;
  allowWriteToProject: boolean;
  allowExpressionEval: boolean;
  maxSubstitutions: number;
  allowedWritePrefixes: string[];
  denyWritePrefixes: string[];
}

export const DEFAULT_SED_OPTIONS: SedValidationOptions = {
  allowInPlace: true,
  allowWriteToProject: true,
  allowExpressionEval: false,
  maxSubstitutions: 50,
  allowedWritePrefixes: [],
  denyWritePrefixes: [
    '/etc/',
    '/dev/',
    '/proc/',
    '/sys/',
    '/boot/',
    '/usr/lib/',
  ],
};

export interface SedValidationResult {
  safe: boolean;
  riskLevel: RiskLevel;
  behavior: SecurityBehavior;
  script?: SedScript;
  issues: SedIssue[];
}

export interface SedIssue {
  type: SedIssueType;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  command?: string;
}

export type SedIssueType =
  | 'in-place-operation'
  | 'expression-evaluation'
  | 'system-write'
  | 'system-read'
  | 'dangerous-pattern'
  | 'too-many-substitutions'
  | 'write-denied-path'
  | 'unknown-command'
  | 'parse-error';

export function validateSedCommand(
  command: string,
  options: Partial<SedValidationOptions> = {}
): SedValidationResult {
  const opts = { ...DEFAULT_SED_OPTIONS, ...options };
  const issues: SedIssue[] = [];

  if (!isSedCommand(command)) {
    return {
      safe: true,
      riskLevel: 'low',
      behavior: 'allow',
      issues: [],
    };
  }

  let script: SedScript;
  try {
    script = parseSedCommand(command);
  } catch {
    return {
      safe: false,
      riskLevel: 'high',
      behavior: 'deny',
      issues: [
        {
          type: 'parse-error',
          severity: 'high',
          message: 'Failed to parse sed command',
        },
      ],
    };
  }

  if (script.hasInPlaceFlag && !opts.allowInPlace) {
    issues.push({
      type: 'in-place-operation',
      severity: 'high',
      message: 'In-place sed editing (-i) is not allowed',
    });
  }

  if (script.commands.length === 0) {
    return {
      safe: issues.length === 0,
      riskLevel: issues.length > 0 ? 'medium' : 'low',
      behavior: issues.length > 0 ? 'deny' : 'allow',
      script,
      issues,
    };
  }

  let substitutionCount = 0;
  for (const cmd of script.commands) {
    if (cmd.type === 'substitute') {
      substitutionCount++;
      if (cmd.replacement.includes('/e') || cmd.flags.includes('e')) {
        issues.push({
          type: 'expression-evaluation',
          severity: 'critical',
          message: 'Sed substitution with /e flag allows command execution',
          command: `${cmd.type}/${cmd.pattern}/${cmd.replacement}/${cmd.flags.join('')}`,
        });
      }
    }
    if (cmd.type === 'unknown') {
      issues.push({
        type: 'unknown-command',
        severity: 'medium',
        message: `Unknown sed command: ${cmd.raw}`,
        command: cmd.raw,
      });
    }
  }

  if (substitutionCount > opts.maxSubstitutions) {
    issues.push({
      type: 'too-many-substitutions',
      severity: 'low',
      message: `Sed command has ${substitutionCount} substitutions (max: ${opts.maxSubstitutions})`,
    });
  }

  const dangerousPattern = containsDangerousSedPattern(script);
  if (dangerousPattern.dangerous) {
    issues.push({
      type: 'dangerous-pattern',
      severity: 'high',
      message: dangerousPattern.reason || 'Dangerous sed pattern detected',
    });
  }

  const fileTargets = extractSedFileTargets(script);
  for (const target of fileTargets) {
    for (const deniedPrefix of opts.denyWritePrefixes) {
      if (target.startsWith(deniedPrefix)) {
        issues.push({
          type: 'write-denied-path',
          severity: 'critical',
          message: `Sed write target '${target}' is in denied path '${deniedPrefix}'`,
          command: target,
        });
      }
    }
  }

  if (issues.length === 0) {
    return {
      safe: true,
      riskLevel: 'low',
      behavior: 'allow',
      script,
      issues: [],
    };
  }

  const hasCritical = issues.some((i) => i.severity === 'critical');
  const hasHigh = issues.some((i) => i.severity === 'high');

  return {
    safe: !hasCritical,
    riskLevel: hasCritical ? 'high' : hasHigh ? 'medium' : 'low',
    behavior: hasCritical ? 'deny' : 'ask',
    script,
    issues,
  };
}

export function validateSedExpression(expression: string): {
  valid: boolean;
  error?: string;
  commandType?: string;
} {
  try {
    const parsed = parseSedExpression(expression);
    if (!parsed) {
      return { valid: false, error: 'Unable to parse sed expression' };
    }
    if (parsed.type === 'unknown') {
      return {
        valid: false,
        error: `Unknown sed command: ${parsed.raw}`,
        commandType: 'unknown',
      };
    }
    if (parsed.type === 'write' || parsed.type === 'read') {
      const dangerousPaths = ['/etc/', '/dev/', '/proc/', '/sys/'];
      for (const dp of dangerousPaths) {
        if (parsed.type === 'write' && parsed.filename.startsWith(dp)) {
          return {
            valid: false,
            error: `Write target '${parsed.filename}' is a system path`,
            commandType: parsed.type,
          };
        }
        if (parsed.type === 'read' && parsed.filename.startsWith(dp)) {
          return {
            valid: false,
            error: `Read target '${parsed.filename}' is a system path`,
            commandType: parsed.type,
          };
        }
      }
    }
    return { valid: true, commandType: parsed.type };
  } catch {
    return { valid: false, error: 'Failed to parse sed expression' };
  }
}

export function makeSedValidationResult(result: SedValidationResult): {
  safe: boolean;
  riskLevel: RiskLevel;
  behavior: SecurityBehavior;
  message?: string;
} {
  if (result.safe) {
    return { safe: true, riskLevel: 'low', behavior: 'allow' };
  }
  const criticalIssues = result.issues.filter((i) => i.severity === 'critical');
  const highIssues = result.issues.filter((i) => i.severity === 'high');
  if (criticalIssues.length > 0) {
    return {
      safe: false,
      riskLevel: 'high',
      behavior: 'deny',
      message: criticalIssues.map((i) => i.message).join('; '),
    };
  }
  if (highIssues.length > 0) {
    return {
      safe: false,
      riskLevel: 'medium',
      behavior: 'ask',
      message: highIssues.map((i) => i.message).join('; '),
    };
  }
  return {
    safe: false,
    riskLevel: 'low',
    behavior: 'ask',
    message: result.issues.map((i) => i.message).join('; '),
  };
}

export function isSedInPlaceEdit(command: string): boolean {
  return /^sed\s+-i/.test(command.trim());
}

export function getSedTargetFiles(command: string): string[] {
  const parts = command.trim().split(/\s+/);
  const files: string[] = [];
  let afterIOption = false;
  for (const part of parts) {
    if (part === 'sed') {
      continue;
    }
    if (part.startsWith('-i')) {
      afterIOption = true;
      continue;
    }
    if (afterIOption && part.startsWith('-')) {
      afterIOption = false;
    }
    if (
      !part.startsWith('-') &&
      !part.startsWith("'") &&
      !part.startsWith('"') &&
      !part.startsWith('/')
    ) {
      if (afterIOption) {
        files.push(part);
        afterIOption = false;
      }
    }
  }
  return files;
}
