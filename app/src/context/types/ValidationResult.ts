import type { ValidationResult } from '@modules/common/types';

export type { ValidationResult };

export function createValidResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export function createInvalidResult(
  errors: string[],
  warnings: string[] = []
): ValidationResult {
  return { valid: false, errors, warnings };
}
