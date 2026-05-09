/**
 * 路径验证增强
 * 参考CC_CODE utils/permissions/pathValidation.ts实现
 * 提供细粒度路径权限控制
 */

import { homedir } from 'os';
import { isAbsolute, resolve, dirname } from 'path';
import {
  PathValidationRule,
  ValidationResult,
  PathValidationConfig,
  FileOperationType,
} from './types.js';

const WINDOWS_DRIVE_ROOT_REGEX = /^[a-zA-Z]:\\?$/;
const WINDOWS_DRIVE_CHILD_REGEX = /^[a-zA-Z]:\\?[a-zA-Z0-9_]+$/;

export function expandTilde(path: string): string {
  if (
    path === '~' ||
    path.startsWith('~/') ||
    (process.platform === 'win32' && path.startsWith('~\\'))
  ) {
    return homedir() + path.slice(1);
  }
  return path;
}

export function isDangerousRemovalPath(resolvedPath: string): boolean {
  const forwardSlashed = resolvedPath.replace(/[\\/]+/g, '/');

  if (forwardSlashed === '*' || forwardSlashed.endsWith('/*')) {
    return true;
  }

  const normalizedPath =
    forwardSlashed === '/' ? forwardSlashed : forwardSlashed.replace(/\/$/, '');

  if (normalizedPath === '/') {
    return true;
  }

  if (WINDOWS_DRIVE_ROOT_REGEX.test(normalizedPath)) {
    return true;
  }

  const normalizedHome = homedir().replace(/[\\/]+/g, '/');
  if (normalizedPath === normalizedHome) {
    return true;
  }

  const parentDir = dirname(normalizedPath);
  if (parentDir === '/') {
    return true;
  }

  if (WINDOWS_DRIVE_CHILD_REGEX.test(normalizedPath)) {
    return true;
  }

  return false;
}

export class PathValidator {
  private rules: PathValidationRule[] = [];
  private allowedPaths: string[] = [];
  private deniedPaths: string[] = [];

  constructor(config?: PathValidationConfig) {
    if (config) {
      this.allowedPaths = config.allowedPaths.map((p) =>
        resolve(expandTilde(p))
      );
      this.deniedPaths = config.deniedPaths.map((p) => resolve(expandTilde(p)));
    }
  }

  addRule(rule: PathValidationRule): void {
    this.rules.push(rule);
  }

  validate(path: string, operation: FileOperationType): ValidationResult {
    const expandedPath = expandTilde(path);
    const absolutePath = isAbsolute(expandedPath)
      ? resolve(expandedPath)
      : resolve(process.cwd(), expandedPath);

    for (const deniedPath of this.deniedPaths) {
      if (absolutePath.startsWith(deniedPath)) {
        return {
          allowed: false,
          reason: `Path '${path}' is in denied list`,
        };
      }
    }

    if (operation === 'delete' && isDangerousRemovalPath(absolutePath)) {
      return {
        allowed: false,
        reason: `Dangerous removal operation on critical path: '${absolutePath}'`,
      };
    }

    for (const rule of this.rules) {
      if (this.matches(absolutePath, rule.pattern)) {
        const allowed =
          operation === 'read'
            ? rule.allowRead
            : operation === 'write'
              ? rule.allowWrite
              : operation === 'execute'
                ? rule.allowExecute
                : operation === 'delete'
                  ? rule.allowDelete
                  : false;

        return {
          allowed,
          reason: allowed ? undefined : `Rule denied ${operation} on '${path}'`,
          rule,
        };
      }
    }

    const isInAllowedPath = this.allowedPaths.some((allowedPath) =>
      absolutePath.startsWith(allowedPath)
    );

    if (isInAllowedPath) {
      return { allowed: true };
    }

    return {
      allowed: false,
      reason: `Path '${path}' is not in allowed paths`,
    };
  }

  validateRead(path: string): ValidationResult {
    return this.validate(path, 'read');
  }

  validateWrite(path: string): ValidationResult {
    return this.validate(path, 'write');
  }

  validateExecute(path: string): ValidationResult {
    return this.validate(path, 'execute');
  }

  validateDelete(path: string): ValidationResult {
    return this.validate(path, 'delete');
  }

  private matches(path: string, pattern: string | RegExp): boolean {
    if (typeof pattern === 'string') {
      return path.startsWith(pattern) || path === pattern;
    }
    return pattern.test(path);
  }

  clearRules(): void {
    this.rules = [];
  }

  getRules(): PathValidationRule[] {
    return [...this.rules];
  }
}

export function createDefaultPathValidator(
  config?: PathValidationConfig
): PathValidator {
  const validator = new PathValidator(config);

  validator.addRule({
    pattern: /^\/tmp[\\/]/,
    allowRead: true,
    allowWrite: true,
    allowExecute: false,
    allowDelete: true,
  });

  validator.addRule({
    pattern: /[\\/]node_modules[\\/]/,
    allowRead: true,
    allowWrite: false,
    allowExecute: false,
    allowDelete: false,
  });

  validator.addRule({
    pattern: /[\\/]\.git[\\/]/,
    allowRead: true,
    allowWrite: false,
    allowExecute: false,
    allowDelete: false,
  });

  return validator;
}
