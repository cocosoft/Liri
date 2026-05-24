import type { AcpServerOptions } from '../types.js';

export interface ResolvedRuntimeOptions {
  provenanceMode: string;
  defaultSessionKey: string;
  defaultSessionLabel: string;
  requireExistingSession: boolean;
  resetSession: boolean;
  prefixCwd: boolean;
  verbose: boolean;
}

export function resolveRuntimeOptions(options?: AcpServerOptions): ResolvedRuntimeOptions {
  return {
    provenanceMode: options?.provenanceMode || 'off',
    defaultSessionKey: options?.defaultSessionKey || 'default',
    defaultSessionLabel: options?.defaultSessionLabel || 'Default Session',
    requireExistingSession: options?.requireExistingSession || false,
    resetSession: options?.resetSession || false,
    prefixCwd: options?.prefixCwd || false,
    verbose: options?.verbose || false,
  };
}

export interface RuntimeOptionValidation {
  valid: boolean;
  errors: string[];
}

export function validateRuntimeOption(key: string, value: unknown): RuntimeOptionValidation {
  const errors: string[] = [];

  switch (key) {
    case 'provenanceMode':
      if (typeof value !== 'string' || !['off', 'meta', 'meta+receipt'].includes(value)) {
        errors.push(`Invalid provenance mode: ${String(value)}`);
      }
      break;
    case 'verbose':
      if (typeof value !== 'boolean') {
        errors.push('verbose must be a boolean');
      }
      break;
    case 'requireExistingSession':
      if (typeof value !== 'boolean') {
        errors.push('requireExistingSession must be a boolean');
      }
      break;
    default:
      errors.push(`Unknown runtime option: ${key}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
