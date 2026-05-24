import type { AcpServerOptions, AcpProvenanceMode } from '../types.js';

export function validateServerOptions(options: AcpServerOptions): string[] {
  const errors: string[] = [];

  if (
    options.provenanceMode &&
    !['off', 'meta', 'meta+receipt'].includes(options.provenanceMode)
  ) {
    errors.push(`Invalid provenance mode: ${options.provenanceMode}`);
  }

  if (options.sessionCreateRateLimit) {
    if (
      options.sessionCreateRateLimit.maxRequests !== undefined &&
      options.sessionCreateRateLimit.maxRequests < 1
    ) {
      errors.push('sessionCreateRateLimit.maxRequests must be >= 1');
    }
    if (
      options.sessionCreateRateLimit.windowMs !== undefined &&
      options.sessionCreateRateLimit.windowMs < 1000
    ) {
      errors.push('sessionCreateRateLimit.windowMs must be >= 1000');
    }
  }

  return errors;
}

export function hasValidServerOptions(options: AcpServerOptions): boolean {
  return validateServerOptions(options).length === 0;
}
