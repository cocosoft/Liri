import { AppError, ErrorCategory, ErrorSeverity } from '@modules/error';

import { Logger, LogLevel } from '@modules/monitoring';
const logger = new Logger({
  module: 'utils\sanitization',
  level: LogLevel.INFO,
});

/**
 * Unicode Sanitization for Hidden Character Attack Mitigation
 *
 * This module implements security measures against Unicode-based hidden character attacks,
 * specifically targeting ASCII Smuggling and Hidden Prompt Injection vulnerabilities.
 * These attacks use invisible Unicode characters (such as Tag characters, format controls,
 * private use areas, and noncharacters) to hide malicious instructions that are invisible
 * to users but processed by AI models.
 *
 * The vulnerability was demonstrated in HackerOne report #3086545 targeting Claude Desktop's
 * MCP (Model Context Protocol) implementation, where attackers could inject hidden instructions
 * using Unicode Tag characters that would be executed by Claude but remain invisible to users.
 *
 * Reference: https://embracethered.com/blog/posts/2024/hiding-and-finding-text-with-unicode-tags/
 *
 * This implementation provides comprehensive protection by:
 * 1. Applying NFKC Unicode normalization to handle composed character sequences
 * 2. Removing dangerous Unicode categories while preserving legitimate text and formatting
 * 3. Supporting recursive sanitization of complex nested data structures
 * 4. Maintaining performance with efficient regex processing
 *
 * The sanitization is always enabled to protect against these attacks.
 */

export function partiallySanitizeUnicode(prompt: string): string {
  let current = prompt;
  let previous = '';
  let iterations = 0;
  const MAX_ITERATIONS = 10; // Safety limit to prevent infinite loops

  // Iteratively sanitize until no more changes occur or max iterations reached
  while (current !== previous && iterations < MAX_ITERATIONS) {
    previous = current;

    // Apply NFKC normalization to handle composed character sequences
    current = current.normalize('NFKC');

    // Remove dangerous Unicode categories using explicit character ranges

    // Method 1: Strip dangerous Unicode property classes
    // This is the primary defence and is the solution that is widely used in OSS libraries.
    current = current.replace(/[\p{Cf}\p{Co}\p{Cn}]/gu, '');

    // Method 2: Explicit character ranges. There are some subtle issues with the above method
    // failing in certain environments that don't support regexes for unicode property classes,
    // so we also implement a fallback that strips out some specifically known dangerous ranges.
    current = current
      .replace(/[\u200B-\u200F]/g, '') // Zero-width spaces, LTR/RTL marks
      .replace(/[\u202A-\u202E]/g, '') // Directional formatting characters
      .replace(/[\u2066-\u2069]/g, '') // Directional isolates
      .replace(/[\uFEFF]/g, '') // Byte order mark
      .replace(/[\uE000-\uF8FF]/g, ''); // Basic Multilingual Plane private use

    iterations++;
  }

  // If we hit max iterations, crash loudly. This should only ever happen if there is a bug or if someone purposefully created a deeply nested unicode string.
  if (iterations >= MAX_ITERATIONS) {
    throw new AppError(
      `Unicode sanitization reached maximum iterations (${MAX_ITERATIONS}) for input: ${prompt.slice(0, 100)}`,
      ErrorCategory.EXECUTION,
      ErrorSeverity.HIGH,
      '1000'
    );
  }

  return current;
}

export function recursivelySanitizeUnicode(value: string): string;
export function recursivelySanitizeUnicode<T>(value: T[]): T[];
export function recursivelySanitizeUnicode<T extends object>(value: T): T;
export function recursivelySanitizeUnicode<T>(value: T): T;
export function recursivelySanitizeUnicode(value: unknown): unknown {
  if (typeof value === 'string') {
    return partiallySanitizeUnicode(value);
  }

  if (Array.isArray(value)) {
    return value.map(recursivelySanitizeUnicode);
  }

  if (value !== null && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      sanitized[recursivelySanitizeUnicode(key) as string] =
        recursivelySanitizeUnicode(val);
    }
    return sanitized;
  }

  // Return other primitive values (numbers, booleans, null, undefined) unchanged
  return value;
}

/**
 * HTML sanitization for preventing XSS attacks
 * @param html - The HTML string to sanitize
 * @returns The sanitized HTML string
 */
export function sanitizeHTML(html: string): string {
  return html
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validate input based on type and options
 * @param input - The input to validate
 * @param type - The expected type
 * @param options - Validation options
 * @returns Validation result
 */
export function validateInput(
  input: unknown,
  type: string,
  options?: {
    minLength?: number;
    maxLength?: number;
    min?: number;
    max?: number;
    required?: boolean;
    pattern?: RegExp;
    validate?: (value: unknown) => boolean;
  }
): { result: true } | { result: false; message: string; errorCode?: number } {
  // Check required
  if (options?.required) {
    if (
      input === null ||
      input === undefined ||
      (typeof input === 'string' && input.trim() === '')
    ) {
      return { result: false, message: 'Input is required' };
    }
  }

  // Check type
  let isValidType = false;
  switch (type) {
    case 'string':
      isValidType = typeof input === 'string';
      break;
    case 'number':
      isValidType = typeof input === 'number' && !isNaN(input);
      break;
    case 'boolean':
      isValidType = typeof input === 'boolean';
      break;
    case 'object':
      isValidType = input !== null && typeof input === 'object';
      break;
    case 'array':
      isValidType = Array.isArray(input);
      break;
    case 'null':
      isValidType = input === null;
      break;
    case 'undefined':
      isValidType = input === undefined;
      break;
    default:
      return { result: false, message: `Invalid type: ${type}` };
  }

  if (!isValidType) {
    return {
      result: false,
      message: `Invalid type: expected ${type}, got ${typeof input}`,
    };
  }

  // Check string length
  if (type === 'string' && typeof input === 'string') {
    if (options?.minLength && input.length < options.minLength) {
      return {
        result: false,
        message: `String length must be at least ${options.minLength} characters`,
      };
    }
    if (options?.maxLength && input.length > options.maxLength) {
      return {
        result: false,
        message: `String length must be at most ${options.maxLength} characters`,
      };
    }
    if (options?.pattern && !options.pattern.test(input)) {
      return { result: false, message: 'Input does not match pattern' };
    }
  }

  // Check number range
  if (type === 'number' && typeof input === 'number') {
    if (options?.min !== undefined && input < options.min) {
      return {
        result: false,
        message: `Number must be at least ${options.min}`,
      };
    }
    if (options?.max !== undefined && input > options.max) {
      return {
        result: false,
        message: `Number must be at most ${options.max}`,
      };
    }
  }

  // Check array length
  if (type === 'array' && Array.isArray(input)) {
    if (options?.minLength && input.length < options.minLength) {
      return {
        result: false,
        message: `Array length must be at least ${options.minLength}`,
      };
    }
    if (options?.maxLength && input.length > options.maxLength) {
      return {
        result: false,
        message: `Array length must be at most ${options.maxLength}`,
      };
    }
  }

  // Check custom validation
  if (options?.validate && !options.validate(input)) {
    return { result: false, message: 'Input failed custom validation' };
  }

  return { result: true };
}
