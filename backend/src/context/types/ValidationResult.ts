export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function createValidResult(): ValidationResult {
  return { valid: true, errors: [], warnings: [] };
}

export function createInvalidResult(
  errors: string[],
  warnings: string[] = []
): ValidationResult {
  return { valid: false, errors, warnings };
}
