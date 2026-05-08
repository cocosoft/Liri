//
/**
 * 错误分类器
 * 基于CC源码 cc_code/backend/utils/errors.ts 实现
 */

export type ErrorKind =
  | 'network'
  | 'timeout'
  | 'auth'
  | 'validation'
  | 'filesystem'
  | 'system'
  | 'unknown';

export interface ClassifiedError {
  kind: ErrorKind;
  message: string;
  code?: string;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export function classifyError(error: unknown): ClassifiedError {
  const message = error instanceof Error ? error.message : String(error);

  if (error instanceof Error) {
    if (isAbortError(error)) {
      return {
        kind: 'system',
        message,
        retryable: false,
        details: { name: error.name },
      };
    }

    if (isShellError(error)) {
      return {
        kind: 'system',
        message,
        code: (error as ShellError).code?.toString(),
        retryable: false,
        details: {
          stdout: (error as ShellError).stdout,
          stderr: (error as ShellError).stderr,
          interrupted: (error as ShellError).interrupted,
        },
      };
    }

    if (isENOENT(error)) {
      return {
        kind: 'filesystem',
        message,
        code: 'ENOENT',
        retryable: false,
      };
    }

    if (isFsInaccessible(error)) {
      return {
        kind: 'filesystem',
        message,
        code: getErrnoCode(error),
        retryable: false,
      };
    }

    const code = getErrnoCode(error);
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT') {
      return {
        kind: 'network',
        message,
        code,
        retryable: true,
      };
    }

    if (code === 'ECONNABORTED') {
      return {
        kind: 'timeout',
        message,
        code,
        retryable: true,
      };
    }

    if (error.name === 'ValidationError' || error.name === 'ZodError') {
      return {
        kind: 'validation',
        message,
        retryable: false,
      };
    }

    if (error.name === 'UnauthorizedError' || error.name === 'ForbiddenError') {
      return {
        kind: 'auth',
        message,
        retryable: false,
      };
    }
  }

  return {
    kind: 'unknown',
    message,
    retryable: false,
  };
}

export function isAbortError(e: unknown): boolean {
  return (
    e instanceof Error &&
    (e.name === 'AbortError' || e.name === 'CancelError')
  );
}

export function isShellError(e: unknown): boolean {
  return e instanceof Error && e.name === 'ShellError';
}

export function isENOENT(e: unknown): boolean {
  return getErrnoCode(e) === 'ENOENT';
}

export function isFsInaccessible(e: unknown): boolean {
  const code = getErrnoCode(e);
  return (
    code === 'ENOENT' ||
    code === 'EACCES' ||
    code === 'EPERM' ||
    code === 'ENOTDIR' ||
    code === 'ELOOP'
  );
}

export function getErrnoCode(e: unknown): string | undefined {
  if (e && typeof e === 'object' && 'code' in e && typeof (e as Record<string, unknown>).code === 'string') {
    return (e as Record<string, unknown>).code as string;
  }
  return undefined;
}

export function isRetryable(error: ClassifiedError): boolean {
  return error.retryable;
}

export function isAuthError(error: ClassifiedError): boolean {
  return error.kind === 'auth';
}

export function isNetworkError(error: ClassifiedError): boolean {
  return error.kind === 'network' || error.kind === 'timeout';
}

export function isUserError(error: ClassifiedError): boolean {
  return error.kind === 'validation' || error.kind === 'auth';
}
