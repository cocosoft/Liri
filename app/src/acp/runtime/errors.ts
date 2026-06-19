export const ACP_ERROR_CODES = [
  'ACP_BACKEND_MISSING',
  'ACP_BACKEND_UNAVAILABLE',
  'ACP_BACKEND_UNSUPPORTED_CONTROL',
  'ACP_DISPATCH_DISABLED',
  'ACP_INVALID_RUNTIME_OPTION',
  'ACP_SESSION_INIT_FAILED',
  'ACP_TURN_FAILED',
] as const;

export type AcpRuntimeErrorCode = (typeof ACP_ERROR_CODES)[number];

import { AppError, ErrorCategory, ErrorSeverity } from '@modules/core';

export class AcpRuntimeError extends AppError {
  declare readonly code: AcpRuntimeErrorCode;

  constructor(
    code: AcpRuntimeErrorCode,
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, ErrorCategory.OPERATION, ErrorSeverity.HIGH, code);
    this.name = 'AcpRuntimeError';
    if (options?.cause instanceof Error) this.cause = options.cause;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

export function isAcpRuntimeError(error: unknown): error is AcpRuntimeError {
  return error instanceof AcpRuntimeError;
}

export function toAcpRuntimeError(
  error: unknown,
  defaultCode: AcpRuntimeErrorCode = 'ACP_TURN_FAILED'
): AcpRuntimeError {
  if (error instanceof AcpRuntimeError) {
    return error;
  }
  const message = error instanceof Error ? error.message : String(error);
  return new AcpRuntimeError(defaultCode, message, {
    cause: error instanceof Error ? error : undefined,
  });
}
