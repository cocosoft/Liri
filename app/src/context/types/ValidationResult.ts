import type { ValidationResult } from '@openliri/infra/common/types';

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
